// polymarketComments.test.ts — covers URL extraction from comment bodies,
// dedupe by URL, snippet trimming, and the available() guard (slug is
// required to even attempt this backend).
//
// This is a parser-level test — we mock the fetch() that pulls comments.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePolymarketCommentsBackend } from './polymarketComments';

describe('polymarketCommentsBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('available() is true — per-call slug determines runnable', () => {
    const backend = makePolymarketCommentsBackend({ slugFor: () => null });
    expect(backend.available()).toBe(true);
  });

  it('returns empty when the slug-provider returns null', async () => {
    const backend = makePolymarketCommentsBackend({ slugFor: () => null });
    const hits = await backend.search('q', {
      windowStart: '2026-01-01',
      windowEnd: '2026-04-01',
      marketTitle: 'Will Trump visit China by June 30?',
    });
    expect(hits).toEqual([]);
  });

  it('extracts URLs from comment bodies and dedupes by URL', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        comments: [
          {
            body: 'Per CNBC: https://cnbc.com/article/123 looks bullish.',
            createdAt: '2026-04-10T00:00:00Z',
          },
          {
            body: 'And BBC https://bbc.co.uk/news/abc — also covers it.',
            createdAt: '2026-04-11T00:00:00Z',
          },
          {
            // duplicate URL — should be deduped
            body: 'Already posted: https://cnbc.com/article/123',
            createdAt: '2026-04-12T00:00:00Z',
          },
        ],
      }),
    });

    const backend = makePolymarketCommentsBackend({ slugFor: () => 'will-trump-visit-china-by-june-30' });
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 'Will Trump visit China by June 30?',
    });

    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.url).sort()).toEqual([
      'https://bbc.co.uk/news/abc',
      'https://cnbc.com/article/123',
    ]);
    expect(hits.find((h) => h.url.includes('cnbc'))?.source).toBe('cnbc.com');
    expect(hits.find((h) => h.url.includes('cnbc'))?.publishedAt).toBe('2026-04-10T00:00:00Z');
  });

  it('returns empty when fetch fails (graceful escalation)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const backend = makePolymarketCommentsBackend({ slugFor: () => 'slug' });
    const hits = await backend.search('q', {
      windowStart: '2026-01-01',
      windowEnd: '2026-04-01',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });

  it('returns empty when fetch returns non-ok (e.g., 404 — endpoint auth-walled)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const backend = makePolymarketCommentsBackend({ slugFor: () => 'slug' });
    const hits = await backend.search('q', {
      windowStart: '2026-01-01',
      windowEnd: '2026-04-01',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });
});
