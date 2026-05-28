// /v1/* — external API surface for Kairos and partners.
//
// All routes (except /health) require X-Api-Key. The router maps the
// public Kairos spec (docs/kairos/openapi.yaml) onto the existing
// internal supervisor + briefStore. Most endpoints read from the brief
// cache (briefStore) if a brief was recently generated; the /research
// endpoint runs the supervisor on demand.
//
// Mounted at /v1 in apps/server/src/index.ts.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { kairosApiKey } from '../middleware/kairosApiKey.js';
import {
  listEventsAll,
  listEventsByTag,
  gammaToMarketMeta,
  getEventForMarketId,
} from '@pm-copilot/core/feeds/polymarket';
import { cached } from '../cache.js';
import { runSupervisor } from '@pm-copilot/core/agents/supervisor';
import { runAsk } from '@pm-copilot/core/agents/ask';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import { getExaSearcher } from '../exa.js';
import { getNewsCache } from '../news-cache.js';
import { topTweetsForMarket } from '@pm-copilot/core/mcp/loaders/x-stub';
import { rememberGrounding, readGrounding } from '../groundingStore.js';
import { getCached, startRecording, type BriefEnvelope } from '../briefStore.js';
import type { MarketMeta, Category, AgentEvent, GroundingData } from '@pm-copilot/core';

const router = Router();

// ─────────────────────────────────────────────────────────────────────
// /v1/health — exempt from API key (used by health checkers + dashboards)
// ─────────────────────────────────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'pm-copilot',
    version: '1.0.0-rc1',
    uptime_s: process.uptime(),
  });
});

// All routes below require X-Api-Key.
router.use(kairosApiKey);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const MARKET_TTL_MS = 5 * 60 * 1000;

