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

  it('parses "Highest NYC temperature ≥ 95°F"', () => {
    const m = mkMarket({
      title: 'Highest NYC temperature this week ≥ 95°F',
      endDate: '2026-06-22T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.entity).toBe('nyc');
    expect(s!.metric).toBe('temperature');
    expect(s!.comparator).toBe('>=');
    expect(s!.threshold).toBe(95);
    expect(s!.unit).toBe('°F');
  });

  it('parses "BTC ≥ $100k by Dec 31"', () => {
    const m = mkMarket({
      title: 'BTC ≥ $100k by Dec 31 2026',
      endDate: '2026-12-31T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.entity).toBe('btc');
    expect(s!.metric).toBe('price');
    expect(s!.comparator).toBe('>=');
    expect(s!.threshold).toBe(100000);
    expect(s!.unit).toBe('$');
  });

  it('parses "≥ 1 inch of snow in NYC by Dec 31"', () => {
    const m = mkMarket({
      title: 'Will NYC see ≥ 1 inch of snow by Dec 31?',
      endDate: '2026-12-31T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('snow');
    expect(s!.comparator).toBe('>=');
    expect(s!.threshold).toBe(1);
    expect(s!.unit).toBe('in');
  });

  it('returns null for multi-outcome / non-threshold market titles', () => {
    expect(parseMarketShape(mkMarket({ title: 'Who wins the 2028 Republican nomination?' }))).toBeNull();
    expect(parseMarketShape(mkMarket({ title: 'Will Drake release Iceman before GTA VI?' }))).toBeNull();
    expect(parseMarketShape(mkMarket({ title: 'Russia-Ukraine ceasefire by Dec 31 2026?' }))).toBeNull();
  });

  it('parseTemperature ignores year prefixes when finding threshold', () => {
    const m = mkMarket({
      title: '2026 Phoenix temperature ≥ 115°F record?',
      endDate: '2026-07-15T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('temperature');
    expect(s!.threshold).toBe(115); // not 2026, not 026
  });

  it('parsePrecipitation extracts city from "Will CITY see" pattern', () => {
    const m = mkMarket({
      title: 'Will NYC see ≥ 1 inch of snow by Dec 31?',
      endDate: '2026-12-31T23:59:00Z',
    });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('snow');
    expect(s!.entity).toBe('nyc'); // not 'unknown'
  });

  // ───── C1 regression: binary-event "Will X tweet by DATE" returns null ─────
  it('returns null for binary-event "Will X tweet by DATE" (C1 audit)', () => {
    expect(parseMarketShape(mkMarket({ title: 'Will Elon tweet by Dec 31?', endDate: '2026-12-31T23:59:00Z' }))).toBeNull();
    expect(parseMarketShape(mkMarket({ title: 'Will Kanye tweet again by May 31?', endDate: '2026-05-31T23:59:00Z' }))).toBeNull();
    expect(parseMarketShape(mkMarket({ title: 'Will Drake tweet about GTA VI before 2027?', endDate: '2026-12-31T23:59:00Z' }))).toBeNull();
  });

  // ───── I2 regression: year prefix doesn't leak into entity ─────
  it('strips leading 4-digit year from tweet-count entity (I2 audit)', () => {
    const m = mkMarket({ title: '2025 Trump tweets ≥ 100', endDate: '2026-05-15T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.entity).toBe('trump'); // not "2025 trump"
    expect(s!.threshold).toBe(100);
  });

  // ───── I6 regression: more than / greater than / exceeds for tweet counts ─────
  it('parses "more than N" as > comparator (I6 audit)', () => {
    const m = mkMarket({ title: 'Trump tweets more than 100 by Friday', endDate: '2026-05-15T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.comparator).toBe('>');
    expect(s!.threshold).toBe(100);
  });

  it('parses "exceeds N" as > comparator (I6 audit)', () => {
    const m = mkMarket({ title: 'Elon Musk tweets exceeds 200 this week', endDate: '2026-05-15T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.comparator).toBe('>');
  });

  it('parses 7-digit tweet thresholds correctly (I6 audit)', () => {
    const m = mkMarket({ title: 'Elon Musk tweets ≥ 1000000 in 2026', endDate: '2026-12-31T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.threshold).toBe(1000000); // not 2026
  });

  // ───── I3 regression: plural "temperatures", exceed verb, °F-adjacent number ─────
  it('parses plural "temperatures" (I3 audit)', () => {
    const m = mkMarket({ title: 'Will NYC see temperatures over 90°F by Friday', endDate: '2026-06-22T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('temperature');
    expect(s!.threshold).toBe(90);
  });

  it('parses "Phoenix temperature exceed 115°F" (I3 audit)', () => {
    const m = mkMarket({ title: 'Will Phoenix temperature exceed 115°F by July 31?', endDate: '2026-07-31T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.threshold).toBe(115);
    expect(s!.comparator).toBe('>');
  });

  it('parses "temperature 95°F on May 12" with date noise (I3 audit)', () => {
    const m = mkMarket({ title: 'NYC temperature 95°F on May 12', endDate: '2026-05-12T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.threshold).toBe(95); // not 12
  });

  // ───── I4 regression: billion suffix ─────
  it('parses $1B as 1,000,000,000 (I4 audit)', () => {
    const m = mkMarket({ title: 'Will Trump fundraise more than $1B by Dec 31', endDate: '2026-12-31T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.threshold).toBe(1_000_000_000);
    expect(s!.unit).toBe('$');
  });

  // ───── I5 regression: parsePrice entity skips "Will"/"What" stopwords ─────
  it('parsePrice entity skips Will/What/How stopwords (I5 audit)', () => {
    const m = mkMarket({ title: 'Will Trump fundraise more than $1B', endDate: '2026-12-31T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.entity).toBe('trump'); // not "will"
  });

  // ───── I7 regression: multi-word city in precipitation ─────
  it('captures multi-word city in precipitation entity (I7 audit)', () => {
    const m = mkMarket({ title: 'Will it snow ≥ 1 inch in New York City by Dec 31', endDate: '2026-12-31T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('snow');
    expect(s!.entity).toBe('new york city'); // multi-word, lowercase
  });

  it('captures leading city in precipitation entity (I7 audit)', () => {
    const m = mkMarket({ title: 'NYC sees ≥ 1 inch of snow by Dec 31', endDate: '2026-12-31T23:59:00Z' });
    const s = parseMarketShape(m);
    expect(s).not.toBeNull();
    expect(s!.metric).toBe('snow');
    expect(s!.entity).toBe('nyc'); // leading-city pattern
  });
});
