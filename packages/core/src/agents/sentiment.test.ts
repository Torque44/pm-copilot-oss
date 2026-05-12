// sentiment.test.ts — locks in (1) URL provenance: model-emitted tweets
// must match Grok's actual citations, anything else dropped; (2) Pass-1-
// empty: no citations from Grok → honest empty, skip Pass 2; (3) safety
// net: URLs in claim text outside the registry → claim dropped.

import { describe, it, expect, vi } from 'vitest';
import { runSentimentAgent } from './sentiment';
import type { LLMProvider, CompleteResult } from '../providers/types';
import type { AgentContext, MarketMeta } from './types';

function mkMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return {
    marketId: 'm-1',
    title: 'Will Trump visit China by June 30?',
    endDate: '2025-06-30T23:59:00Z',
    category: 'politics',
    yes: 0.5,
    no: 0.5,
    volume24hr: 0,
    volumeTotal: 100_000,
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'will-trump-visit-china-by-june-30',
    ...over,
  };
}

function mkResult(over: Partial<CompleteResult>): CompleteResult {
  return {
    text: '',
    ok: true,
    elapsedMs: 100,
    model: 'grok-stub',
    provider: 'xai' as 'perplexity',
    ...over,
  };
}

function ctx(): AgentContext {
  return { market: mkMarket(), emit: vi.fn() };
}

describe('runSentimentAgent — Pass 1 captures Grok citations', () => {
  it('returns honest empty when Pass 1 returns no citations', async () => {
    const provider: LLMProvider = {
      name: 'xai' as 'perplexity',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(mkResult({ text: 'no relevant tweets found', citations: [] })),
    };

    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });

    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims).toHaveLength(1);
    expect(result.output.claims[0]!.text).toMatch(/no recent X conversation/i);
    // Pass 2 must not have been called
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('builds citation registry from Grok citation URLs and only allowlisted handles', async () => {
    // Pass 1: returns 2 citations — one allowlisted handle (@Reuters), one
    // off-allowlist (@randomguy). Pass 2: returns claims citing kol·1.
    const pass1 = mkResult({
      text: 'found tweets',
      citations: [
        'https://x.com/Reuters/status/1700000000001',
        'https://x.com/randomguy/status/1700000000002',
      ],
    });
    const pass2 = mkResult({
      text: JSON.stringify({
        claims: [{ text: 'Reuters reports diplomatic progress [kol·1]', citations: ['kol·1'] }],
        lean: 'unclear',
        confidence: 'low',
      }),
    });
    const provider: LLMProvider = {
      name: 'xai' as 'perplexity',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(pass1).mockResolvedValueOnce(pass2),
    };

    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });

    // Only the Reuters citation survives (handle is allowlisted)
    expect(result.output.citations).toHaveLength(1);
    expect(result.output.citations[0]!.label).toBe('@Reuters');
    expect(result.output.citations[0]!.url).toBe('https://x.com/Reuters/status/1700000000001');
    expect(result.output.claims[0]!.citations).toEqual(['kol·1']);
  });

  it('drops claims that contain URLs not in the registry (safety net)', async () => {
    const pass1 = mkResult({
      text: 'found',
      citations: ['https://x.com/Reuters/status/1700000000001'],
    });
    const pass2 = mkResult({
      text: JSON.stringify({
        claims: [
          { text: 'Real reference [kol·1]', citations: ['kol·1'] },
          // This claim leaks a URL that wasn't in Pass 1 — should be dropped.
          { text: 'Fake reference: https://x.com/Fake/status/9999 [kol·1]', citations: ['kol·1'] },
        ],
      }),
    });
    const provider: LLMProvider = {
      name: 'xai' as 'perplexity',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(pass1).mockResolvedValueOnce(pass2),
    };

    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });
    expect(result.output.claims).toHaveLength(1);
    expect(result.output.claims[0]!.text).toBe('Real reference [kol·1]');
  });

  it('returns honest empty when Grok citations all have off-allowlist handles', async () => {
    const pass1 = mkResult({
      text: 'found',
      citations: ['https://x.com/randomguy/status/1', 'https://x.com/anotherguy/status/2'],
    });
    const provider: LLMProvider = {
      name: 'xai' as 'perplexity',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(pass1),
    };
    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });
    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims[0]!.text).toMatch(/no recent X conversation/i);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});
