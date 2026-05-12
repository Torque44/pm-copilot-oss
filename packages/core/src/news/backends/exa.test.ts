// exa.test.ts — wraps the Exa searcher through the SearchBackend interface
// with retry. The retry logic is already tested separately; here we focus
// on (1) the available() check, (2) the search→NewsHit mapping, (3)
// dropping undated hits (no-hallucination policy), (4) graceful empty
// on error.

import { describe, it, expect, vi } from 'vitest';
import { makeExaBackend } from './exa';
import type { Searcher, SearchHit } from '../../providers/exa';

function stubSearcher(hits: SearchHit[] | (() => Promise<SearchHit[]>)): Searcher {
  return {
    search: typeof hits === 'function'
      ? hits
      : vi.fn().mockResolvedValue(hits),
  } as unknown as Searcher;
}

describe('exaBackend', () => {
  it('available() returns false when searcher is null', () => {
    const backend = makeExaBackend(null);
    expect(backend.available()).toBe(false);
  });

  it('available() returns true when searcher is provided', () => {
    const backend = makeExaBackend(stubSearcher([]));
    expect(backend.available()).toBe(true);
  });

  it('maps Exa SearchHit → NewsHit and drops undated hits', async () => {
    const backend = makeExaBackend(stubSearcher([
      {
        url: 'https://reuters.com/a/1',
        title: 'Article 1',
        domain: 'reuters.com',
        publishedDate: '2026-04-01T00:00:00Z',
        snippet: 'snippet1',
        score: 0.9,
      },
      {
        url: 'https://cnn.com/a/2',
        title: 'Article 2',
        domain: 'cnn.com',
        publishedDate: null,  // undated → dropped
        snippet: 'snippet2',
        score: 0.7,
      },
    ]));

    const hits = await backend.search('q', {
      windowStart: '2026-03-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe('https://reuters.com/a/1');
    expect(hits[0]!.source).toBe('reuters.com');
    expect(hits[0]!.score).toBe(0.9);
  });

  it('returns empty array on transient error (retry exhausted, swallowed)', async () => {
    const failing = stubSearcher(() => Promise.reject(new Error('boom')));
    const backend = makeExaBackend(failing);
    const hits = await backend.search('q', {
      windowStart: '2026-03-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });
});
