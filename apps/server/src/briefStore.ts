// briefStore.ts — caches the full SSE event log per marketId so that
// re-selecting a market within the TTL serves the brief instantly from
// memory (no agent re-run, no extra LLM spend).
//
// On a cache hit, /api/brief simply streams the stored events in order
// with a tiny stagger, so the UI still "fills in" rather than popping.

import type { AgentEvent, MarketMeta } from '@pm-copilot/core';
import { markDirty, registerProducer } from './persist.js';
import { publish } from './eventBus.js';

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

const TTL_MS = 10 * 60 * 1000;
const store = new Map<string, BriefRecord>();

let rehydrated = false;
export function hydrate(serialized: Record<string, { events: unknown[]; savedAt: number }> | undefined) {
  if (rehydrated || !serialized) { rehydrated = true; return; }
  const now = Date.now();
  for (const [k, v] of Object.entries(serialized)) {
    if (!v || now - v.savedAt > TTL_MS) continue;
    const events = Array.isArray(v.events) ? v.events as BriefEnvelope[] : [];
    // Only keep if it ever completed (otherwise let it rebuild fresh).
    const complete = events.some(e => (e as AgentEvent).t === 'brief:complete');
    if (!complete) continue;
    store.set(k, { marketId: k, events, savedAt: v.savedAt, complete });
  }
  rehydrated = true;
}

registerProducer(() => {
  const out: Record<string, { events: unknown[]; savedAt: number }> = {};
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (!v.complete) continue;
    if (now - v.savedAt > TTL_MS) continue;
    out[k] = { events: v.events, savedAt: v.savedAt };
  }
  return { briefs: out };
});

export function startRecording(marketId: string): (ev: BriefEnvelope) => void {
  const rec: BriefRecord = { marketId, events: [], savedAt: Date.now(), complete: false };
  store.set(marketId, rec);
  return (ev: BriefEnvelope) => {
    rec.events.push(ev);
    rec.savedAt = Date.now();
    if ((ev as AgentEvent).t === 'brief:complete') {
      rec.complete = true;
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
    markDirty();
    return null;
  }
  return rec;
}

export function invalidateBrief(marketId: string) {
  store.delete(marketId);
  markDirty();
}
