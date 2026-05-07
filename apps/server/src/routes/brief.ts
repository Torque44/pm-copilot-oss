// GET /api/brief?category=sports|crypto        → brief the top-volume market
// GET /api/brief?marketId=<gamma market id>     → brief a specific market
// GET /api/brief?marketId=...&force=1           → ignore cache, re-run agents
//
// Returns a JSON response containing the full event log from the supervisor
// run. Clients reduce the event array into a BriefShape via the same reducer
// they used during the SSE era (apps/web/src/hooks/useBrief.ts:reduce).
//
// History note: this route used to stream Server-Sent Events as agents
// completed. The cf-azure-rewrite (May 2026) dropped SSE because (a) the
// brief isn't usable until synthesis completes anyway, so progressive
// streaming was visual filler, and (b) it constrained the deploy story —
// every host had to handle long-lived event streams. The supervisor still
// runs the seven agents in parallel server-side; we just collect every
// emitted event into an array here and return it in one HTTP response.

import type { Request, Response } from 'express';
import {
  listEventsByTag,
  listEventsAll,
  pickBestSubMarket,
  gammaToMarketMeta,
} from '@pm-copilot/core/feeds/polymarket';
import { cached } from '../cache.js';
import { runSupervisor } from '@pm-copilot/core/agents/supervisor';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import { topTweetsForMarket } from '@pm-copilot/core/mcp/loaders/x-stub';
import { rememberGrounding } from '../groundingStore.js';
import type { MarketMeta, AgentEvent, Category } from '@pm-copilot/core';
import { getCached, startRecording, type BriefEnvelope } from '../briefStore.js';

const MARKET_TTL_MS = 5 * 60 * 1000;

/** Response shape returned by GET /api/brief. The client iterates events
 *  through its existing reducer (`apps/web/src/hooks/useBrief.ts:reduce`)
 *  to build the BriefShape it renders. `complete: true` means the
 *  supervisor finished cleanly; `false` means it crashed or timed out
 *  and the events array contains a partial run plus an error envelope. */
export type BriefResponse = {
  /** Full event log: market envelope + per-agent start/done/error +
   *  brief:section / cite / brief:complete envelopes. */
  events: BriefEnvelope[];
  /** True if the brief finished without an error envelope. */
  complete: boolean;
  /** When the response was cached vs freshly run. Present on cache hit. */
  cache?: { source: 'memory'; ageMs: number };
};

function parseCategory(raw: unknown): Category {
  const v = String(raw ?? '');
  if (v === 'crypto' || v === 'politics' || v === 'other') return v;
  return 'sports';
}

async function resolveTopMarket(category: Category): Promise<MarketMeta | null> {
  return cached(`topmarket:${category}`, MARKET_TTL_MS, async () => {
    const events = category === 'other'
      ? await listEventsAll(25)
      : await listEventsByTag(category, 25);
    for (const ev of events) {
      const m = pickBestSubMarket(ev);
      if (!m) continue;
      if (!m.clobTokenIds) continue;
      const meta = gammaToMarketMeta(ev, m, category);
      if (!meta.tokenIdYes || !meta.tokenIdNo) continue;
      return meta;
    }
    return null;
  });
}

async function resolveMarketById(marketId: string): Promise<MarketMeta | null> {
  return cached(`market:${marketId}`, MARKET_TTL_MS, async () => {
    // Larger pool — the contested-mode markets list pulls 150+ events, so
    // markets that show in the rail can have lower volume rank. Use 200 to
    // make sure anything visible in the rail can also be briefed.
    const buckets: { cat: Category; fetch: () => Promise<Awaited<ReturnType<typeof listEventsByTag>>> }[] = [
      { cat: 'sports',   fetch: () => listEventsByTag('sports', 200) },
      { cat: 'crypto',   fetch: () => listEventsByTag('crypto', 200) },
      { cat: 'politics', fetch: () => listEventsByTag('politics', 200) },
      { cat: 'other',    fetch: () => listEventsAll(200) },
    ];
    for (const b of buckets) {
      const events = await b.fetch();
      for (const ev of events) {
        for (const m of ev.markets) {
          if (m.id !== marketId) continue;
          if (!m.clobTokenIds) return null;
          const meta = gammaToMarketMeta(ev, m, b.cat);
          if (!meta.tokenIdYes || !meta.tokenIdNo) return null;
          return meta;
        }
      }
    }
    return null;
  });
}

export async function briefHandler(req: Request, res: Response) {
  const marketId = req.query.marketId ? String(req.query.marketId) : null;
  const category = parseCategory(req.query.category);
  const force = req.query.force === '1' || req.query.force === 'true';

  // Fast path: if we already have a recent, complete brief for this marketId,
  // return the stored event log instead of re-running the agent pipeline.
  if (marketId && !force) {
    const cachedBrief = getCached(marketId);
    if (cachedBrief) {
      const ageMs = Date.now() - cachedBrief.savedAt;
      const ageS = Math.round(ageMs / 1000);
      console.info(`[brief] cache HIT ${marketId} (age ${ageS}s, ${cachedBrief.events.length} events)`);
      const body: BriefResponse = {
        events: cachedBrief.events,
        complete: true,
        cache: { source: 'memory', ageMs },
      };
      res.json(body);
      return;
    }
    console.info(`[brief] cache MISS ${marketId} — running fresh`);
  } else if (force) {
    console.info(`[brief] cache BYPASSED ${marketId} (force=1)`);
  }

  let market: MarketMeta | null = null;
  try {
    market = marketId
      ? await resolveMarketById(marketId)
      : await resolveTopMarket(category);
  } catch (err: unknown) {
    res.status(500).json({
      events: [{ t: 'error', error: `resolveMarket failed: ${errMsg(err)}` } as BriefEnvelope],
      complete: false,
    } satisfies BriefResponse);
    return;
  }
  if (!market) {
    res.status(404).json({
      events: [{
        t: 'error',
        error: marketId ? `market ${marketId} not found` : `no active ${category} market found`,
      } as BriefEnvelope],
      complete: false,
    } satisfies BriefResponse);
    return;
  }

  // Collect every event the supervisor emits into a single array. We also
  // record each event into the per-market brief store so the next request
  // for this market gets the cache HIT path above.
  const record = startRecording(market.marketId);
  const events: BriefEnvelope[] = [];
  const marketEv: BriefEnvelope = { t: 'market', market };
  record(marketEv);
  events.push(marketEv);

  const emit = (ev: AgentEvent) => {
    record(ev);
    events.push(ev);
  };

  let complete = true;
  try {
    // Per HANDOFF.md §Task C: build per-agent provider routing from BYOK
    // headers (or env-var fallbacks) and thread it through the supervisor.
    const routing = byokProvider(req.byok ?? {});
    // Seed sentiment with bundled KOL tweets matched against the market
    // title so the Sentiment tab demos even without an X-actions MCP server.
    // Production users supplying an MCP feed for venue=x scope=news override
    // this at registration time.
    const tweets = routing.sentiment ? topTweetsForMarket(market.title, 10) : [];
    await runSupervisor({ market, emit, rememberGrounding, routing, tweets });
  } catch (err: unknown) {
    const errEv: BriefEnvelope = { t: 'error', error: errMsg(err) || 'supervisor crashed' };
    record(errEv);
    events.push(errEv);
    complete = false;
  }

  const body: BriefResponse = { events, complete };
  res.json(body);
}

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return '';
}
