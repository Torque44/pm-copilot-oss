// Exa AI — web search provider for grounded research.
//
// Used as a SILENT default when the user hasn't BYOK'd Perplexity. The
// news + ask agents call `searcher.search(query, opts)` to get freshly-
// crawled hits with URL, title, published date, and a content highlight.
// The downstream LLM provider (OpenAI / Claude / Gemini / xAI) does the
// synthesis — Exa is NOT an LLM, so it does NOT implement the
// LLMProvider interface. It implements `Searcher` instead.
//
// Routing precedence (see byok.ts → news agent):
//   1. User-registered MCP feed for news (if any)
//   2. provider.capabilities.webSearch === true (Perplexity native)
//   3. Exa searcher (silent server default, this module)
//   4. Training-data fallback (existing behaviour)
//
// API: Exa REST endpoint. We use the official `exa-js` SDK for ergonomic
// types, but the only methods we touch are `searchAndContents()` and
// optionally `findSimilarAndContents()`. Auth is `EXA_API_KEY` env var.
//
// Cost: $7/1k base + $1/1k for content extraction (text/highlights).
// Free tier ~1000 searches/month covers the public-demo footprint with
// caching. See `cache` parameter on `search()` for ad-hoc memoisation.

import Exa from 'exa-js';

export type SearchHit = {
  url: string;
  title: string;
  domain: string;
  publishedDate: string | null;
  score: number;
  /** First highlight sentence (or text head) — short copy for the brief. */
  snippet: string;
  /** Full extracted content if `withFullText` was requested. */
  text?: string;
};

export type SearchOpts = {
  /** Max hits to return. Defaults to 8. */
  numResults?: number;
  /** "last N hours" filter — translated to startPublishedDate. */
  recencyHours?: number;
  /** Allowlist of domains; if set, results outside the list are dropped. */
  includeDomains?: string[];
  /** Denylist of domains; merged with the global DENYLIST. */
  excludeDomains?: string[];
  /** Optional category hint. */
  category?: 'news' | 'company' | 'research paper' | 'financial report';
  /** When true, ask Exa to return up to 2000 chars of extracted text. */
  withFullText?: boolean;
};

export interface Searcher {
  /** Search the web. Returns hits sorted by Exa's relevance score. */
  search(query: string, opts?: SearchOpts): Promise<SearchHit[]>;
  /** Find articles similar to a given URL. Useful for "what else has been
   *  written about this market". */
  findSimilar?(url: string, opts?: SearchOpts): Promise<SearchHit[]>;
}

// Sources we never want surfaced regardless of category — user-editable or
// aggregator content that breaks the trader-grade-citations contract. The
// brief's downstream allowlist filter catches any survivors per sub-category,
// but pre-filtering at search time saves an Exa call's worth of irrelevant
// hits.
const GLOBAL_DENYLIST = [
  'wikipedia.org',
  'en.wikipedia.org',
  'medium.com',
  'reddit.com',
  'old.reddit.com',
  'substack.com',
  'yahoo.com',
  'finance.yahoo.com',
];

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Build a Searcher backed by Exa. Returns null when no API key is
 *  available — callers can detect "Exa unavailable" and gracefully fall
 *  back to other paths. */
export function makeExaSearcher(apiKey?: string | null): Searcher | null {
  const key = apiKey || process.env['EXA_API_KEY'];
  if (!key) return null;
  const client = new Exa(key);

  return {
    async search(query: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
      const startPublishedDate = opts.recencyHours
        ? new Date(Date.now() - opts.recencyHours * 3_600_000).toISOString()
        : undefined;

      const reqOpts: Parameters<typeof client.searchAndContents>[1] = {
        type: 'auto',
        numResults: opts.numResults ?? 8,
        ...(opts.category ? { category: opts.category } : {}),
        ...(startPublishedDate ? { startPublishedDate } : {}),
        ...(opts.includeDomains?.length ? { includeDomains: opts.includeDomains } : {}),
        excludeDomains: [...GLOBAL_DENYLIST, ...(opts.excludeDomains ?? [])],
        highlights: { numSentences: 3, highlightsPerUrl: 1 },
        ...(opts.withFullText ? { text: { maxCharacters: 2000 } } : {}),
      };

      const res = await client.searchAndContents(query, reqOpts);
      type R = {
        url: string;
        title?: string;
        publishedDate?: string;
        score?: number;
        text?: string;
        highlights?: string[];
      };
      const hits: SearchHit[] = (res.results as R[]).map((r) => ({
        url: r.url,
        title: r.title ?? '',
        domain: domainOf(r.url),
        publishedDate: r.publishedDate ?? null,
        score: r.score ?? 0,
        snippet: r.highlights?.[0] ?? r.text?.slice(0, 280) ?? '',
        ...(r.text ? { text: r.text } : {}),
      }));
      return hits;
    },

    async findSimilar(url: string, opts: SearchOpts = {}): Promise<SearchHit[]> {
      const reqOpts: Parameters<typeof client.findSimilarAndContents>[1] = {
        numResults: opts.numResults ?? 6,
        excludeDomains: [...GLOBAL_DENYLIST, ...(opts.excludeDomains ?? [])],
        highlights: { numSentences: 3, highlightsPerUrl: 1 },
      };
      const res = await client.findSimilarAndContents(url, reqOpts);
      type R = {
        url: string;
        title?: string;
        publishedDate?: string;
        score?: number;
        highlights?: string[];
      };
      return (res.results as R[]).map((r) => ({
        url: r.url,
        title: r.title ?? '',
        domain: domainOf(r.url),
        publishedDate: r.publishedDate ?? null,
        score: r.score ?? 0,
        snippet: r.highlights?.[0] ?? '',
      }));
    },
  };
}
