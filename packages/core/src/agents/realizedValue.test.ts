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
  it('parses "recorded N tweets" from Gamma description (tweets-anchored)', () => {
    const comp = mkComp({
      payload: { description: 'Musk recorded 213 tweets as of Apr 27 UTC.' } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBe(213);
    expect(r.source).toBe('gamma-note');
    expect(r.display).toBe('213 tweets');
  });

  it('falls through to inferred when description has no tweets-anchored count', () => {
    // "final count: N" and "settled at N" no longer match — they aren't
    // anchored by the metric noun and would false-positive on prices/percents.
    const comp = mkComp({
      payload: { description: 'Final count: 178. Resolved YES.' } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.value).toBeNull();
    expect(r.source).toBe('inferred-from-outcome');
    expect(r.display).toBe('≥ 200 tweets');
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
    // "50 tweets" doesn't match the anchored regex (needs preceding verb).
    // "settled at 213" also doesn't match (no metric noun anchor).
    // Falls through to inferred-from-outcome.
    const comp = mkComp({
      payload: {
        description: 'A user noted 50 tweets in the comments earlier. Market settled at 213 as of Apr 27 UTC.'
      } as unknown,
    });
    const r = extractRealizedValue(comp, shape);
    expect(r.source).toBe('inferred-from-outcome');
    expect(r.value).toBeNull();
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
    // Uses tweets-anchored phrasing so shape-aware regex fires.
    const comp = mkComp({
      description: 'Musk posted 199 tweets — resolved NO.',
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

  // ───── C3 regression: percent / cents / probabilities don't false-positive ─────
  it('does NOT match "settled at 100% YES" as realized count (C3 audit)', () => {
    const comp = mkComp({
      description: 'Market settled at 100% YES — resolved YES on Apr 27.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, shape);
    // shape.metric is 'tweets'; the % string doesn't match the tweets regex.
    // Falls through to inferFromOutcome → '≥ 200 tweets'.
    expect(r.source).toBe('inferred-from-outcome');
    expect(r.value).toBeNull();
  });

  it('does NOT match "closed at 95¢ YES" as realized count (C3 audit)', () => {
    const comp = mkComp({
      description: 'Closed at 95¢ YES after 14 days. Resolved YES.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, shape);
    expect(r.source).toBe('inferred-from-outcome');
  });

  it('does NOT match "settled at 5pm UTC" as realized count (C3 audit)', () => {
    const comp = mkComp({
      description: 'Market settled at 5pm UTC on Apr 27. Resolved YES.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, shape);
    expect(r.source).toBe('inferred-from-outcome');
  });

  // ───── I1 regression: clean unit formatting in inferFromOutcome ─────
  it('formats $ with comma + leading $ in inferred display (I1 audit)', () => {
    const priceShape: MarketShape = {
      ...shape, metric: 'price', threshold: 100000, unit: '$',
    };
    const comp = mkComp({ outcome: 'yes', resolvedPrice: 1.0 });
    const r = extractRealizedValue(comp, priceShape);
    expect(r.display).toBe('≥ $100,000'); // not "≥ 100000 $"
  });

  it('formats °F without extra space in inferred display (I1 audit)', () => {
    const tempShape: MarketShape = {
      ...shape, metric: 'temperature', threshold: 95, unit: '°F',
    };
    const comp = mkComp({ outcome: 'yes', resolvedPrice: 0.97 });
    const r = extractRealizedValue(comp, tempShape);
    expect(r.display).toBe('≥ 95°F'); // not "≥ 95 °F"
  });

  // ───── C3a regression: snow shape does NOT match rain in description ─────
  it('snow shape does not match a rain figure (C3a re-audit)', () => {
    const snowShape: MarketShape = {
      ...shape,
      metric: 'snow',
      threshold: 1,
      unit: 'in',
    };
    const comp = mkComp({
      outcome: 'yes',
      description: 'The city received 5 inches of rain over the period.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, snowShape);
    // Should fall through to inferFromOutcome (snow regex requires "snow" noun)
    expect(r.source).toBe('inferred-from-outcome');
  });

  // ───── C3b regression: "5 in late January" doesn't false-match as inches ─────
  it('does NOT match bare "in" as the unit token (C3b re-audit)', () => {
    const snowShape: MarketShape = {
      ...shape,
      metric: 'snow',
      threshold: 1,
      unit: 'in',
    };
    const comp = mkComp({
      outcome: 'yes',
      description: 'Snow was measured 5 in late January but the threshold was met.',
    } as Parameters<typeof mkComp>[0]);
    const r = extractRealizedValue(comp, snowShape);
    // Bare "in" is no longer a valid unit; should fall through to inference.
    expect(r.source).toBe('inferred-from-outcome');
  });
});