async function resolveMarketById(marketId: string): Promise<MarketMeta | null> {
  return cached(`v1:market:${marketId}`, MARKET_TTL_MS, async () => {
    const buckets: { cat: Category; fetch: () => Promise<Awaited<ReturnType<typeof listEventsByTag>>> }[] = [
      { cat: 'sports', fetch: () => listEventsByTag('sports', 200) },
      { cat: 'crypto', fetch: () => listEventsByTag('crypto', 200) },
      { cat: 'politics', fetch: () => listEventsByTag('politics', 200) },
      { cat: 'other', fetch: () => listEventsAll(200) },
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
    // Direct lookup fallback (mirrors brief.ts).
    try {
      const direct = await getEventForMarketId(marketId);
      if (!direct) return null;
      const { event, marketRaw } = direct;
      if (!marketRaw.clobTokenIds) return null;
      const meta = gammaToMarketMeta(event, marketRaw, 'other');
      if (!meta.tokenIdYes || !meta.tokenIdNo) return null;
      return meta;
    } catch {
      return null;
    }
  });
}

function marketMetaToPublic(m: MarketMeta) {
  const yesC = m.yes != null ? Math.round(m.yes * 1000) / 10 : null;
  const noC = m.no != null ? Math.round(m.no * 1000) / 10 : null;
  return {
    market_id: m.marketId,
    title: m.title,
    slug: m.slug,
    category: m.category,
    status: m.resolvedAt ? 'resolved' : 'open',
    venue: m.venue ?? 'polymarket',
    oracle: 'UMA',
    yes_price_cents: yesC,
    no_price_cents: noC,
    volume_usd: m.volumeTotal,
    volume_24h_usd: m.volume24hr,
    ends_at: m.endDate,
    ends_at_timezone: 'ET',
    description: m.resolutionWording ?? null,
    url: m.eventSlug ? `https://polymarket.com/event/${m.eventSlug}` : null,
  };
}

function notFound(res: Response, what: string): Response {
  return res.status(404).json({ error: 'not_found', message: `${what} not found` });
}

function getParam(req: Request, key: string): string {
  const v = req.params[key];
  return typeof v === 'string' ? v : '';
}

/** Read agent grounding from the cached brief event log, if present. */
function pluckGrounding(events: BriefEnvelope[], agent: string): GroundingData | null {
  for (const ev of events) {
    if ((ev as AgentEvent).t === 'agent:data') {
      const ae = ev as Extract<AgentEvent, { t: 'agent:data' }>;
      if (ae.agent === agent) return ae.grounding;
    }
  }
  return null;
}

/** Read final synthesized Brief from the cached event log. */
function pluckBrief(events: BriefEnvelope[]) {
  for (const ev of events) {
    if ((ev as AgentEvent).t === 'brief:complete') {
      return (ev as Extract<AgentEvent, { t: 'brief:complete' }>).brief;
    }
  }
  return null;
}

/**
 * Run the supervisor for a market and return the resulting event log.
 * Used by endpoints that need fresh data (no cache hit). Records into
 * briefStore so subsequent calls are served from cache.
 */
async function runFreshBrief(req: Request, market: MarketMeta): Promise<BriefEnvelope[]> {
  const events: BriefEnvelope[] = [];
  const record = startRecording(market.marketId);
  const marketEv: BriefEnvelope = { t: 'market', market };
  record(marketEv);
  events.push(marketEv);

  const routing = byokProvider(req.byok ?? {});
  const tweets = routing.sentiment ? topTweetsForMarket(market.title, 10) : [];
  const searcher = getExaSearcher();
  const newsCache = getNewsCache();

  const emit = (ev: AgentEvent) => {
    record(ev);
    events.push(ev);
  };

  try {
    await runSupervisor({
      market,
      emit,
      rememberGrounding,
      routing,
      tweets,
      searcher,
      newsCache,
    });
  } catch {
    // Errors are recorded via emit; we still return whatever events ran.
  }
  return events;
}

async function getOrRunBriefEvents(req: Request, market: MarketMeta): Promise<BriefEnvelope[]> {
  const cachedBrief = getCached(market.marketId);
  if (cachedBrief && cachedBrief.complete) return cachedBrief.events;
  return runFreshBrief(req, market);
}

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id', async (req: Request, res: Response) => {
  const m = await resolveMarketById(getParam(req, 'market_id'));
  if (!m) return notFound(res, 'market');
  return res.json(marketMetaToPublic(m));
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/outcomes
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/outcomes', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');

  // Pull sibling outcomes from the parent event when available (multi-outcome
  // events like "Who wins the Democratic 2028 primary?").
  const direct = await getEventForMarketId(marketId);
  const event = direct?.event;
  const outcomes = event?.markets?.length
    ? event.markets.map((sub) => ({
        label: sub.question || sub.groupItemTitle || 'Yes',
        yes_price_cents:
          typeof sub.lastTradePrice === 'number'
            ? Math.round(sub.lastTradePrice * 1000) / 10
            : null,
        volume_usd: sub.volume ?? null,
        token_id: sub.clobTokenIds?.[0] ?? null,
        ends_at: sub.endDate ?? null,
      }))
    : [
        {
          label: 'YES',
          yes_price_cents: m.yes != null ? Math.round(m.yes * 1000) / 10 : null,
          volume_usd: m.volumeTotal,
          token_id: m.tokenIdYes,
          ends_at: m.endDate,
        },
      ];
  return res.json({ market_id: m.marketId, outcomes, fetched_at: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/holders
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/holders', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const limit = Math.min(50, Math.max(1, Number(req.query['limit']) || 10));
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');
  const events = await getOrRunBriefEvents(req, m);
  const grounding = pluckGrounding(events, 'holders');
  const rows = grounding && grounding.kind === 'holders' ? grounding.rows.slice(0, limit) : [];
  return res.json({
    market_id: m.marketId,
    holders: rows.map((h) => ({
      address: h.address,
      display_name: h.label ?? null,
      side: h.side,
      shares: h.shares,
      value_usd: h.sizeUsd,
    })),
    concentration_top5_pct: grounding && grounding.kind === 'holders' ? grounding.concentrationTop5Pct : null,
    side_bias: grounding && grounding.kind === 'holders' ? grounding.sideBias : null,
    fetched_at: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/news
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/news', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const limit = Math.min(50, Math.max(1, Number(req.query['limit']) || 20));
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');
  const events = await getOrRunBriefEvents(req, m);
  const grounding = pluckGrounding(events, 'news');
  const items = grounding && grounding.kind === 'news' ? grounding.items.slice(0, limit) : [];
  return res.json({
    market_id: m.marketId,
    items: items.map((a) => ({
      title: a.headline,
      url: a.url,
      source: a.source,
      published_at: a.publishedAt ?? null,
      relevance: a.relevance ?? null,
      from: a.from ?? null,
      snippet: a.snippet ?? null,
      unverified: a.unverified ?? false,
    })),
    background: grounding && grounding.kind === 'news' ? grounding.background ?? null : null,
    fetched_at: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/sentiment
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/sentiment', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');
  const events = await getOrRunBriefEvents(req, m);
  // Sentiment is one of the SectionOut-style agents; we pull its agent:done
  // event for the structured output.
  const sentimentDone = events.find(
    (e): e is Extract<AgentEvent, { t: 'agent:done' }> =>
      (e as AgentEvent).t === 'agent:done' && (e as Extract<AgentEvent, { t: 'agent:done' }>).agent === 'sentiment',
  );
  return res.json({
    market_id: m.marketId,
    claims: sentimentDone?.output?.claims ?? [],
    citations: sentimentDone?.output?.citations ?? [],
    fetched_at: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/thesis
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/thesis', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');
  const events = await getOrRunBriefEvents(req, m);
  const brief = pluckBrief(events);
  if (!brief) {
    return res.status(503).json({
      error: 'brief_not_ready',
      message: 'thesis still generating; retry in 5-10s',
    });
  }
  return res.json({
    market_id: m.marketId,
    verdict: brief.edge,
    confidence: brief.confidence,
    sections: brief.sections,
    citations: brief.citations,
    generated_at: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/comparables
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/comparables', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const limit = Math.min(20, Math.max(1, Number(req.query['limit']) || 5));
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');
  const events = await getOrRunBriefEvents(req, m);
  const compDone = events.find(
    (e): e is Extract<AgentEvent, { t: 'agent:done' }> =>
      (e as AgentEvent).t === 'agent:done' && (e as Extract<AgentEvent, { t: 'agent:done' }>).agent === 'comparables',
  );
  return res.json({
    market_id: m.marketId,
    claims: (compDone?.output?.claims ?? []).slice(0, limit),
    citations: compDone?.output?.citations ?? [],
    fetched_at: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/resolution
// ─────────────────────────────────────────────────────────────────────
router.get('/markets/:market_id/resolution', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');
  return res.json({
    market_id: m.marketId,
    status: m.resolvedAt ? 'resolved' : 'unresolved',
    resolution_source: m.resolutionSource ?? 'UMA + on-chain + credible reporting',
    oracle: 'UMA',
    dispute_window_h: 48,
    resolved_at: m.resolvedAt ?? null,
    resolution_text: m.resolutionWording ?? '',
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /v1/ask
// ─────────────────────────────────────────────────────────────────────
router.post('/ask', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { market_id?: unknown; question?: unknown };
  const marketId = typeof body.market_id === 'string' ? body.market_id : '';
  const question = typeof body.question === 'string' ? body.question : '';
  if (!marketId || !question) {
    return res.status(400).json({ error: 'bad_request', message: 'market_id and question are required' });
  }
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');

  const routing = byokProvider(req.byok ?? {});
  const slot = readGrounding(m.marketId);
  const askGrounding = {
    book: slot?.book ?? null,
    holders: slot?.holders ?? null,
    news: slot?.news ?? null,
    tweets: topTweetsForMarket(m.title, 10).map((t) => ({
      handle: t.handle,
      text: t.text,
      url: t.url,
      createdAt: t.createdAt,
    })),
  };
  const askEvents: unknown[] = [];
  const emit = (ev: unknown) => { askEvents.push(ev); };

  try {
    const answer = await runAsk(
      m,
      askGrounding,
      question,
      emit as Parameters<typeof runAsk>[3],
      routing.primary,
      undefined,
      getExaSearcher(),
    );
    return res.json({
      market_id: m.marketId,
      question,
      claims: answer?.claims ?? [],
      citations: answer?.citations ?? [],
      events: askEvents,
      complete: true,
    });
  } catch (err) {
    return res.status(502).json({ error: 'upstream_failure', message: (err as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /v1/research — full multi-agent envelope (one call, everything)
// ─────────────────────────────────────────────────────────────────────
router.post('/research', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { market_id?: unknown };
  const marketId = typeof body.market_id === 'string' ? body.market_id : '';
  if (!marketId) {
    return res.status(400).json({ error: 'bad_request', message: 'market_id is required' });
  }
  const m = await resolveMarketById(marketId);
  if (!m) return notFound(res, 'market');

  const events = await getOrRunBriefEvents(req, m);
  const holdersG = pluckGrounding(events, 'holders');
  const newsG = pluckGrounding(events, 'news');
  const bookG = pluckGrounding(events, 'market');
  const sentimentDone = events.find(
    (e): e is Extract<AgentEvent, { t: 'agent:done' }> =>
      (e as AgentEvent).t === 'agent:done' && (e as Extract<AgentEvent, { t: 'agent:done' }>).agent === 'sentiment',
  );
  const compDone = events.find(
    (e): e is Extract<AgentEvent, { t: 'agent:done' }> =>
      (e as AgentEvent).t === 'agent:done' && (e as Extract<AgentEvent, { t: 'agent:done' }>).agent === 'comparables',
  );
  const brief = pluckBrief(events);

  return res.json({
    market_id: m.marketId,
    market: marketMetaToPublic(m),
    holders: holdersG && holdersG.kind === 'holders' ? holdersG.rows : [],
    news: newsG && newsG.kind === 'news' ? newsG.items : [],
    book: bookG && bookG.kind === 'book' ? bookG : null,
    sentiment: sentimentDone?.output ?? null,
    comparables: compDone?.output ?? null,
    thesis: brief
      ? {
          verdict: brief.edge,
          confidence: brief.confidence,
          sections: brief.sections,
          citations: brief.citations,
        }
      : null,
    resolution: {
      market_id: m.marketId,
      status: m.resolvedAt ? 'resolved' : 'unresolved',
      resolution_text: m.resolutionWording ?? '',
      oracle: 'UMA',
    },
    generated_at: new Date().toISOString(),
  });
});

export default router;
