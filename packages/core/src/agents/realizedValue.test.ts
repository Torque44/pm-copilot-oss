// realizedValue.test.ts — tests the three-tier extractor that pulls a
// realized number from a resolved comparable. Tiers: (1) Gamma note text,
// (2) outcome+threshold inference, (3) empty. No external APIs.

import { describe, it, expect } from 'vitest';
import { extractRealizedValue } from './realizedValue';
import type { ComparableHit } from './comparables';
import type { MarketShape } from './marketShape';

const shape: MarketShape = {
  entity: 'elon musk',
  metric: 'tweets',
  comparator: '>=',
  threshold: 200,
  unit: 'tweets',
  window: { start: null, end: '2026-04-27T23:59:00Z' },
  source: { titlePart: 'Elon Musk tweets ≥ 200 between Apr 21 and Apr 27' },
};

function mkComp(over: Partial<ComparableHit> & { payload?: unknown } = {}): ComparableHit {
  return {
    eventId: 'evt-1',
    title: 'Elon Musk tweets ≥ 200 between Apr 21 and Apr 27',
    endDate: '2026-04-27T23:59:00Z',
    outcome: 'yes',
    resolvedPrice: 0.97,
    score: 5.5,
    ...over,
  };
}

describe('extractRealizedValue', () => {
  it('parses "settled at N" from Gamma description', () => {
    const comp = mkComp({
      payload: { description: 'This market settled at 213 tweets as of Apr 27 UTC.' } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(213);
    expect(r.source).toBe('gamma-note');
    expect(r.display).toBe('213 tweets');
  });

  it('parses "final count: N" from Gamma description', () => {
    const comp = mkComp({
      payload: { description: 'Final count: 178. Resolved YES.' } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(178);
    expect(r.source).toBe('gamma-note');
  });

  it('infers ">= threshold" when YES outcome with no parseable note', () => {
    const comp = mkComp({
      outcome: 'yes',
      payload: { description: 'Market resolved YES.' } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBeNull();
    expect(r.source).toBe('inferred-from-outcome');
    expect(r.display).toBe('≥ 200 tweets');
  });

  it('infers "< threshold" when NO outcome with no parseable note', () => {
    const comp = mkComp({
      outcome: 'no',
      resolvedPrice: 0.04,
      payload: { description: 'Market resolved NO.' } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBeNull();
    expect(r.source).toBe('inferred-from-outcome');
    expect(r.display).toBe('< 200 tweets');
  });

  it('returns unknown when shape is null and no parseable note', () => {
    const comp = mkComp({ outcome: 'unresolved', payload: undefined });
    const r = extractRealizedValue(comp, null);
    expect(r.value).toBeNull();
    expect(r.source).toBe('unknown');
    expect(r.display).toBeNull();
  });

  it('parses "high of N°F" for temperature markets', () => {
    const tempShape: MarketShape = {
      ...shape,
      metric: 'temperature',
      threshold: 95,
      unit: '°F',
    };
    const comp = mkComp({
      payload: { description: 'High of 97°F recorded at LGA on Jun 12.' } as unknown,
    });
    const r = extractRealizedValue(comp, tempShape);
    expect(r.value).toBe(97);
    expect(r.display).toBe('97°F');
  });

  it('does not grab an incidental tweet count appearing in description prose', () => {
    // Description mentions "50 tweets" incidentally before the real
    // resolution number. The anchored 'tweets' pattern should NOT match
    // the bare "50 tweets" — but P0 ("settled at N") should fire on the
    // real number. Verify tier-1 picks the right one.
    const comp = mkComp({
      payload: {
        description: 'A user noted 50 tweets in the comments earlier. Market settled at 213 as of Apr 27 UTC.'
      } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(213); // not 50
    expect(r.source).toBe('gamma-note');
  });

  it('matches anchored "recorded N tweets" phrasing', () => {
    const comp = mkComp({
      payload: {
        description: 'Musk recorded 187 tweets during the window.'
      } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(187);
  });

  it('reads top-level description (the real ComparableHit shape)', () => {
    const comp = mkComp({
      description: 'Market settled at 199 tweets — resolved NO.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(199);
    expect(r.source).toBe('gamma-note');
  });

  it('reads top-level resolutionWording when description is absent', () => {
    const comp = mkComp({
      resolutionWording: 'Recorded 144 tweets over the window.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(144);
    expect(r.source).toBe('gamma-note');
  });
});
