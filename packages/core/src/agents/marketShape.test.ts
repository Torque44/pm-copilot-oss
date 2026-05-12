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

  it('parses "≥N tweets" tweet-count market', () => {
    const m = mkMarket({
      title: 'Elon Musk tweets between Apr 28 and May 4 ≥ 200',
      endDate: '2026-05-04T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.entity).toBe('elon musk');
    expect(s!.metric).toBe('tweets');
    expect(s!.comparator).toBe('>=');
    expect(s!.threshold).toBe(200);
    expect(s!.unit).toBe('tweets');
    expect(s!.window.end).toBe('2026-05-04T23:59:00Z');
  });

  it('parses "Will X tweet at least N times" phrasing', () => {
    const m = mkMarket({
      title: 'Will Elon Musk tweet at least 150 times this week?',
      endDate: '2026-05-12T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('tweets');
    expect(s!.comparator).toBe('>=');
    expect(s!.threshold).toBe(150);
  });

  it('parses "Trump tweets > 100 times by Friday"', () => {
    const m = mkMarket({
      title: 'Trump tweets > 100 times by Friday',
      endDate: '2026-05-15T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.entity).toBe('trump');
    expect(s!.metric).toBe('tweets');
    expect(s!.comparator).toBe('>');
    expect(s!.threshold).toBe(100);
  });
});
