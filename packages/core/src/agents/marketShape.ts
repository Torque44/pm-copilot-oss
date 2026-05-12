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

// Comparator phrases mapped to canonical operators. Order matters — match
// the most specific phrase first ("at least" before "least"). Word-boundary
// anchors prevent "atleast" or fragments from matching.
const COMPARATOR_PATTERNS: Array<{ rx: RegExp; op: MarketShape['comparator'] }> = [
  { rx: /(?:>=|at\s+least|≥|or\s+more|or\s+higher)/i, op: '>=' },
  { rx: /(?:<=|at\s+most|≤|or\s+fewer|or\s+lower)/i, op: '<=' },
  { rx: />/, op: '>' },
  { rx: /</, op: '<' },
];

/** Strip comparator phrases so the remaining text can be tokenised for
 *  entity / metric extraction without "at least" leaking into the entity. */
function stripComparators(s: string): string {
  let out = s;
  for (const { rx } of COMPARATOR_PATTERNS) {
    out = out.replace(new RegExp(rx.source, 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function detectComparator(title: string): MarketShape['comparator'] | null {
  for (const { rx, op } of COMPARATOR_PATTERNS) {
    if (rx.test(title)) return op;
  }
  return null;
}

/** Extract a tweet-count shape: `<entity> tweet(s)? ... <comparator> <N>` or
 *  `<entity> tweet(s)? ... <N>` when the threshold appears alone with a
 *  framing verb like "tweet at least" / "tweets ≥". */
function parseTweetCount(title: string): MarketShape | null {
  if (!/\btweets?\b/i.test(title)) return null;
  const op = detectComparator(title) ?? '>=';
  // Find the threshold integer — prefer the number immediately after a
  // comparator symbol/phrase (e.g. "≥ 200", "> 100", "at least 150"),
  // falling back to the last integer in the title.
  const afterComparatorMatch = title.match(
    /(?:>=|<=|>(?!=)|<(?!=)|≥|≤|at\s+least|at\s+most|or\s+more|or\s+fewer|or\s+higher|or\s+lower)\s*(\d{1,5})\b/i,
  );
  let threshold: number;
  if (afterComparatorMatch) {
    threshold = Number(afterComparatorMatch[1]);
  } else {
    // Fallback: last integer in the title (avoids date numbers like "28").
    const allNums = [...title.matchAll(/\b(\d{1,5})\b/g)];
    if (allNums.length === 0) return null;
    const lastMatch = allNums[allNums.length - 1]!;
    threshold = Number(lastMatch[1]);
  }
  if (!Number.isFinite(threshold)) return null;
  // Entity extraction — the words before "tweet"/"tweets" minus filler.
  const tweetIdx = title.toLowerCase().search(/\btweets?\b/);
  const lead = title.slice(0, tweetIdx);
  const entity = lead
    .toLowerCase()
    .replace(/\b(will|does|did|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!entity) return null;
  return {
    entity,
    metric: 'tweets',
    comparator: op,
    threshold,
    unit: 'tweets',
    window: { start: null, end: '' },     // window filled by caller via endDate
    source: { titlePart: title },
  };
}

export function parseMarketShape(market: MarketMeta): MarketShape | null {
  if (!market.title || market.title.trim().length === 0) return null;
  const tweet = parseTweetCount(market.title);
  if (tweet) {
    return { ...tweet, window: { start: null, end: market.endDate } };
  }
  void stripComparators; // reserved for future shapes
  return null;
}
