// searchChain.ts — the news self-healing orchestrator. Tries each
// available backend with up to 3 query variants until the aggregate
// reaches a satisfaction threshold (≥3 hits). Caches successful results.
// Dedupes by URL across variants and backends.
//
// Per-backend and total chain budgets bound wall-clock so a slow-but-
// not-erroring backend can't gate the whole news panel forever. Budget
// exceeded → use whatever we have and stop.

import type { NewsCache } from './cache';
import type { SearchBackend, NewsHit, SearchOpts } from './types';
import type { NewsGrounding, NewsItem } from '../agents/types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'will', 'in', 'on', 'by', 'before', 'after',
  'between', 'of', 'to', 'is', 'are', 'be', 'and', 'or', 'for',
]);

const PER_BACKEND_BUDGET_MS = 10_000;
const TOTAL_CHAIN_BUDGET_MS = 25_000;
const SATISFACTION_THRESHOLD = 3;

export type ChainOpts = SearchOpts;

export async function searchNews(
  market: { marketId: string; title: string; slug?: string },
  backends: SearchBackend[],
  cache: NewsCache,
  opts: ChainOpts,
): Promise<NewsHit[]> {
  // 1. Cache check (skips the whole chain on hit).
  const cached = cache.get(market.marketId);
  if (cached) {
    return cached.items.map((it): NewsHit => ({
      url: it.url,
      title: it.headline,
      source: it.source,
      publishedAt: it.publishedAt ?? '',
      snippet: it.snippet ?? '',
    }));
  }

  // 2. Run the chain.
  const aggregate: NewsHit[] = [];
  const seen = new Set<string>();
  const chainStart = Date.now();
  const variants = buildQueryVariants(market.title);

  for (const backend of backends.filter((b) => b.available())) {
    if (Date.now() - chainStart > TOTAL_CHAIN_BUDGET_MS) break;
    if (aggregate.length >= SATISFACTION_THRESHOLD) break;

    const backendStart = Date.now();
    for (const query of variants) {
      if (Date.now() - backendStart > PER_BACKEND_BUDGET_MS) break;
      if (aggregate.length >= SATISFACTION_THRESHOLD) break;

      try {
        const hits = await backend.search(query, {
          windowStart: opts.windowStart,
          windowEnd: opts.windowEnd,
          marketTitle: market.title,
        });
        for (const h of hits) {
          if (!h.url || !h.publishedAt) continue;
          if (seen.has(h.url)) continue;
          seen.add(h.url);
          aggregate.push(h);
        }
      } catch {
        // Per-backend failure → escalate to next variant or backend.
        // We don't log here because the backend itself owns its
        // classification (it already returns [] on retry exhaustion).
      }
    }
  }

  // 3. Cache successful aggregate (the cache itself refuses empties).
  if (aggregate.length > 0) {
    cache.set(market.marketId, hitsToGrounding(aggregate));
  }

  return aggregate;
}

export function buildQueryVariants(marketTitle: string): string[] {
  const bare = bareKeywords(marketTitle, 6);
  const broad = marketTitle
    .replace(/\([^)]*\)/g, '')
    .replace(/[—:].*$/, '')
    .replace(/\b(before|after|by|between|on|in)\s+\w+\s+\d+\s*,?\s*\d{0,4}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [
    `${marketTitle} — recent news, scheduled events, background`,
    broad && broad !== marketTitle ? broad : `${marketTitle} news`,
    bare,
  ];
}

function bareKeywords(title: string, max: number): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, max)
    .join(' ');
}

function hitsToGrounding(hits: NewsHit[]): NewsGrounding {
  const items: NewsItem[] = hits.map((h) => ({
    headline: h.title,
    source: h.source,
    url: h.url,
    publishedAt: h.publishedAt,
    snippet: h.snippet,
    relevance: h.score != null && h.score > 0.7 ? 'high'
      : h.score != null && h.score > 0.4 ? 'med' : 'low',
    from: 'web' as const,
  }));
  return { kind: 'news', items };
}
