// cache.test.ts — locks in TTL hit/miss + LRU eviction + the "don't cache
// empty results" rule. Caching empty would mean "we tried, nothing here,
// don't try again for 6h" — which is the opposite of self-healing. Only
// successful searches get cached.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NewsCache } from './cache';
import type { NewsGrounding } from '../agents/types';

function mkGrounding(items: number): NewsGrounding {
  return {
    kind: 'news',
    items: Array.from({ length: items }, (_, i) => ({
      headline: `Article ${i}`,
      source: 'reuters.com',
      url: `https://reuters.com/a/${i}`,
      publishedAt: '2026-04-01T00:00:00Z',
      snippet: 'snippet',
    })),
  };
}

describe('NewsCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on miss', () => {
    const c = new NewsCache();
    expect(c.get('m-1')).toBeNull();
  });

  it('returns grounding on hit within TTL', () => {
    const c = new NewsCache();
    c.set('m-1', mkGrounding(3));
    expect(c.get('m-1')?.items).toHaveLength(3);
  });

  it('returns null after TTL expires (6h)', () => {
    const c = new NewsCache();
    c.set('m-1', mkGrounding(3));
    vi.setSystemTime(new Date('2026-05-12T06:00:01Z'));
    expect(c.get('m-1')).toBeNull();
  });

  it('refuses to cache an empty grounding (self-healing: try again next time)', () => {
    const c = new NewsCache();
    c.set('m-1', { kind: 'news', items: [] });
    expect(c.get('m-1')).toBeNull();
  });

  it('evicts oldest when over capacity', () => {
    const c = new NewsCache({ maxEntries: 2 });
    c.set('m-1', mkGrounding(1));
    c.set('m-2', mkGrounding(1));
    c.set('m-3', mkGrounding(1));
    expect(c.get('m-1')).toBeNull(); // evicted
    expect(c.get('m-2')).not.toBeNull();
    expect(c.get('m-3')).not.toBeNull();
  });

  it('promotes entries on get (LRU)', () => {
    const c = new NewsCache({ maxEntries: 2 });
    c.set('m-1', mkGrounding(1));
    c.set('m-2', mkGrounding(1));
    c.get('m-1'); // promotes m-1 to most-recently-used
    c.set('m-3', mkGrounding(1));
    expect(c.get('m-1')).not.toBeNull();
    expect(c.get('m-2')).toBeNull(); // evicted now
    expect(c.get('m-3')).not.toBeNull();
  });
});
