// useBrief.test.ts — locks in the asMarket transform from server-side
// MarketMeta to UI Market. Just a focused test on resolvedAt threading —
// the rest of asMarket is exercised by the integration flow.

import { describe, it, expect } from 'vitest';
import { asMarket } from './useBrief';

describe('asMarket — resolvedAt threading', () => {
  it('extracts resolvedAt when present (resolved market)', () => {
    const raw = {
      marketId: 'm-1',
      title: 'Will X happen?',
      yes: 1.0,
      no: 0.0,
      volume24hr: 0,
      endDate: '2026-04-15T12:00:00Z',
      resolvedAt: '2026-04-15T12:00:00Z',
    };
    const m = asMarket(raw);
    expect(m?.resolvedAt).toBe('2026-04-15T12:00:00Z');
  });

  it('returns undefined resolvedAt for active markets', () => {
    const raw = {
      marketId: 'm-1',
      title: 'Will X happen?',
      yes: 0.5,
      no: 0.5,
      volume24hr: 1000,
      endDate: '2026-06-30T23:59:00Z',
      resolvedAt: null,
    };
    const m = asMarket(raw);
    expect(m?.resolvedAt).toBeUndefined();
  });
});
