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
  { rx: /(?:>=|\bat\s+least\b|≥|\bor\s+more\b|\bor\s+higher\b)/i, op: '>=' },
  { rx: /(?:<=|\bat\s+most\b|≤|\bor\s+fewer\b|\bor\s+lower\b|\bless\s+than\b|\bfewer\s+than\b|\bunder\b)/i, op: '<=' },
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

/** Temperature markets: 'highest NYC temperature ≥ 95°F'. The metric word
 *  is 'temperature' and the unit is °F (US default for Polymarket weather
 *  markets; Celsius variants would be handled by a future extension).
 *  Threshold extraction prefers a number directly after a comparator
 *  phrase, then falls back to the LAST integer in the title — this
 *  guards against titles where a year (e.g. '2026') appears before
 *  the actual threshold and would otherwise leak as the threshold. */
function parseTemperature(title: string): MarketShape | null {
  if (!/\btemperature\b/i.test(title)) return null;
  const op = detectComparator(title) ?? '>=';

  // Try after-comparator first.
  const afterComparator = title.match(/(?:>=|<=|≥|≤|>|<|\bat\s+least\b|\bat\s+most\b|\bor\s+more\b|\bor\s+fewer\b|\bor\s+higher\b|\bor\s+lower\b|\bless\s+than\b|\bfewer\s+than\b|\bunder\b|\bover\b)\s*(\d{1,3})\b/i);
  // Fall back to the LAST integer in the title (avoids picking up a year prefix).
  const allNums = [...title.matchAll(/\b(\d{1,3})\b/g)];
  const lastNum = allNums[allNums.length - 1];
  const numMatch = afterComparator ?? lastNum;
  if (!numMatch) return null;
  const threshold = Number(numMatch[1]);
  if (!Number.isFinite(threshold)) return null;

  // Entity = city / location word before "temperature".
  const before = title.toLowerCase().split(/temperature/i)[0] ?? '';
  const tokens = before.replace(/\b(highest|lowest|will|the|in|a|an)\b/g, ' ').split(/\s+/).filter(Boolean);
  const entity = tokens[tokens.length - 1] ?? 'unknown';
  return {
    entity,
    metric: 'temperature',
    comparator: op,
    threshold,
    unit: '°F',
    window: { start: null, end: '' },
    source: { titlePart: title },
  };
}

/** Price markets: 'BTC ≥ $100k', 'ETH > $5000', 'TSLA ≥ $300'. */
function parsePrice(title: string): MarketShape | null {
  const dollar = title.match(/\$\s*([\d,]+(?:\.\d+)?)(\s*k\b|\s*m\b)?/i);
  if (!dollar) return null;
  const op = detectComparator(title) ?? '>=';
  let raw = Number(dollar[1]!.replace(/,/g, ''));
  if (!Number.isFinite(raw)) return null;
  const suffix = (dollar[2] ?? '').trim().toLowerCase();
  if (suffix === 'k') raw *= 1_000;
  else if (suffix === 'm') raw *= 1_000_000;
  // Entity = first all-caps token (BTC / ETH / TSLA / SPX). Falls back to
  // the first non-stopword token.
  const tickerMatch = title.match(/\b([A-Z]{2,5})\b/);
  const entity = (tickerMatch ? (tickerMatch[1] ?? '') : (title.split(/\s+/)[0] ?? '')).toLowerCase();
  return {
    entity,
    metric: 'price',
    comparator: op,
    threshold: raw,
    unit: '$',
    window: { start: null, end: '' },
    source: { titlePart: title },
  };
}

/** Snow / rain / precipitation: '≥ 1 inch of snow in NYC by Dec 31',
 *  'Will NYC see ≥ 1 inch of snow by Dec 31?'. Entity extraction tries
 *  both common phrasings: "in CITY" / "at CITY" and "Will CITY see/record/have". */
function parsePrecipitation(title: string): MarketShape | null {
  const m = title.match(/(?:≥|>=|at\s+least|over)?\s*(\d+(?:\.\d+)?)\s*(inch(?:es)?|in\b|mm|cm)\s+(?:of\s+)?(snow|rain|precipitation)/i);
  if (!m) return null;
  const threshold = Number(m[1]);
  const metric = (m[3] ?? 'snow').toLowerCase();
  const op = detectComparator(title) ?? '>=';
  // Entity heuristics — try "in/at CITY" first, then "Will CITY see/record/have".
  const inAtMatch = title.match(/\b(?:in|at)\s+([A-Z][a-zA-Z]+)/);
  const willSeeMatch = title.match(/\bWill\s+([A-Z][a-zA-Z]+)\s+(?:see|record|have|get|receive)/);
  const cityMatch = inAtMatch ?? willSeeMatch;
  const entity = (cityMatch?.[1] ?? 'unknown').toLowerCase();
  return {
    entity,
    metric,
    comparator: op,
    threshold,
    unit: 'in',
    window: { start: null, end: '' },
    source: { titlePart: title },
  };
}

export function parseMarketShape(market: MarketMeta): MarketShape | null {
  if (!market.title || market.title.trim().length === 0) return null;
  const tryParsers = [parseTweetCount, parsePrecipitation, parseTemperature, parsePrice];
  for (const fn of tryParsers) {
    const result = fn(market.title);
    if (result) return { ...result, window: { start: null, end: market.endDate } };
  }
  void stripComparators;
  return null;
}
