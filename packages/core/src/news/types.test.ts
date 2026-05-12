// types.test.ts — sanity check that the interfaces exist and can be
// implemented. Compilation = the real test for type files.

import { describe, it, expect } from 'vitest';
import type { NewsHit, SearchBackend } from './types';

describe('news/types', () => {
  it('NewsHit has required fields and can be constructed', () => {
    const hit: NewsHit = {
      url: 'https://example.com/article',
      title: 'Article title',
      source: 'example.com',
      publishedAt: '2026-04-01T00:00:00Z',
      snippet: 'Article snippet.',
    };
    expect(hit.url).toBe('https://example.com/article');
  });

  it('SearchBackend can be implemented', async () => {
    const backend: SearchBackend = {
      name: 'exa',
      available: () => false,
      search: async () => [],
    };
    expect(backend.name).toBe('exa');
    expect(backend.available()).toBe(false);
    expect(await backend.search('q', { windowStart: '2026-01-01', windowEnd: '2026-04-01', marketTitle: 't' })).toEqual([]);
  });
});
