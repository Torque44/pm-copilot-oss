// searchChain.test.ts — locks in the chain orchestration: skip
// unavailable backends, dedupe by URL across variants, stop at 3+ hits,
// escalate on throw, write success to cache, never cache empty.

import { describe, it, expect, vi } from 'vitest';
import { searchNews } from './searchChain';
import { NewsCache } from './cache';
import type { SearchBackend, NewsHit } from './types';

function mkBackend(
  name: SearchBackend['name'],
  hits: NewsHit[] | (() => Promise<NewsHit[]>),
  available = true,
): SearchBackend {
  return {
    name,
    available: () => available,
    search: typeof hits === 'function' ? vi.fn().mockImplementation(hits) : vi.fn().mockResolvedValue(hits),
  };
}

function hit(url: string, ts = '2026-04-15T00:00:00Z'): NewsHit {
  return {
    url,
    title: `Title for ${url}`,
    source: new URL(url).hostname.replace(/^www\./, ''),
    publishedAt: ts,
    snippet: 'snippet',
  };
}

describe('searchNews — chain orchestration', () => {
  it('returns cache hit without invoking backends', async () => {
    const cache = new NewsCache();
    cache.set('m-1', {
      kind: 'news',
      items: [{
        headline: 'cached',
        source: 's',
        url: 'https://s/1',
        publishedAt: '2026-04-01T00:00:00Z',
        snippet: '',
      }],
    });
    const exa = mkBackend('exa', []);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    expect(result).toHaveLength(1);
    expect(exa.search).not.toHaveBeenCalled();
  });

  it('stops at backend 1 when it returns 3+ hits', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://a/1'), hit('https://a/2'), hit('https://a/3')]);
    const comments = mkBackend('polymarket-comments', [hit('https://c/1')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    expect(result).toHaveLength(3);
    expect(comments.search).not.toHaveBeenCalled();
  });

  it('escalates to backend 2 when backend 1 returns < 3 hits', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://a/1')]);
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('dedupes by URL across backends and variants', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://shared/1')]);
    const comments = mkBackend('polymarket-comments', [hit('https://shared/1'), hit('https://c/2')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    const urls = result.map((h) => h.url).sort();
    expect(urls).toEqual(['https://c/2', 'https://shared/1']);
  });

  it('skips backends where available() returns false', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [], false);
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2'), hit('https://c/3')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    expect(exa.search).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
  });

  it('escalates when a backend throws', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', () => Promise.reject(new Error('boom')));
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2'), hit('https://c/3')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    expect(result).toHaveLength(3);
  });

  it('caches successful aggregate (writes to cache)', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://a/1'), hit('https://a/2'), hit('https://a/3')]);
    await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    const cached = cache.get('m-1');
    expect(cached?.items).toHaveLength(3);
  });

  it('escalates past a hung backend within the per-backend budget', async () => {
    // Reduced from the production 10s budget so the test is fast; the
    // important thing is that the never-resolving promise doesn't pin the
    // chain.
    vi.useFakeTimers();
    const cache = new NewsCache();
    const hung = mkBackend('exa', () => new Promise<NewsHit[]>(() => { /* never */ }));
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2'), hit('https://c/3')]);

    const promise = searchNews(
      { marketId: 'm-hung', title: 't' },
      [hung, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );

    // Advance through the per-backend budget (10s) PLUS slack for all 3
    // variants × backends and the inter-variant rechecks.
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;

    expect(hung.search).toHaveBeenCalled();
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.every((h) => h.url.startsWith('https://c/'))).toBe(true);
    vi.useRealTimers();
  });

  it('returns [] when all backends are empty (no cache write)', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', []);
    const comments = mkBackend('polymarket-comments', []);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30', marketTitle: 't' },
    );
    expect(result).toEqual([]);
    expect(cache.get('m-1')).toBeNull();
  });
});
