// exa.ts — Exa AI backend for the news chain. Wraps the existing Exa
// searcher with retry + maps to the unified NewsHit shape.
//
// Undated hits are dropped here (before they reach the chain) because the
// no-hallucination policy says we can't trust "fresh news" without a real
// date. Real Exa results from news endpoints always carry a date.

import { withRetry } from '../retry';
import type { SearchBackend, NewsHit, SearchOpts } from '../types';
import type { Searcher } from '../../providers/exa';

export function makeExaBackend(searcher: Searcher | null): SearchBackend {
  return {
    name: 'exa',
    available: () => searcher !== null,
    async search(query: string, opts: SearchOpts): Promise<NewsHit[]> {
      if (!searcher) return [];

      // Compute the recency window in hours. The chain pre-computes
      // windowStart/windowEnd; we derive hours from the duration. When Exa
      // adds absolute-date support, switch to that.
      const endMs = Date.parse(opts.windowEnd);
      const startMs = Date.parse(opts.windowStart);
      const windowHours = Number.isFinite(endMs) && Number.isFinite(startMs)
        ? Math.max(1, Math.ceil((endMs - startMs) / (60 * 60 * 1000)))
        : 24 * 30;

      try {
        const raw = await withRetry(
          () => searcher.search(query, {
            numResults: 10,
            recencyHours: windowHours,
            category: 'news',
            withFullText: false,
          }),
          { attempts: 3, baseDelayMs: 500, timeoutMs: 10_000 },
        );

        return raw
          .filter((h): h is typeof h & { publishedDate: string } => Boolean(h.publishedDate))
          .map((h): NewsHit => ({
            url: h.url,
            title: h.title,
            source: h.domain,
            publishedAt: h.publishedDate,
            snippet: h.snippet,
            score: h.score,
          }));
      } catch {
        // Retry exhausted — return empty. The chain escalates to the next
        // backend. We don't surface the error here because the chain has
        // its own diagnostic aggregation.
        return [];
      }
    },
  };
}
