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
    version: '1.0.0',
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

/** Gamma stores clobTokenIds as a JSON-stringified [yesToken, noToken].
 *  Parse it and return the YES token. Indexing the raw string would
 *  yield the literal '[' char — the bug this guards against. */
function firstTokenId(clobTokenIds: unknown): string | null {
  if (Array.isArray(clobTokenIds)) return (clobTokenIds[0] as string) ?? null;
  if (typeof clobTokenIds !== 'string') return null;
  try {
    const arr = JSON.parse(clobTokenIds);
    return Array.isArray(arr) ? (arr[0] ?? null) : null;
  } catch {
    return null;
  }
}

/** Gamma returns volume as a numeric string. Coerce to number per spec. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Internal-shape → external-spec transforms ────────────────────────
// The supervisor/agents emit pmcopilot's internal Brief/claims shapes
// (prose claims with {{book·1}} citation-pill placeholders). The external
// API contract (docs/kairos/openapi.yaml) promises clean fields. These
// helpers do the translation so partners never see internal syntax.

/** Strip internal citation-pill placeholders ({{book·1}}) and join claim
 *  texts into clean prose. */
function claimsToProse(claims: ReadonlyArray<{ text: string }> | undefined): string {
  if (!claims?.length) return '';
  return claims
    .map((c) => String(c.text ?? '').replace(/\{\{[^}]+\}\}/g, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

/** Brief directional edge → spec verdict enum. */
function mapVerdict(edge: 'yes' | 'no' | 'none'): 'buy_yes' | 'buy_no' | 'watch' {
  if (edge === 'yes') return 'buy_yes';
  if (edge === 'no') return 'buy_no';
  return 'watch';
}

/** Brief confidence band → 0-1 number (spec wants numeric confidence). */
function confidenceToNumber(c: 'high' | 'med' | 'low'): number {
  return c === 'high' ? 0.8 : c === 'med' ? 0.55 : 0.3;
}

/** News relevance band → 0-1 score (spec wants relevance_score:number). */
function relevanceToScore(r: 'high' | 'med' | 'low' | undefined): number | null {
  if (r === 'high') return 0.9;
  if (r === 'med') return 0.6;
  if (r === 'low') return 0.3;
  return null;
}

/** Internal Citation → external citation shape. */
function mapCitation(c: { id?: string; url?: string; kind?: string; label?: string }) {
  return { id: c.id ?? null, url: c.url ?? null, source: c.kind ?? null, quote: c.label ?? null };
}

/** Brief.sections object → spec [{title, body}] array. */
function mapSections(sections: Record<string, ReadonlyArray<{ text: string }>>) {
  const order = ['setup', 'book', 'smart', 'catalysts', 'verdict'] as const;
  const titles: Record<string, string> = {
    setup: 'Setup',
    book: 'Order Book',
    smart: 'Smart Money',
    catalysts: 'Catalysts & News',
    verdict: 'Verdict',
  };
  return order
    .filter((k) => sections[k]?.length)
    .map((k) => ({ title: titles[k] ?? k, body: claimsToProse(sections[k]) }));
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
        volume_usd: toNum(sub.volume),
        token_id: firstTokenId(sub.clobTokenIds),
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
      // avg_price + unrealized PnL are not in pmcopilot's holders feed yet
      // (HolderRow carries size, not entry). Spec marks them nullable.
      avg_price_cents: null,
      unrealized_pnl_usd: null,
      unrealized_pnl_pct: null,
      first_position_at: null,
      behavior_tags: [] as string[],
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
    items: items.map((a, i) => ({
      title: a.headline,
      url: a.url,
      source: a.source,
      published_at: a.publishedAt ?? null,
      relevance_score: relevanceToScore(a.relevance),
      // pmcopilot's news agent does not classify directional impact yet.
      impact_direction: 'unclear' as const,
      summary: a.snippet ?? null,
      citation_id: `news-${i + 1}`,
      // extra signal beyond the spec — harmless additive field
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
  const claims = sentimentDone?.output?.claims ?? [];
  const summary = claimsToProse(claims);
  return res.json({
    market_id: m.marketId,
    // pmcopilot's sentiment agent emits a prose read, not a scored
    // direction. Numeric score/confidence are null until the agent is
    // upgraded to emit them (v1.1). label stays null rather than
    // fabricating a direction we didn't actually compute.
    score: null,
    confidence: null,
    label: summary ? 'reported' : 'insufficient_data',
    summary: summary || null,
    sources_count: (sentimentDone?.output?.citations ?? []).length,
    sources: (sentimentDone?.output?.citations ?? []).map(mapCitation),
    fetched_at: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /v1/markets/{market_id}/thesis
// ─────────────────────────────────────────────────────────────────────
const COUNTER_PROMPT =
  'Argue the case AGAINST the current market consensus and the leading thesis. ' +
  'Give three strong reasons the OPPOSITE side could be right, grounded in the news, holders, and comparables. ' +
  'Do not soften. If the lean is YES, argue NO; if NO, argue YES. ' +
  'End with one concrete observation that, if it happened, would flip the view.';

function oppositeVerdict(v: 'buy_yes' | 'buy_no' | 'watch'): 'buy_yes' | 'buy_no' | 'watch' {
  if (v === 'buy_yes') return 'buy_no';
  if (v === 'buy_no') return 'buy_yes';
  return 'watch';
}

router.get('/markets/:market_id/thesis', async (req: Request, res: Response) => {
  const marketId = getParam(req, 'market_id');
  const wantCounter = String(req.query['counter'] || '').toLowerCase() === 'true';
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

  const verdict = mapVerdict(brief.edge);
  const thesis = {
    verdict,
    // pmcopilot's Brief carries a directional edge, not a numeric one,
    // and does not split bull/bear — null rather than fabricate.
    edge_pp: null as number | null,
    confidence: confidenceToNumber(brief.confidence),
    summary: claimsToProse(brief.sections.verdict) || null,
    bull_case: null as string | null,
    bear_case: null as string | null,
    sections: mapSections(brief.sections as unknown as Record<string, { text: string }[]>),
    citations: brief.citations.map(mapCitation),
  };

  let counter_thesis: typeof thesis | undefined;
  if (wantCounter) {
    try {
      const routing = byokProvider(req.byok ?? {});
      const slot = readGrounding(m.marketId);
      const counterEvents: unknown[] = [];
      const counterAns = await runAsk(
        m,
        { book: slot?.book ?? null, holders: slot?.holders ?? null, news: slot?.news ?? null },
        COUNTER_PROMPT,
        ((ev: unknown) => counterEvents.push(ev)) as Parameters<typeof runAsk>[3],
        routing.primary,
        undefined,
        getExaSearcher(),
      );
      counter_thesis = {
        verdict: oppositeVerdict(verdict),
        edge_pp: null,
        confidence: null as unknown as number,
        summary: claimsToProse(counterAns?.claims) || null,
        bull_case: null,
        bear_case: null,
        sections: [],
        citations: (counterAns?.citations ?? []).map(mapCitation),
      };
    } catch {
      counter_thesis = undefined; // counter is best-effort; omit on failure
    }
  }

  return res.json({
    market_id: m.marketId,
    thesis,
    ...(counter_thesis ? { counter_thesis } : {}),
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
  // The comparables agent computes structured ComparableHit[] internally
  // but only surfaces a prose AgentResult. Exposing the structured hits
  // (similarity_score, shape, realized_value) is a v1.1 core change. For
  // now: clean prose summary + citations, structured array empty rather
  // than fabricated.
  void limit;
  return res.json({
    market_id: m.marketId,
    comparables: [] as unknown[],
    summary: claimsToProse(compDone?.output?.claims) || null,
    citations: (compDone?.output?.citations ?? []).map(mapCitation),
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
      answer: claimsToProse(answer?.claims),
      citations: (answer?.citations ?? []).map(mapCitation),
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
    holders:
      holdersG && holdersG.kind === 'holders'
        ? holdersG.rows.map((h) => ({
            address: h.address,
            display_name: h.label ?? null,
            side: h.side,
            shares: h.shares,
            value_usd: h.sizeUsd,
            avg_price_cents: null,
            unrealized_pnl_usd: null,
            unrealized_pnl_pct: null,
            first_position_at: null,
            behavior_tags: [] as string[],
          }))
        : [],
    news:
      newsG && newsG.kind === 'news'
        ? newsG.items.map((a, i) => ({
            title: a.headline,
            url: a.url,
            source: a.source,
            published_at: a.publishedAt ?? null,
            relevance_score: relevanceToScore(a.relevance),
            impact_direction: 'unclear' as const,
            summary: a.snippet ?? null,
            citation_id: `news-${i + 1}`,
          }))
        : [],
    book: bookG && bookG.kind === 'book' ? bookG : null,
    sentiment: {
      score: null,
      confidence: null,
      summary: claimsToProse(sentimentDone?.output?.claims) || null,
      sources: (sentimentDone?.output?.citations ?? []).map(mapCitation),
    },
    comparables: {
      comparables: [] as unknown[],
      summary: claimsToProse(compDone?.output?.claims) || null,
      citations: (compDone?.output?.citations ?? []).map(mapCitation),
    },
    thesis: brief
      ? {
          verdict: mapVerdict(brief.edge),
          edge_pp: null,
          confidence: confidenceToNumber(brief.confidence),
          summary: claimsToProse(brief.sections.verdict) || null,
          bull_case: null,
          bear_case: null,
          sections: mapSections(brief.sections as unknown as Record<string, { text: string }[]>),
          citations: brief.citations.map(mapCitation),
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
