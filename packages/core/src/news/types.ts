// types.ts — shared types for the news self-healing search chain.
// Backends produce NewsHit[]; the chain filters + caches + emits.

export type NewsHit = {
  url: string;
  title: string;
  /** Domain only (e.g. "reuters.com") — used for the source pill in the UI. */
  source: string;
  /** ISO timestamp. REQUIRED — undated hits are dropped at the chain
   *  boundary because they're the #1 signal of LLM fabrication. */
  publishedAt: string;
  /** 1-2 sentence excerpt explaining why this matters. */
  snippet: string;
  /** Backend-specific relevance, 0..1. Optional. */
  score?: number;
};

export type SearchOpts = {
  /** ISO date — inclusive search window start. */
  windowStart: string;
  /** ISO date — inclusive search window end. */
  windowEnd: string;
  /** Full market title; some backends use it as additional context. */
  marketTitle: string;
};

export type SearchBackend = {
  name: 'exa' | 'polymarket-comments' | 'provider-web';
  /** Synchronous capability check. False if the backend can't run in the
   *  current environment (no API key, no provider support). The chain
   *  skips false backends without invoking them. */
  available(): boolean;
  search(query: string, opts: SearchOpts): Promise<NewsHit[]>;
};
