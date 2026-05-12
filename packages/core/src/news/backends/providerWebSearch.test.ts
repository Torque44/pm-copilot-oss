// providerWebSearch.test.ts — covers (1) available() returns false when
// provider lacks webSearch capability, (2) JSON parsing from a happy-path
// response, (3) graceful empty on parse failure.

import { describe, it, expect, vi } from 'vitest';
import { makeProviderWebSearchBackend } from './providerWebSearch';
import type { LLMProvider } from '../../providers/types';

function stubProvider(opts: { webSearch: boolean; text: string; ok?: boolean }): LLMProvider {
  return {
    name: 'anthropic',
    capabilities: { nativeJsonMode: false, webSearch: opts.webSearch, authViaSession: false },
    complete: vi.fn().mockResolvedValue({
      text: opts.text,
      ok: opts.ok ?? true,
      elapsedMs: 100,
      model: 'stub',
      provider: 'anthropic',
    }),
  };
}

describe('providerWebSearchBackend', () => {
  it('available() returns false when provider lacks webSearch', () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: false, text: '{}' }));
    expect(backend.available()).toBe(false);
  });

  it('available() returns true when provider has webSearch', () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: '{}' }));
    expect(backend.available()).toBe(true);
  });

  it('parses provider JSON response into NewsHits', async () => {
    const json = JSON.stringify({
      items: [
        {
          url: 'https://reuters.com/a/1',
          title: 'Trump-Xi meeting confirmed',
          source: 'reuters.com',
          publishedAt: '2026-04-15T00:00:00Z',
          snippet: 'Officials confirm visit.',
        },
        {
          url: 'https://bbc.co.uk/news/2',
          title: 'No date set yet',
          source: 'bbc.co.uk',
          // no publishedAt — dropped
          snippet: 'Speculation.',
        },
      ],
    });
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: json }));
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe('https://reuters.com/a/1');
  });

  it('returns empty on unparseable response', async () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: 'not json' }));
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });

  it('returns empty when provider call fails (ok=false)', async () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: '', ok: false }));
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });
});
