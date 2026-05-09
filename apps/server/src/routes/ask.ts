// POST /api/ask  — ASKB-style Q&A grounded in the loaded market.
// Body:     { market: MarketMeta, question: string }
// Response: { events: AskEvent[], complete: boolean }
//
// History note: this route used to stream Server-Sent Events as the agents
// progressed. The cf-azure-rewrite (May 2026) dropped SSE in favour of a
// single synchronous JSON response. The supervisor still does the same
// work — it just emits into an in-memory array now and we return the array
// in one HTTP response.

import type { Request, Response } from 'express';
import { runAsk, type AskEvent } from '@pm-copilot/core/agents/ask';
import { readGrounding, rememberGrounding } from '../groundingStore.js';
import { runMarketAgent } from '@pm-copilot/core/agents/market';
import { runHoldersAgent } from '@pm-copilot/core/agents/holders';
import { runNewsAgent } from '@pm-copilot/core/agents/news';
import { topTweetsForMarket } from '@pm-copilot/core/mcp/loaders/x-stub';
import { byokProvider } from '@pm-copilot/core/providers/byok';
import type {
  MarketMeta, BookGrounding, HoldersGrounding, NewsGrounding, AgentEvent, LLMProvider,
} from '@pm-copilot/core';

/** Response shape returned by POST /api/ask. The client iterates the
 *  events to build the chat message; an `ask:done` envelope holds the
 *  final structured answer (sections + citations). `complete: false`
 *  means the run errored partway through. */
export type AskResponse = {
  events: AskEvent[];
  complete: boolean;
};

/** Validate the body's market shape just enough to trust it for grounding fetches. */
function parseMarket(body: unknown): MarketMeta | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as { market?: unknown };
  const m = root.market;
  if (!m || typeof m !== 'object') return null;
  const cand = m as Partial<MarketMeta>;
  if (typeof cand.marketId !== 'string' || !cand.marketId) return null;
  if (typeof cand.tokenIdYes !== 'string' || typeof cand.tokenIdNo !== 'string') return null;
  return cand as MarketMeta;
}

/**
 * Ensure we have book/holders/news for the market. If the grounding store
 * already has them from a previous brief run, use that; otherwise fetch fresh.
 * This lets users ask questions immediately on a freshly-selected market even
 * before the brief finishes.
 */
async function ensureGrounding(
  market: MarketMeta,
  emit: (ev: AskEvent) => void
): Promise<{ book: BookGrounding | null; holders: HoldersGrounding | null; news: NewsGrounding | null }> {
  const existing = readGrounding(market.marketId);
  const have = {
    book: (existing?.book ?? null) as BookGrounding | null,
    holders: (existing?.holders ?? null) as HoldersGrounding | null,
    news: (existing?.news ?? null) as NewsGrounding | null,
  };
  // If all three are present, we're done.
  if (have.book && have.holders && have.news) return have;

  emit({ t: 'ask:progress', message: 'fetching grounding (book / holders / news)…' });

  // Swallow supervisor-style events silently; we only need the raw groundings.
  const silent = (_ev: AgentEvent) => { /* drop */ };
  const ctx = { market, emit: silent };

  const tasks: Promise<void>[] = [];
  if (!have.book) tasks.push(runMarketAgent(ctx).then((r) => {
    const g = r.grounding && r.grounding.kind === 'book' ? r.grounding : null;
    have.book = g;
    rememberGrounding(market.marketId, 'book', g);
  }).catch(() => { /* swallow */ }));
  if (!have.holders) tasks.push(runHoldersAgent(ctx).then((r) => {
    const g = r.grounding && r.grounding.kind === 'holders' ? r.grounding : null;
    have.holders = g;
    rememberGrounding(market.marketId, 'holders', g);
  }).catch(() => { /* swallow */ }));
  if (!have.news) tasks.push(runNewsAgent(ctx).then((r) => {
    const g = r.grounding && r.grounding.kind === 'news' ? r.grounding : null;
    have.news = g;
    rememberGrounding(market.marketId, 'news', g);
  }).catch(() => { /* swallow */ }));
  await Promise.all(tasks);

  return have;
}

export async function askHandler(req: Request, res: Response) {
  const market = parseMarket(req.body);
  const question = String(req.body?.question ?? '').trim();
  if (!market) {
    res.status(400).json({ error: 'request body must include { market: MarketMeta, question }' });
    return;
  }
  if (!question) {
    res.status(400).json({ error: 'question required' });
    return;
  }

  // Collect every emitted event into an array. The final ask:done envelope
  // (or ask:error if it failed) holds the structured answer the client
  // renders in the chat panel.
  const events: AskEvent[] = [];
  const emit = (ev: AskEvent) => { events.push(ev); };

  let complete = true;
  try {
    const grounding = await ensureGrounding(market, emit);
    // Pull in the bundled stub tweets so questions about "vetted X handles
    // posting on this market" get a non-empty answer. xactions / live-search
    // would override this at registration time; for now this is the canonical
    // chat-side source of [kol-N] citations.
    const tweets = topTweetsForMarket(market.title, 10).map((t) => ({
      handle: t.handle,
      text: t.text,
      url: t.url,
      createdAt: t.createdAt,
    }));
    // Pick the best provider for ask: prefer a web-search-capable one so we
    // can answer factual questions whose data isn't already in the brief
    // grounding ("how did Antonelli win the last race"). Priority:
    //   1. perplexity (when user adds a Perplexity key — native web search)
    //   2. xAI / Grok (the user's own setup — live_search is auto-enabled in
    //      runAsk via the webSearch capability flag)
    //   3. primary (OpenAI today — answers from grounding only, honest about
    //      data gaps when grounding doesn't cover the question)
    const routing = byokProvider(req.byok ?? {});
    let askProvider: LLMProvider | null = null;
    if (routing.news.capabilities?.webSearch) askProvider = routing.news;          // perplexity
    else if (routing.sentiment?.capabilities?.webSearch) askProvider = routing.sentiment; // xai
    // else fall through to primary via getProvider() inside runAsk
    await runAsk(market, { ...grounding, tweets }, question, emit, askProvider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'ask failed';
    events.push({ t: 'ask:error', error: msg, elapsedMs: 0 });
    complete = false;
  }

  const body: AskResponse = { events, complete };
  res.json(body);
}
