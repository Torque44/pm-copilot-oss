// cache.ts — LRU + TTL cache for news groundings. The whole point of this
// cache is that ~1% transient backend failures stay invisible to users —
// if we found news for a market 5 minutes ago, we still have it now.
//
// CRITICAL: we never cache empty groundings. An empty result means "the
// chain tried hard and came up empty." Caching that would mean every
// subsequent user sees the same empty for 6h — the opposite of self-
// healing. Empties retry; only successes cache.

import type { NewsGrounding } from '../agents/types';

type CacheEntry = { fetchedAt: number; grounding: NewsGrounding };

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_MAX_ENTRIES = 500;

export type NewsCacheOpts = {
  ttlMs?: number;
  maxEntries?: number;
};

export class NewsCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(opts: NewsCacheOpts = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(marketId: string): NewsGrounding | null {
    const entry = this.store.get(marketId);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.store.delete(marketId);
      return null;
    }
    // LRU promote: re-insertion moves the key to the tail of the iteration
    // order, which is what Map iteration guarantees in JS.
    this.store.delete(marketId);
    this.store.set(marketId, entry);
    return entry.grounding;
  }

  set(marketId: string, grounding: NewsGrounding): void {
    // Self-healing rule: don't cache empty. Next request gets to retry.
    if (!grounding.items || grounding.items.length === 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(marketId, { fetchedAt: Date.now(), grounding });
  }
}
