// polymarket.test.ts — locks in the resolvedAt population from gamma's
// `closed` flag. The agent supervisor branches on this, so a regression
// silently runs sentiment/thesis on settled markets — the exact bug this
// fix is meant to prevent.

import { describe, it, expect } from 'vitest';
import { gammaToMarketMeta, type GammaEvent, type GammaMarket } from './polymarket';

function mkMarket(over: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: 'm-1',
    question: 'Will X happen by date?',
    slug: 'will-x-happen-by-date',
    endDate: '2026-04-30T23:59:00Z',
    closed: false,
    active: true,
    conditionId: '0xabc',
    clobTokenIds: '["tyes","tno"]',
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.5","0.5"]',
    volume24hr: 1000,
    volume: '50000',
    ...over,
  };
}

function mkEvent(over: Partial<GammaEvent> = {}): GammaEvent {
  return {
    id: 'e-1',
    ticker: 'will-x',
    title: 'Will X happen?',
    slug: 'will-x-happen',
    endDate: '2026-04-30T23:59:00Z',
    description: 'The market resolves YES if X happens by the deadline.',
    resolutionSource: 'UMA oracle',
    closed: false,
    active: true,
    volume: 50_000,
    markets: [],
    ...over,
  };
}

describe('gammaToMarketMeta — eventSlug', () => {
  it('exposes the parent event slug for the trade-on-polymarket link', () => {
    // Multi-outcome events have per-candidate sub-market slugs that 404 on
    // polymarket.com/event/<slug>. The event slug always resolves.
    const m = mkMarket({ slug: 'will-kimi-antonelli-be-the-2026-f1-drivers-champion' });
    const e = mkEvent({ slug: '2026-f1-drivers-champion' });
    const meta = gammaToMarketMeta(e, m, 'sports');
    expect(meta.slug).toBe('will-kimi-antonelli-be-the-2026-f1-drivers-champion');
    expect(meta.eventSlug).toBe('2026-f1-drivers-champion');
  });
});

describe('gammaToMarketMeta — resolvedAt', () => {
  it('sets resolvedAt to endDate when market is closed', () => {
    const m = mkMarket({ closed: true, endDate: '2026-04-15T12:00:00Z' });
    const meta = gammaToMarketMeta(mkEvent(), m, 'other');
    expect(meta.resolvedAt).toBe('2026-04-15T12:00:00Z');
  });

  it('sets resolvedAt to null when market is still open', () => {
    const m = mkMarket({ closed: false });
    const meta = gammaToMarketMeta(mkEvent(), m, 'other');
    expect(meta.resolvedAt).toBeNull();
  });

  it('falls back to event endDate when market endDate is empty on a closed market', () => {
    const m = mkMarket({ closed: true, endDate: '' });
    const e = mkEvent({ endDate: '2026-04-10T00:00:00Z' });
    const meta = gammaToMarketMeta(e, m, 'other');
    expect(meta.resolvedAt).toBe('2026-04-10T00:00:00Z');
  });

  it('returns null when closed=true but both endDates are missing', () => {
    const m = mkMarket({ closed: true, endDate: '' });
    const e = mkEvent({ endDate: '' });
    const meta = gammaToMarketMeta(e, m, 'other');
    expect(meta.resolvedAt).toBeNull();
  });
});
