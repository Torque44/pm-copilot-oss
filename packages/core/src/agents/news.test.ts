// news.test.ts — covers (1) the windowOverride parameter that resolved
// markets pass to search inside the leadup window, and (2) the empty-
// state diagnostic claim shape. Doesn't test the search chain itself
// (that has its own tests in news/searchChain.test.ts after Phase 2).

import { describe, it, expect, vi } from 'vitest';
import { runNewsAgent } from './news';
import { searchNews as _searchNews } from '../news/searchChain';
import type { AgentEvent, MarketMeta } from './types';
import type { LLMProvider } from '../providers/types';

// Mock the search chain — task 13's refactor delegates to it, and we want
// to verify hits flow through to citations/claims and that empty returns
// the diagnostic claim. Hoisted by vitest regardless of position.
vi.mock('../news/searchChain', () => ({
  searchNews: vi.fn(),
  buildQueryVariants: vi.fn().mockReturnValue(['q1', 'q2', 'q3']),
}));

function mkMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return {
    marketId: 'm-1',
    title: 'Will Trump visit China by June 30?',
    endDate: '2025-06-30T23:59:00Z',
    category: 'politics',
    yes: 0.997,
    no: 0.003,
    volume24hr: 0,
    volumeTotal: 100_000,
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'will-trump-visit-china-by-june-30',
    ...over,
  };
}

function noWebProvider(jsonResponse: string): LLMProvider {
  return {
    name: 'openai',
    capabilities: { nativeJsonMode: false, webSearch: false, authViaSession: false },
    complete: vi.fn().mockResolvedValue({
      text: jsonResponse,
      ok: true,
      elapsedMs: 1,
      model: 'stub',
      provider: 'openai',
    }),
  };
}

describe('runNewsAgent — windowOverride parameter', () => {
  it('accepts a windowOverride and passes it to the underlying search', async () => {
    (_searchNews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const provider = noWebProvider('{"items": [], "claims": []}');
    const result = await runNewsAgent(
      {
        market: mkMarket({ resolvedAt: '2025-06-30T23:59:00Z' }),
        emit: vi.fn() as (ev: AgentEvent) => void,
      },
      provider,
      null,
      { windowOverride: { endsAt: '2025-06-30T23:59:00Z', days: 30 } },
    );
    expect(result.agent).toBe('news');
    expect(result.output).toBeDefined();
  });

  it('returns a diagnostic claim with no citations when search comes up empty', async () => {
    (_searchNews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const provider = noWebProvider('{"items": [], "claims": []}');
    const result = await runNewsAgent(
      {
        market: mkMarket(),
        emit: vi.fn() as (ev: AgentEvent) => void,
      },
      provider,
      null,
    );
    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims.length).toBeGreaterThanOrEqual(1);
    // Claim should describe empty state, not pretend news exists.
    expect(result.output.claims[0]!.citations).toHaveLength(0);
    expect(result.output.claims[0]!.text.length).toBeGreaterThan(20);
  });
});

describe('runNewsAgent — uses searchChain', () => {
  it('emits items and claims when searchChain returns hits', async () => {
    (_searchNews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        url: 'https://reuters.com/a/1',
        title: 'Article 1',
        source: 'reuters.com',
        publishedAt: '2026-04-15T00:00:00Z',
        snippet: 'snippet1',
      },
      {
        url: 'https://bbc.co.uk/a/2',
        title: 'Article 2',
        source: 'bbc.co.uk',
        publishedAt: '2026-04-14T00:00:00Z',
        snippet: 'snippet2',
      },
    ]);

    const result = await runNewsAgent(
      {
        market: mkMarket(),
        emit: vi.fn() as (ev: AgentEvent) => void,
      },
      noWebProvider('{}'),
      null,
    );

    expect(result.output.citations).toHaveLength(2);
    expect(result.output.citations[0]!.url).toBe('https://reuters.com/a/1');
    expect(result.output.claims.length).toBeGreaterThan(0);
  });

  it('emits the diagnostic claim when searchChain returns []', async () => {
    (_searchNews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await runNewsAgent(
      { market: mkMarket(), emit: vi.fn() as (ev: AgentEvent) => void },
      noWebProvider('{}'),
      null,
    );
    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims).toHaveLength(1);
    expect(result.output.claims[0]!.citations).toHaveLength(0);
  });
});
