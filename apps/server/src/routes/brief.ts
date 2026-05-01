// GET /api/brief?category=sports|crypto        → brief the top-volume market
// GET /api/brief?marketId=<gamma market id>     → brief a specific market
// GET /api/brief?marketId=...&force=1           → ignore cache, re-run agents
//
// SSE stream of agent events leading up to the final brief. If we have a fresh
// cached brief for the market, we replay the stored event log with a small
// stagger — UI fills in identically, but we skip LLM cost + Polymarket calls.

import type { Request, Response } from 'express';
import {
  listEventsByTag,
  listEventsAll,
  pickBestSubMarket,
  gammaToMarketMeta,
} from '@pm-copilot/core/feeds/polymarket';
import { cached } from '../cache.js';
import { openSse } from '@pm-copilot/core/sse';
import { runSupervisor } from '@pm-copilot/core/agents/supervisor';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import { topTweetsForMarket } from '@pm-copilot/core/mcp/loaders/x-stub';
import { rememberGrounding } from '../groundingStore.js';
import type { MarketMeta, AgentEvent, Category } from '@pm-copilot/core';
import { getCached, startRecording, type BriefEnvelope } from '../briefStore.js';

const MARKET_TTL_MS = 5 * 60 * 1000;

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

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export async function briefHandler(req: Request, res: Response) {
  const marketId = req.query.marketId ? String(req.query.marketId) : null;
  const category = parseCategory(req.query.category);
  const force = req.query.force === '1' || req.query.force === 'true';

  const sse = openSse(res);

  // Fast path: if we already have a recent, complete brief for this marketId,
  // replay the event log instead of re-running the agent pipeline.
  if (marketId && !force) {
    const cachedBrief = getCached(marketId);
    if (cachedBrief) {
      const ageS = Math.round((Date.now() - cachedBrief.savedAt) / 1000);
      console.info(`[brief] cache HIT ${marketId} (age ${ageS}s, ${cachedBrief.events.length} events)`);
      sse.send({ t: 'cache', source: 'memory', ageMs: Date.now() - cachedBrief.savedAt });
      for (const ev of cachedBrief.events) {
        sse.send(ev);
        await sleep(40); // gentle stagger so sections feel like they land, not pop
      }
      sse.close();
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
    sse.send({ t: 'error', error: `resolveMarket failed: ${errMsg(err)}` });
    sse.close();
    return;
  }
  if (!market) {
    sse.send({ t: 'error', error: marketId ? `market ${marketId} not found` : `no active ${category} market found` });
    sse.close();
    return;
  }

  // Start recording every event to the brief store so subsequent loads are instant.
  const record = startRecording(market.marketId);
  const marketEv: BriefEnvelope = { t: 'market', market };
  record(marketEv);
  sse.send(marketEv);

  const emit = (ev: AgentEvent) => {
    record(ev);
    sse.send(ev);
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
    sse.send(errEv);
  } finally {
    sse.close();
  }
}

function errMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '');
  }
  return '';
}
