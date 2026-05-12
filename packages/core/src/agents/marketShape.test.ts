// marketShape.test.ts — locks in the deterministic regex parser that
// extracts {entity, metric, comparator, threshold, window} from a market's
// title + resolution text. No LLM. No network. Pure function.

import { describe, it, expect } from 'vitest';
import { parseMarketShape } from './marketShape';
import type { MarketMeta } from './types';

// Minimal MarketMeta builder for tests — only the fields the parser reads.
function mkMarket(over: Partial<MarketMeta>): MarketMeta {
  return {
    marketId: 'test-id',
    eventId: 'test-event',
    venue: 'polymarket',
    title: '',
    category: 'other',
    yes: 0.5,
    no: 0.5,
    volume24hr: 0,
    volumeTotal: 0,
    endDate: '2026-06-30',
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'test-slug',
    ...over,
  };
}

describe('parseMarketShape', () => {
  it('returns null for an empty title', () => {
    const m = mkMarket({ title: '' });
    expect(parseMarketShape(m)).toBeNull();
  });
});
