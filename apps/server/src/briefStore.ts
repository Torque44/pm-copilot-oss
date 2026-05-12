// briefStore.ts — caches the full SSE event log per marketId so that
// re-selecting a market within the TTL serves the brief instantly from
// memory (no agent re-run, no extra LLM spend).
//
// On a cache hit, /api/brief simply streams the stored events in order
// with a tiny stagger, so the UI still "fills in" rather than popping.

import type { AgentEvent, MarketMeta } from '@pm-copilot/core';
import { markDirty, registerProducer } from './persist.js';
import { publish, clearTopic } from './eventBus.js';
import { redactKeyFragments } from './lib/sanitizeError.js';

export type BriefEnvelope =
  | { t: 'market'; market: MarketMeta }
  | { t: 'error'; error: string }
  | AgentEvent;

type BriefRecord = {
  marketId: string;
  events: BriefEnvelope[];
  savedAt: number;
  complete: boolean;
};

// 1 hour TTL — this used to be 10 min, which made the cache useless for an
// active research session: any iteration cycle longer than 10 min between
// reloads paid the full agent re-run cost. The brief itself is grounded in
// orderbook + holders that change continuously, but the LLM synthesis on
// top is the slow / expensive part — it's fine to reuse for an hour.
const TTL_MS = 60 * 60 * 1000;

// Cache version — bump this whenever the brief shape, news prompt, or
// citation registry changes in a way that would make older cached briefs
// look stale or wrong to current users. Mismatched records are dropped on
// hydrate so the next request re-runs the supervisor with the current code.
//
// v2 (2026-05-11): news agent shipped recency tightening (last-7-day
// preference, today's-date injection, 6-month max-age filter). Cached v1
// briefs returned 2024-dated news for active 2026 markets.
//
// v3 (2026-05-12): no-hallucinations news policy. Training-data fallback
// removed entirely from the SYS prompt. Items without URL+publishedAt
// dropped. Two-pass Exa retry with broader keyword query. Cached v2 briefs
// might still carry fabricated 'reuters.com / 2023-04-15' rows; v3 hydrate
// drops them so users see fresh real news or honest empty-state.
const CACHE_VERSION = 3;

const store = new Map<string, BriefRecord>();

let rehydrated = false;
export function hydrate(
  serialized: Record<string, { events: unknown[]; savedAt: number; version?: number }> | undefined,
) {
  if (rehydrated || !serialized) { rehydrated = true; return; }
  const now = Date.now();
  let dropped = 0;
  for (const [k, v] of Object.entries(serialized)) {
    if (!v) continue;
    if (now - v.savedAt > TTL_MS) continue;
    if (v.version !== CACHE_VERSION) { dropped++; continue; }
    const events = Array.isArray(v.events) ? v.events as BriefEnvelope[] : [];
    // Only keep if it ever completed (otherwise let it rebuild fresh).
    const complete = events.some(e => (e as AgentEvent).t === 'brief:complete');
    if (!complete) continue;
    store.set(k, { marketId: k, events, savedAt: v.savedAt, complete });
  }
  if (dropped > 0) {
    console.info(`[briefStore] dropped ${dropped} cached briefs from previous cache version`);
  }
  rehydrated = true;
}

/** Strip key fragments from agent:error envelopes before persisting to disk.
 *  An upstream provider 4xx body can carry "Bearer sk-..." substrings that
 *  end up in result.error → agent:error.error → snapshot.json. Redacting
 *  at the persistence boundary keeps the live SSE replay (which the UI
 *  consumes) untouched while preventing key fragments from hitting disk. */
function sanitizeEventsForPersistence(events: BriefEnvelope[]): BriefEnvelope[] {
  return events.map((ev) => {
    if ((ev as AgentEvent).t === 'agent:error') {
      const e = ev as Extract<AgentEvent, { t: 'agent:error' }>;
      return { ...e, error: redactKeyFragments(e.error) };
    }
    if ((ev as { t: string }).t === 'error') {
      const e = ev as { t: 'error'; error: string };
      return { ...e, error: redactKeyFragments(e.error) };
    }
    return ev;
  });
}

registerProducer(() => {
  const out: Record<string, { events: unknown[]; savedAt: number; version: number }> = {};
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (!v.complete) continue;
    if (now - v.savedAt > TTL_MS) continue;
    out[k] = {
      events: sanitizeEventsForPersistence(v.events),
      savedAt: v.savedAt,
      version: CACHE_VERSION,
    };
  }
  return { briefs: out };
});

export function startRecording(marketId: string): (ev: BriefEnvelope) => void {
  // Record into a LOCAL buffer, not the global store. This protects any
  // previously-cached complete brief from being clobbered by a fresh run
  // that gets interrupted (browser tab closed, synthesis errored, etc).
  // The global store only swaps to this run on `brief:complete`.
  const rec: BriefRecord = { marketId, events: [], savedAt: Date.now(), complete: false };
  return (ev: BriefEnvelope) => {
    rec.events.push(ev);
    rec.savedAt = Date.now();
    if ((ev as AgentEvent).t === 'brief:complete') {
      rec.complete = true;
      store.set(marketId, rec);
      markDirty();
    }
    // Broadcast to anyone listening on /api/event-stream?marketId=<id>
    publish(`brief:${marketId}`, ev);
  };
}

export function getCached(marketId: string): BriefRecord | null {
  const rec = store.get(marketId);
  if (!rec || !rec.complete) return null;
  if (Date.now() - rec.savedAt > TTL_MS) {
    store.delete(marketId);
    clearTopic(`brief:${marketId}`);
    markDirty();
    return null;
  }
  return rec;
}

export function invalidateBrief(marketId: string) {
  store.delete(marketId);
  // Reclaim the eventBus channel — otherwise channels Map grows unbounded
  // across unique marketIds (one per ever-briefed market, never reaped).
  clearTopic(`brief:${marketId}`);
  markDirty();
}
