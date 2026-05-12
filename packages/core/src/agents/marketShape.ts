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
  /** Comparison operator between the metric and the threshold. */
  comparator: '>=' | '<=' | '>' | '<';
  /** Numeric threshold the metric is compared against. */
  threshold: number;
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
// I6: added "more than", "greater than", "exceeds?", "surpass(es)?" to ">" row.
const COMPARATOR_PATTERNS: Array<{ rx: RegExp; op: MarketShape['comparator'] }> = [
  { rx: /(?:>=|\bat\s+least\b|≥|\bor\s+more\b|\bor\s+higher\b)/i, op: '>=' },
  { rx: /(?:<=|\bat\s+most\b|≤|\bor\s+fewer\b|\bor\s+lower\b|\bless\s+than\b|\bfewer\s+than\b|\bunder\b)/i, op: '<=' },
  { rx: /(?:>|\bmore\s+than\b|\bgreater\s+than\b|\bexceeds?\b|\bsurpass(?:es)?\b|\bover\b|\bexceed\b)/i, op: '>' },
  { rx: /</, op: '<' },
];

function detectComparator(title: string): MarketShape['comparator'] | null {
  for (const { rx, op } of COMPARATOR_PATTERNS) {
    if (rx.test(title)) return op;
  }
  return null;
}

/** Extract a tweet-count shape: `<entity> tweet(s)? ... <comparator> <N>`.
 *
 *  C1: Binary-event "Will X tweet by DATE?" titles must return null — they
 *  have no numeric threshold, only a deadline. We require EITHER an explicit
 *  comparator phrase OR a `tweets?\s+\d+`-style anchored number before
 *  accepting a threshold.
 *
 *  I2: Strip a leading 4-digit year from the entity lead.
 *  I6: COMPARATOR_PATTERNS already extended; capture group bumped to \d{1,8}. */
