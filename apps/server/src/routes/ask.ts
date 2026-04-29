// POST /api/ask  — ASKB-style streaming Q&A grounded in the loaded market.
// Body: { marketId: string, question: string }
// Response: SSE of AskEvent

import type { Request, Response } from 'express';
import { openSse } from '@pm-copilot/core/sse';
import { runAsk, type AskEvent } from '@pm-copilot/core/agents/ask';
import { readGrounding, rememberGrounding } from '../groundingStore.js';
import { runMarketAgent } from '@pm-copilot/core/agents/market';
import { runHoldersAgent } from '@pm-copilot/core/agents/holders';
import { runNewsAgent } from '@pm-copilot/core/agents/news';
import type { MarketMeta, BookGrounding, HoldersGrounding, NewsGrounding, AgentEvent } from '@pm-copilot/core';

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

  const sse = openSse(res);
  const emit = (ev: AskEvent) => sse.send(ev);

  try {
    const grounding = await ensureGrounding(market, emit);
    await runAsk(market, grounding, question, emit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'ask failed';
    sse.send({ t: 'ask:error', error: msg, elapsedMs: 0 });
  } finally {
    sse.close();
  }
}
