// marketShape.ts — deterministic regex parser that turns a Polymarket
// market title + resolution text into a structured shape. Used by the
// comparables agent for shape-aware matching and by the ask agent for
// per-comp answer templates.
//
// The parser is pure — no LLM, no network, no I/O. Returns null when no
// known pattern matches; callers fall back to the keyword matcher.

import type { MarketMeta } from './types';

/** A threshold-in-window market shape — the dominant Polymarket form
 *  covering tweet counts, weather thresholds, crypto/equity prices,
 *  vote shares, sports score totals, and similar. */
export type MarketShape = {
  /** Normalised lowercase entity ('elon musk', 'nyc', 'btc', 'trump'). */
  entity: string;
  /** Normalised metric noun ('tweets', 'temperature', 'price', 'snow'). */
  metric: string;
  /** Comparator between metric and threshold. */
  comparator: '>=' | '<=' | '>' | '<' | 'between';
  /** Numeric threshold. For 'between' this is the lower bound. */
  threshold: number;
  /** Upper bound for 'between' comparators. */
  thresholdUpper?: number;
  /** Display unit ('tweets', '°F', '$', 'in'). */
  unit?: string;
  /** Resolution window. start null = open-ended ('Will X hit Y by Z?').
   *  end may be null when Gamma hasn't published a resolution date yet. */
  window: { start: string | null; end: string | null };
  /** Raw matched substrings for debugging mismatches. */
  source: { titlePart?: string; resolutionPart?: string };
};

export function parseMarketShape(market: MarketMeta): MarketShape | null {
  if (!market.title || market.title.trim().length === 0) return null;
  // No patterns matched yet — Task 2 adds the first.
  return null;
}