function parseTweetCount(title: string): MarketShape | null {
  if (!/\btweets?\b/i.test(title)) return null;

  const op = detectComparator(title);

  // After-comparator: prefer the number immediately after a comparator
  // symbol/phrase (covers "≥ 200", "> 100", "at least 150", "more than 50").
  // I6: bumped from \d{1,5} to \d{1,8} to handle millions.
  const afterComparatorMatch = title.match(
    /(?:>=|<=|>(?!=)|<(?!=)|≥|≤|at\s+least|at\s+most|or\s+more|or\s+fewer|or\s+higher|or\s+lower|more\s+than|greater\s+than|exceeds?|surpass(?:es)?|over)\s*(\d{1,8})\b/i,
  );

  // Anchored pattern: "tweets N" with no comparator (e.g. "tweets 50 times").
  const tweetAnchoredMatch = !afterComparatorMatch
    ? title.match(/\btweets?\s+(\d{1,8})\b/i)
    : null;

  let threshold: number;
  if (afterComparatorMatch) {
    threshold = Number(afterComparatorMatch[1]);
  } else if (tweetAnchoredMatch) {
    threshold = Number(tweetAnchoredMatch[1]);
  } else {
    // C1: no explicit comparator and no anchored number — this is a binary
    // event title like "Will X tweet by Dec 31?". Return null.
    return null;
  }

  if (!Number.isFinite(threshold)) return null;

  // Entity extraction — the words before "tweet"/"tweets" minus filler.
  const tweetIdx = title.toLowerCase().search(/\btweets?\b/);
  const lead = title.slice(0, tweetIdx);
  const entity = lead
    .toLowerCase()
    // I2: strip leading 4-digit year token.
    .replace(/^\d{4}\s+/, '')
    .replace(/\b(will|does|did|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!entity) return null;

  return {
    entity,
    metric: 'tweets',
    comparator: op ?? '>=',
    threshold,
    unit: 'tweets',
    window: { start: null, end: '' },     // window filled by caller via endDate
    source: { titlePart: title },
  };
}

// Month names used to skip them during entity extraction.
const MONTH_NAMES = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;

/** Temperature markets: 'highest NYC temperature ≥ 95°F'.
 *
 *  I3 fixes:
 *  - Accept \btemperatures?\b (plural).
 *  - Prefer the number immediately adjacent to °F (handles "95°F on May 12").
 *  - Handle negative numbers (-?\d).
 *  - Entity: try "in CITY" (multi-word) first, skip month names, fall back
 *    to last non-month token before "temperature". */
function parseTemperature(title: string): MarketShape | null {
  if (!/\btemperatures?\b/i.test(title)) return null;
  const op = detectComparator(title) ?? '>=';

  // Priority 1: number immediately adjacent to °F / °.
  const degFMatch = title.match(/(-?\d{1,3}(?:\.\d+)?)\s*°?\s*F\b/i);

  // Priority 2: number after a comparator phrase (catches "over 90" with no °F).
  const afterComparator = !degFMatch
    ? title.match(/(?:>=|<=|≥|≤|>|<|\bat\s+least\b|\bat\s+most\b|\bor\s+more\b|\bor\s+fewer\b|\bor\s+higher\b|\bor\s+lower\b|\bless\s+than\b|\bfewer\s+than\b|\bunder\b|\bover\b|\bmore\s+than\b|\bgreater\s+than\b|\bexceeds?\b|\bexceed\b)\s*(-?\d{1,3})\b/i)
    : null;

  // Priority 3: last integer in title (avoids year prefix).
  const allNums = [...title.matchAll(/\b(\d{1,3})\b/g)];
  const lastNum = allNums[allNums.length - 1];

  const numMatch = degFMatch ?? afterComparator ?? (lastNum ? [null, lastNum[1]] : null);
  if (!numMatch) return null;
  const threshold = Number(numMatch[1]);
  if (!Number.isFinite(threshold)) return null;

  // Entity extraction:
  // 1. Try "in CITY" multi-word (greedy, stop at prepositions/numbers/°).
  const inCityMatch = title.match(/\bin\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/);
  if (inCityMatch) {
    return {
      entity: inCityMatch[1]!.toLowerCase(),
      metric: 'temperature',
      comparator: op,
      threshold,
      unit: '°F',
      window: { start: null, end: '' },
      source: { titlePart: title },
    };
  }

  // 2. Words before "temperature", skipping stopwords and month names.
  const before = title.toLowerCase().split(/temperatures?/i)[0] ?? '';
  const tokens = before
    .replace(/\b(highest|lowest|will|the|in|a|an|see|record|have)\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !MONTH_NAMES.test(t));
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

/** Price markets: 'BTC ≥ $100k', 'ETH > $5000', 'TSLA ≥ $300'.
 *
 *  I4: Added billion `b` suffix (multiplier 1_000_000_000).
 *  I5: Entity fallback skips stopwords will/what/how/when/where/why/the/a/an. */
function parsePrice(title: string): MarketShape | null {
  // I4: extended suffix capture to include `b`.
  const dollar = title.match(/\$\s*([\d,]+(?:\.\d+)?)(\s*k\b|\s*m\b|\s*b\b)?/i);
  if (!dollar) return null;
  const op = detectComparator(title) ?? '>=';
  let raw = Number(dollar[1]!.replace(/,/g, ''));
  if (!Number.isFinite(raw)) return null;
  const suffix = (dollar[2] ?? '').trim().toLowerCase();
  if (suffix === 'k') raw *= 1_000;
  else if (suffix === 'm') raw *= 1_000_000;
  else if (suffix === 'b') raw *= 1_000_000_000;

  // Entity = first all-caps token (BTC / ETH / TSLA / SPX).
  const tickerMatch = title.match(/\b([A-Z]{2,5})\b/);
  let entity: string;
  if (tickerMatch) {
    entity = (tickerMatch[1] ?? '').toLowerCase();
  } else {
    // I5: skip stopwords when falling back to first word.
    const STOPWORDS = /^(?:will|what|how|when|where|why|the|a|an)$/i;
    const tokens = title.split(/\s+/);
    const first = tokens.find(t => t.length > 0 && !STOPWORDS.test(t)) ?? tokens[0] ?? '';
    entity = first.toLowerCase();
  }

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
 *  'Will NYC see ≥ 1 inch of snow by Dec 31?',
 *  'Will it snow ≥ 1 inch in New York City by Dec 31'.
 *
 *  I7: Multi-word city capture for "in/at CITY" pattern.
 *       Leading-city pattern: "NYC sees ≥ 1 inch...".
 *       Also handles verb ordering: "snow N inch..." (metric before unit). */
function parsePrecipitation(title: string): MarketShape | null {
  // Pattern A: standard  "N unit [of] metric"
  const mA = title.match(/(?:≥|>=|at\s+least|over)?\s*(\d+(?:\.\d+)?)\s*(inch(?:es)?|in\b|mm|cm)\s+(?:of\s+)?(snow|rain|precipitation)/i);
  // Pattern B: verb ordering  "metric [≥] N unit"  (e.g. "snow ≥ 1 inch")
  const mB = title.match(/(snow|rain|precipitation)\s+(?:≥|>=|at\s+least|over)?\s*(\d+(?:\.\d+)?)\s*(inch(?:es)?|in\b|mm|cm)/i);
  if (!mA && !mB) return null;

  let threshold: number;
  let metric: string;
  if (mA) {
    threshold = Number(mA[1]);
    metric = (mA[3] ?? 'snow').toLowerCase();
  } else {
    threshold = Number(mB![2]);
    metric = (mB![1] ?? 'snow').toLowerCase();
  }

  const op = detectComparator(title) ?? '>=';

  // I7: Entity heuristics in priority order.
  // 1. "in/at CITY" — multi-word capture.
  const inAtMatch = title.match(/\b(?:in|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/);
  // 2. "Will CITY see/record/have/get/receive" pattern.
  const willSeeMatch = title.match(/\bWill\s+([A-Z][a-zA-Z]+)\s+(?:see|record|have|get|receive)/);
  // 3. Leading capitalized word(s) before a comparator, digit, or common verb.
  const leadingCityMatch = title.match(/^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(?:sees?\b|gets?\b|records?\b|≥|>=|\d)/);

  const cityMatch = inAtMatch ?? willSeeMatch ?? leadingCityMatch;
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
  return null;
}
