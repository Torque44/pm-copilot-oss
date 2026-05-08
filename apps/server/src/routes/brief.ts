// GET /api/brief?category=sports|crypto        → brief the top-volume market
// GET /api/brief?marketId=<gamma market id>     → brief a specific market
// GET /api/brief?marketId=...&force=1           → ignore cache, re-run agents
//
// Streams the supervisor's event log as NDJSON: one JSON envelope per line,
// `Content-Type: application/x-ndjson`. The market envelope ships within ~2s
// of the request, then each agent event flushes as soon as the supervisor
// emits it, then a final `brief:complete` envelope. Clients incrementally
// reduce the stream into a BriefShape via the same reducer they used during
// the SSE era (apps/web/src/hooks/useBrief.ts:reduce).
//
// History note: this route used to stream Server-Sent Events. The cf-azure
// rewrite (May 2026) replaced it with a synchronous JSON response, but the
// resulting "20s blank screen on cold load" was unshippable for a public
// demo. NDJSON gets the streaming UX back without re-introducing the
// EventSource / heartbeat / `data:` framing of SSE — it's just a normal
// HTTP response whose body happens to be one JSON document per line, which
// every host (Azure Container Apps, Render, Fly, Railway) handles natively.

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

/** Cache-meta envelope written as the very first NDJSON line on a cache HIT
 *  so the client knows the stream came from the in-memory store rather than
 *  a fresh supervisor run. */
type CacheEnvelope = { t: 'cache'; source: 'memory'; ageMs: number };
type StreamEnvelope = BriefEnvelope | CacheEnvelope;

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

  // Set up the NDJSON streaming response. Each emit becomes one JSON line.
  // X-Accel-Buffering=no disables nginx buffering if a proxy is in front
  // (Azure Container Apps' ingress is fine without it but we set it
  // defensively for any future deploy target).
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const writeLine = (env: StreamEnvelope) => {
    if (res.writableEnded) return;
    res.write(JSON.stringify(env) + '\n');
  };

  // Fast path: if we already have a recent, complete brief for this marketId,
  // stream the stored event log instead of re-running the agent pipeline.
  // Cache hits feel instantaneous (one TCP round trip's worth of writes).
  if (marketId && !force) {
    const cachedBrief = getCached(marketId);
    if (cachedBrief) {
      const ageMs = Date.now() - cachedBrief.savedAt;
      const ageS = Math.round(ageMs / 1000);
      console.info(`[brief] cache HIT ${marketId} (age ${ageS}s, ${cachedBrief.events.length} events)`);
      writeLine({ t: 'cache', source: 'memory', ageMs });
      for (const ev of cachedBrief.events) writeLine(ev);
      res.end();
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
    writeLine({ t: 'error', error: `resolveMarket failed: ${errMsg(err)}` });
    res.end();
    return;
  }
  if (!market) {
    writeLine({
      t: 'error',
      error: marketId ? `market ${marketId} not found` : `no active ${category} market found`,
    });
    res.end();
    return;
  }

  // Stream the market envelope immediately — this is the key UX win. The
  // client renders the market panel (title, prices, end date, criteria) at
  // ~2s while the supervisor's seven agents run for the next ~13s. No more
  // 20s blank screen.
  const record = startRecording(market.marketId);
  const marketEv: BriefEnvelope = { t: 'market', market };
  record(marketEv);
  writeLine(marketEv);

  // Hook supervisor emit → record (for cache) + writeLine (for the wire).
  const emit = (ev: AgentEvent) => {
    record(ev);
    writeLine(ev);
  };

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
    writeLine(errEv);
  }

  res.end();
}

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return '';
}
