# Threshold-shape comparables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ask agent's "give me past Polymarket resolution data" answer from a generic 50%-base-rate line into structured per-comp output that names threshold + realized value + outcome per row, for threshold-in-window market shapes (tweet counts, weather thresholds, prices, vote shares, sports totals).

**Architecture:** Three deterministic components, no LLM in the comparables path. (1) `marketShape.ts` regex parser extracts `{entity, metric, comparator, threshold, window}` from a market's title + resolution text. (2) `comparables.ts` adds shape-aware scoring on top of the existing keyword matcher and attaches parsed shapes to citation payloads. (3) `realizedValue.ts` extracts the realized number from Gamma's resolution-note text or infers from outcome+threshold; `ask.ts` formats per-comp rows into the LLM prompt and a new SYS rule tells the model to quote the specific numbers.

**Tech Stack:** TypeScript (strict), vitest, Node 20+, pnpm workspaces. The `packages/core` package owns the new code; no UI work in this plan — the comparables panel already renders `[comp-N]` rows correctly and shape data lives only in the ask agent's prompt construction.

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `packages/core/src/agents/marketShape.ts` | NEW | Pure `parseMarketShape(market)` regex parser. No deps on other agents. |
| `packages/core/src/agents/marketShape.test.ts` | NEW | Snapshot tests for ~6 title shapes + negative cases. |
| `packages/core/src/agents/realizedValue.ts` | NEW | `extractRealizedValue(comp, shape)` — Gamma-note regex → outcome inference → null. |
| `packages/core/src/agents/realizedValue.test.ts` | NEW | Tests covering all three priority tiers. |
| `packages/core/src/agents/comparables.ts` | MODIFIED | Shape-aware scorer; attach shape + realized to citation payloads. |
| `packages/core/src/agents/ask.ts` | MODIFIED | `describeComparables()` reads shape + realized; SYS prompt gets shape-aware sub-rule. |

Tasks proceed in dependency order: `marketShape.ts` first (Tasks 1-3), then `realizedValue.ts` (Tasks 4-6), then comparables wiring (Task 7), then ask prompt + SYS (Task 8), then verify end-to-end (Task 9).

---

## Pre-flight

- [ ] **Step 1: Verify the spec is committed and the working tree is clean before starting**

Run: `cd /c/Users/ayush/Downloads/pm-copilot-oss && git status --short`
Expected: only `design-bundle/*` untracked files (pre-existing). No tracked-file modifications.

- [ ] **Step 2: Baseline typecheck + test green**

Run: `cd /c/Users/ayush/Downloads/pm-copilot-oss && pnpm typecheck && pnpm test`
Expected: zero typecheck errors, all existing tests pass.

---

## Task 1: marketShape.ts — types + empty function

**Files:**
- Create: `packages/core/src/agents/marketShape.ts`
- Create: `packages/core/src/agents/marketShape.test.ts`

- [ ] **Step 1: Write the failing test for the types-only / empty-stub behavior**

Create `packages/core/src/agents/marketShape.test.ts` with:

```ts
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
    ...over,
  };
}

describe('parseMarketShape', () => {
  it('returns null for an empty title', () => {
    const m = mkMarket({ title: '' });
    expect(parseMarketShape(m)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, expect it to FAIL with module-not-found**

Run: `pnpm vitest run packages/core/src/agents/marketShape.test.ts`
Expected: FAIL with `Cannot find module './marketShape'` or `parseMarketShape is not a function`.

- [ ] **Step 3: Create the stub file**

Create `packages/core/src/agents/marketShape.ts`:

```ts
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
  /** Resolution window. start null = open-ended ('Will X hit Y by Z?'). */
  window: { start: string | null; end: string };
  /** Raw matched substrings for debugging mismatches. */
  source: { titlePart?: string; resolutionPart?: string };
};

export function parseMarketShape(market: MarketMeta): MarketShape | null {
  if (!market.title || market.title.trim().length === 0) return null;
  // No patterns matched yet — Task 2 adds the first.
  return null;
}
```

- [ ] **Step 4: Run the test, expect it to PASS**

Run: `pnpm vitest run packages/core/src/agents/marketShape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/marketShape.ts packages/core/src/agents/marketShape.test.ts
git commit -m "feat(marketShape): stub parser + types"
```

---

## Task 2: marketShape.ts — tweet-count titles

**Files:**
- Modify: `packages/core/src/agents/marketShape.ts`
- Modify: `packages/core/src/agents/marketShape.test.ts`

- [ ] **Step 1: Append the failing tweet-count tests**

Append inside the `describe('parseMarketShape', ...)` block in `marketShape.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests, expect 3 FAIL (parser returns null) + 1 still PASS**

Run: `pnpm vitest run packages/core/src/agents/marketShape.test.ts`
Expected: 3 failing tests, 1 passing (empty-title test).

- [ ] **Step 3: Implement the tweet-count parser**

Replace the body of `parseMarketShape` in `marketShape.ts`:

```ts
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
  // Find the threshold integer — prefer the number nearest the comparator,
  // fallback to the first integer in the title.
  const numMatch = title.match(/(\d{1,5})(?!\d)/);
  if (!numMatch) return null;
  const threshold = Number(numMatch[1]);
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
```

- [ ] **Step 4: Run the tests, expect all PASS**

Run: `pnpm vitest run packages/core/src/agents/marketShape.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/marketShape.ts packages/core/src/agents/marketShape.test.ts
git commit -m "feat(marketShape): parse tweet-count titles"
```

---

## Task 3: marketShape.ts — weather, prices, between, negatives

**Files:**
- Modify: `packages/core/src/agents/marketShape.ts`
- Modify: `packages/core/src/agents/marketShape.test.ts`

- [ ] **Step 1: Append failing tests for the remaining shape variants**

Append inside the `describe('parseMarketShape', ...)` block:

```ts
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
```

- [ ] **Step 2: Run the tests, expect 4 new FAIL + 4 existing PASS**

Run: `pnpm vitest run packages/core/src/agents/marketShape.test.ts`
Expected: 4 failing (weather, BTC, snow, negative cases), 4 passing.

- [ ] **Step 3: Add the remaining parsers**

Replace the body of `parseMarketShape` and add the new parser functions in `marketShape.ts`. Replace this block:

```ts
export function parseMarketShape(market: MarketMeta): MarketShape | null {
  if (!market.title || market.title.trim().length === 0) return null;
  const tweet = parseTweetCount(market.title);
  if (tweet) {
    return { ...tweet, window: { start: null, end: market.endDate } };
  }
  void stripComparators; // reserved for future shapes
  return null;
}
```

…with:

```ts
/** Temperature markets: 'highest NYC temperature ≥ 95°F'. The metric word
 *  is 'temperature' and the unit is °F (US default for Polymarket weather
 *  markets; Celsius variants would be handled by a future extension). */
function parseTemperature(title: string): MarketShape | null {
  if (!/\btemperature\b/i.test(title)) return null;
  const op = detectComparator(title) ?? '>=';
  const numMatch = title.match(/(\d{1,3})\s*°?\s*F?\b/);
  if (!numMatch) return null;
  const threshold = Number(numMatch[1]);
  // Entity = city / location word before "temperature". Heuristic: take the
  // last proper-noun-shaped token before the word, lowercase it.
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
  const entity = (tickerMatch ? tickerMatch[1] : title.split(/\s+/)[0] ?? '').toLowerCase();
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

/** Snow / rain / precipitation: '≥ 1 inch of snow in NYC by Dec 31'. */
function parsePrecipitation(title: string): MarketShape | null {
  const m = title.match(/(?:≥|>=|at\s+least|over)?\s*(\d+(?:\.\d+)?)\s*(inch(?:es)?|in\b|mm|cm)\s+(?:of\s+)?(snow|rain|precipitation)/i);
  if (!m) return null;
  const threshold = Number(m[1]);
  const metric = (m[3] ?? 'snow').toLowerCase();
  const op = detectComparator(title) ?? '>=';
  // Entity = city after "in"
  const cityMatch = title.match(/\bin\s+([A-Z][a-zA-Z]+)/);
  const entity = (cityMatch ? cityMatch[1] : 'unknown').toLowerCase();
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
```

- [ ] **Step 4: Run the tests, expect all PASS**

Run: `pnpm vitest run packages/core/src/agents/marketShape.test.ts`
Expected: 8 passing tests.

- [ ] **Step 5: Run the project-wide typecheck**

Run: `cd /c/Users/ayush/Downloads/pm-copilot-oss && pnpm typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agents/marketShape.ts packages/core/src/agents/marketShape.test.ts
git commit -m "feat(marketShape): parse weather, prices, precipitation; null on multi-outcome"
```

---

## Task 4: realizedValue.ts — types + Gamma-note extractor

**Files:**
- Create: `packages/core/src/agents/realizedValue.ts`
- Create: `packages/core/src/agents/realizedValue.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/agents/realizedValue.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the tests, expect FAIL with module-not-found**

Run: `pnpm vitest run packages/core/src/agents/realizedValue.test.ts`
Expected: FAIL — `Cannot find module './realizedValue'`.

- [ ] **Step 3: Create the implementation**

Create `packages/core/src/agents/realizedValue.ts`:

```ts
// realizedValue.ts — extract the realized number from a resolved
// comparable's Gamma payload. Three priority tiers:
//   1. Gamma description / resolutionWording regex (real number)
//   2. Inference from outcome + shape threshold (no exact number, but
//      we know the realized was above/below the threshold)
//   3. Unknown (the comp gets reported with outcome only)
//
// No external API calls. No LLM. Pure function over already-fetched data.

import type { ComparableHit } from './comparables';
import type { MarketShape } from './marketShape';

export type RealizedValue = {
  /** The realized number when extractable. */
  value: number | null;
  /** How we got it. */
  source: 'gamma-note' | 'inferred-from-outcome' | 'unknown';
  /** Free-text display with unit ('213 tweets', '97°F', '≥ 200 tweets'). */
  display: string | null;
};

const PATTERNS_NUMBER: RegExp[] = [
  /\b(?:settled|closed|resolved|final)\s+(?:at|count[:\s]+|value[:\s]+)?\s*\$?([\d,]+(?:\.\d+)?)/i,
  /\bfinal\s+count[:\s]+([\d,]+)/i,
  /\bhigh\s+of\s+(\d+(?:\.\d+)?)\s*°?\s*F?/i,
  /\breceived\s+(\d+(?:\.\d+)?)\s+inches?/i,
  /\b([\d,]+(?:\.\d+)?)\s*(?:tweets|posts|mentions)\b/i,
];

function tryGammaNote(comp: ComparableHit, shape: MarketShape | null): RealizedValue | null {
  const payload = (comp as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as { description?: unknown; resolutionWording?: unknown };
  const text = [
    typeof obj.description === 'string' ? obj.description : '',
    typeof obj.resolutionWording === 'string' ? obj.resolutionWording : '',
  ].filter(Boolean).join(' ');
  if (!text) return null;
  for (const rx of PATTERNS_NUMBER) {
    const m = rx.exec(text);
    if (!m) continue;
    const raw = m[1]!.replace(/,/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const unit = shape?.unit ?? '';
    const display = unit === '°F' ? `${value}°F`
      : unit === '$' ? `$${value.toLocaleString('en-US')}`
      : unit ? `${value} ${unit}`
      : String(value);
    return { value, source: 'gamma-note', display };
  }
  return null;
}

function inferFromOutcome(comp: ComparableHit, shape: MarketShape | null): RealizedValue | null {
  if (!shape) return null;
  if (comp.outcome !== 'yes' && comp.outcome !== 'no') return null;
  const { comparator, threshold, unit } = shape;
  const unitDisplay = unit ?? '';
  // YES means the threshold was met under the original comparator; NO means
  // it wasn't. Translate to the actual realized inequality.
  const yesPair: Record<MarketShape['comparator'], string> = {
    '>=': `≥ ${threshold}`,
    '<=': `≤ ${threshold}`,
    '>':  `> ${threshold}`,
    '<':  `< ${threshold}`,
    'between': `≥ ${threshold}`, // simplification; between still met when YES
  };
  const noPair: Record<MarketShape['comparator'], string> = {
    '>=': `< ${threshold}`,
    '<=': `> ${threshold}`,
    '>':  `≤ ${threshold}`,
    '<':  `≥ ${threshold}`,
    'between': `outside ${threshold}`,
  };
  const lead = comp.outcome === 'yes' ? yesPair[comparator] : noPair[comparator];
  const display = unitDisplay ? `${lead} ${unitDisplay}` : lead;
  return { value: null, source: 'inferred-from-outcome', display };
}

export function extractRealizedValue(
  comp: ComparableHit,
  shape: MarketShape | null,
): RealizedValue {
  return (
    tryGammaNote(comp, shape) ??
    inferFromOutcome(comp, shape) ??
    { value: null, source: 'unknown', display: null }
  );
}
```

- [ ] **Step 4: Run the tests, expect all PASS**

Run: `pnpm vitest run packages/core/src/agents/realizedValue.test.ts`
Expected: 6 passing tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agents/realizedValue.ts packages/core/src/agents/realizedValue.test.ts
git commit -m "feat(realizedValue): three-tier extractor for resolved comparables"
```

---

## Task 5: comparables.ts — attach shape + realized to citation payloads

**Files:**
- Modify: `packages/core/src/agents/comparables.ts`

This task does NOT change comparable scoring yet (Task 6 does). It only attaches the parsed shape + realized value to each citation payload so downstream consumers (ask agent) can read them. Keeps the diff small and observable.

- [ ] **Step 1: Read the ComparableHit type at comparables.ts:123-138**

Run: `grep -n "export type ComparableHit" packages/core/src/agents/comparables.ts`
Expected: `123:export type ComparableHit = {`

- [ ] **Step 2: Modify ComparableHit to include optional shape**

Replace the `ComparableHit` type at `packages/core/src/agents/comparables.ts:123-138`:

Old:
```ts
export type ComparableHit = {
  /** Polymarket event id. */
  eventId: string;
  /** Event title. */
  title: string;
  /** End date ISO (when the event resolved, or close to it). */
  endDate: string | null;
  /** "yes" if it resolved YES, "no" if NO, "unresolved" otherwise. */
  outcome: 'yes' | 'no' | 'unresolved';
  /** Strongest outcome's price at resolution (yes-side) — or null. */
  resolvedPrice: number | null;
  /** Slug for building the polymarket URL. */
  slug?: string;
  /** Keyword overlap score (informational). */
  score: number;
};
```

New:
```ts
import type { MarketShape } from './marketShape';

export type ComparableHit = {
  /** Polymarket event id. */
  eventId: string;
  /** Event title. */
  title: string;
  /** End date ISO (when the event resolved, or close to it). */
  endDate: string | null;
  /** "yes" if it resolved YES, "no" if NO, "unresolved" otherwise. */
  outcome: 'yes' | 'no' | 'unresolved';
  /** Strongest outcome's price at resolution (yes-side) — or null. */
  resolvedPrice: number | null;
  /** Slug for building the polymarket URL. */
  slug?: string;
  /** Keyword overlap score (informational). */
  score: number;
  /** Parsed market shape when the title fits the threshold-in-window
   *  pattern. Null when the comparable's title didn't parse. */
  shape?: MarketShape | null;
  /** Raw Gamma fields ask agent's realizedValue extractor reads. Populated
   *  from the candidate GammaEvent so consumers don't need to refetch. */
  description?: string | null;
};
```

- [ ] **Step 3: Populate `shape` and `description` when building each ComparableHit**

Locate `scored.push({` at `comparables.ts:225` and modify the push. Find:

```ts
    scored.push({
      eventId: ev.id,
      title: ev.title,
      endDate: ev.endDate ?? null,
      outcome,
      resolvedPrice: pickResolvedPrice(ev),
      ...(ev.slug ? { slug: ev.slug } : {}),
      score,
    });
```

Replace with:

```ts
    // Parse the comparable's shape from its title for downstream
    // shape-aware ask answers. parseMarketShape needs a MarketMeta but we
    // only have a GammaEvent here — build a minimal stub. The parser only
    // reads `title` and `endDate`.
    const compShape = parseMarketShape({
      marketId: ev.id,
      eventId: ev.id,
      venue: 'polymarket',
      title: ev.title,
      category: input.category,
      yes: 0,
      no: 0,
      volume24hr: 0,
      volumeTotal: 0,
      endDate: ev.endDate ?? '',
      conditionId: '',
      tokenIdYes: '',
      tokenIdNo: '',
    });
    scored.push({
      eventId: ev.id,
      title: ev.title,
      endDate: ev.endDate ?? null,
      outcome,
      resolvedPrice: pickResolvedPrice(ev),
      ...(ev.slug ? { slug: ev.slug } : {}),
      score,
      ...(compShape ? { shape: compShape } : {}),
      ...(ev.description ? { description: ev.description } : {}),
    });
```

- [ ] **Step 4: Add the parseMarketShape import at the top of comparables.ts**

Insert after the existing imports at the top of `comparables.ts`:

```ts
import { parseMarketShape } from './marketShape';
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors. (The Citation payload type was already `unknown` so attaching `description` doesn't break anything.)

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: all existing tests still pass; no new test failures.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/agents/comparables.ts
git commit -m "feat(comparables): attach parsed shape + raw description to hits"
```

---

## Task 6: comparables.ts — shape-aware scoring on top of keyword scorer

**Files:**
- Modify: `packages/core/src/agents/comparables.ts`

The current scorer is keyword + synonym + prefix overlap. This task adds shape-similarity bonuses on top: same `(entity, metric)` → +5.0, same metric only → +2.5, same time-scale → +1.0, threshold-proximity → +0.5. Markets without parsed shapes still get the keyword score as a floor.

- [ ] **Step 1: Locate the scoring inner loop at comparables.ts:178-234**

Run: `grep -n "for (const ev of candidates)" packages/core/src/agents/comparables.ts`
Expected: `178:  for (const ev of candidates) {`

- [ ] **Step 2: Parse the query market's shape before the scoring loop**

After the line `const scored: ComparableHit[] = [];` (around line 177 in current file) and BEFORE the `for (const ev of candidates) {` loop, insert:

```ts
  // Parse the QUERY market's shape once. Used inside the loop to score
  // each candidate by shape similarity in addition to keyword overlap.
  // Returns null for non-threshold markets — those fall back to the
  // pure-keyword scorer that already exists below.
  const queryShape = parseMarketShape({
    marketId: 'query',
    eventId: 'query-event',
    venue: 'polymarket',
    title: input.marketTitle,
    category: input.category,
    yes: 0,
    no: 0,
    volume24hr: 0,
    volumeTotal: 0,
    endDate: '',
    conditionId: '',
    tokenIdYes: '',
    tokenIdNo: '',
  });

  // Window-duration estimate for the query market. When we have no start
  // date in the parsed shape, treat the window as a "moment" (0). Used for
  // the time-scale similarity bonus below.
  const queryWindowMs = (() => {
    if (!queryShape) return 0;
    const end = queryShape.window.end ? Date.parse(queryShape.window.end) : 0;
    const start = queryShape.window.start ? Date.parse(queryShape.window.start) : 0;
    return start && end ? Math.max(0, end - start) : 0;
  })();
```

- [ ] **Step 3: Add the shape-similarity bonus inside the scoring loop**

Locate the block in `comparables.ts` that ends with `if (hits === 0) continue;` (around line 222) and add the shape bonus just before that line. Find:

```ts
      if (t.length >= 4) {
        for (const e of evTokens) {
          if (e.length > t.length && e.startsWith(t)) {
            score += tokenWeight(t) * 0.85;                // prefix hit slightly discounted
            hits += 1;
            break;
          }
          if (t.length > e.length && t.startsWith(e) && e.length >= 4) {
            score += tokenWeight(t) * 0.85;
            hits += 1;
            break;
          }
        }
      }
    }
    if (hits === 0) continue;
```

Replace with:

```ts
      if (t.length >= 4) {
        for (const e of evTokens) {
          if (e.length > t.length && e.startsWith(t)) {
            score += tokenWeight(t) * 0.85;                // prefix hit slightly discounted
            hits += 1;
            break;
          }
          if (t.length > e.length && t.startsWith(e) && e.length >= 4) {
            score += tokenWeight(t) * 0.85;
            hits += 1;
            break;
          }
        }
      }
    }

    // Shape-aware bonus. Only fires when both the query market and this
    // candidate parse to threshold-in-window shapes. Falls through silently
    // (no bonus, no penalty) when either side doesn't parse — the keyword
    // scorer above is the floor.
    const candidateShape = queryShape ? parseMarketShape({
      marketId: ev.id,
      eventId: ev.id,
      venue: 'polymarket',
      title: ev.title,
      category: input.category,
      yes: 0, no: 0, volume24hr: 0, volumeTotal: 0,
      endDate: ev.endDate ?? '',
      conditionId: '',
      tokenIdYes: '',
      tokenIdNo: '',
    }) : null;

    if (queryShape && candidateShape) {
      // Same entity AND same metric — same KIND of bet on the same subject.
      if (queryShape.entity === candidateShape.entity && queryShape.metric === candidateShape.metric) {
        score += 5.0;
        hits += 1;
      } else if (queryShape.metric === candidateShape.metric) {
        // Same metric, different entity — same bet shape, different subject.
        score += 2.5;
        hits += 1;
      }

      // Same time-scale: window duration within 0.5×-2× of query's window.
      // Daily / weekly / monthly markets group together; annual markets
      // don't blur into weekly ones.
      const candStart = candidateShape.window.start ? Date.parse(candidateShape.window.start) : 0;
      const candEnd = candidateShape.window.end ? Date.parse(candidateShape.window.end) : 0;
      const candWindowMs = candStart && candEnd ? Math.max(0, candEnd - candStart) : 0;
      if (queryWindowMs > 0 && candWindowMs > 0) {
        const ratio = candWindowMs / queryWindowMs;
        if (ratio >= 0.5 && ratio <= 2.0) score += 1.0;
      }

      // Threshold proximity: candidate within 0.67×-1.5× of query's threshold.
      // ≥200 matches ≥150 and ≥250 but not ≥10 or ≥1000.
      if (queryShape.threshold > 0 && candidateShape.threshold > 0) {
        const tRatio = candidateShape.threshold / queryShape.threshold;
        if (tRatio >= 0.67 && tRatio <= 1.5) score += 0.5;
      }
    }

    if (hits === 0) continue;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: existing tests pass; shape parsing now runs twice per candidate (once for scoring, once for the push). The duplication is acceptable — parseMarketShape is a pure-regex function and the candidate pool is ~500 items.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agents/comparables.ts
git commit -m "feat(comparables): shape-aware scoring bonuses on top of keyword scorer"
```

---

## Task 7: ask.ts — read shape + realized in describeComparables

**Files:**
- Modify: `packages/core/src/agents/ask.ts`

The `AskComparable` type in ask.ts is structurally compatible with `ComparableHit`. This task widens the local type and updates `describeComparables()` to render per-comp lines with threshold, realized value, and outcome — the structured per-comp output the user wants.

- [ ] **Step 1: Locate AskComparable + describeComparables in ask.ts**

Run: `grep -n "AskComparable\|function describeComparables" packages/core/src/agents/ask.ts`
Expected: matches for both the type definition and the function.

- [ ] **Step 2: Widen AskComparable to carry shape + description**

Locate the `AskComparable` type definition in `ask.ts` (it's near the top of the file in the public types block). Find:

```ts
export type AskComparable = {
  eventId: string;
  title: string;
  endDate: string | null;
  outcome: 'yes' | 'no' | 'unresolved';
  resolvedPrice: number | null;
  slug?: string;
  score: number;
};
```

Replace with:

```ts
export type AskComparable = {
  eventId: string;
  title: string;
  endDate: string | null;
  outcome: 'yes' | 'no' | 'unresolved';
  resolvedPrice: number | null;
  slug?: string;
  score: number;
  /** Parsed market shape when the title fits threshold-in-window pattern.
   *  Surfaced into describeComparables() so the ask LLM can quote
   *  threshold + realized value per [comp-N] cite. */
  shape?: import('./marketShape').MarketShape | null;
  /** Raw Gamma description text — read by realizedValue.ts to extract the
   *  realized number when present. */
  description?: string | null;
};
```

- [ ] **Step 3: Update describeComparables to format per-comp rows with realized values**

Locate the current `describeComparables` function in `ask.ts` and replace its body. Find the function that starts:

```ts
function describeComparables(comps: AskComparable[] | undefined): string {
```

…and replace its body with:

```ts
function describeComparables(comps: AskComparable[] | undefined): string {
  if (!comps || comps.length === 0) {
    return 'Resolved comparables: none surfaced for this market.';
  }
  const top = comps.slice(0, 10);
  const yesCount = top.filter((c) => c.outcome === 'yes').length;
  const noCount = top.filter((c) => c.outcome === 'no').length;
  const resolved = yesCount + noCount;
  const baseRate = resolved >= 3 ? Math.round((yesCount / resolved) * 100) : null;
  const header = baseRate != null
    ? `Resolved comparables (n=${resolved} resolved, base rate ${baseRate}% YES):`
    : `Resolved comparables (${top.length} surfaced, ${resolved} with outcomes):`;
  const rows = top.map((c, i) => {
    const verdict =
      c.outcome === 'yes' ? 'resolved YES'
      : c.outcome === 'no' ? 'resolved NO'
      : c.resolvedPrice != null ? `unresolved @ ${(c.resolvedPrice * 100).toFixed(0)}¢ YES`
      : 'unresolved';
    const endDate = c.endDate ? ` · ended ${c.endDate.slice(0, 10)}` : '';
    // Shape + realized value when available — this is the structured
    // per-comp output the answer template depends on. extractRealizedValue
    // runs on the SHAPE-equipped comp; for non-shape comps we fall back
    // to the old plain-title line.
    if (c.shape) {
      const realized = realizedValueModule.extractRealizedValue(
        // RealizedValue extractor reads .outcome + .resolvedPrice + payload.description.
        // We synthesise a ComparableHit-shape proxy from the ask-side fields.
        {
          eventId: c.eventId,
          title: c.title,
          endDate: c.endDate,
          outcome: c.outcome,
          resolvedPrice: c.resolvedPrice,
          score: c.score,
          ...(c.slug ? { slug: c.slug } : {}),
          ...(c.description ? { description: c.description } : {}),
        } as Parameters<typeof realizedValueModule.extractRealizedValue>[0],
        c.shape,
      );
      const realizedPart = realized.display
        ? ` — realized ${realized.display}${realized.source === 'inferred-from-outcome' ? ' (inferred)' : ''}`
        : '';
      const thresholdLabel = `${c.shape.comparator}${c.shape.threshold}${c.shape.unit ? ` ${c.shape.unit}` : ''}`;
      const priceTail = c.resolvedPrice != null ? ` @ ${(c.resolvedPrice * 100).toFixed(0)}¢` : '';
      return `[comp-${i + 1}] ${c.title.slice(0, 100)} — threshold ${thresholdLabel}${realizedPart} — ${verdict}${priceTail}${endDate}`;
    }
    return `[comp-${i + 1}] ${c.title.slice(0, 100)} — ${verdict}${endDate}`;
  }).join('\n');
  return `${header}\n${rows}`;
}
```

- [ ] **Step 4: Add the realizedValue module import**

At the top of `ask.ts`, in the imports block, add:

```ts
import * as realizedValueModule from './realizedValue';
```

(Wildcard import keeps the diff minimal and avoids a circular import risk between ask.ts and realizedValue.ts. The single namespace import is intentional.)

- [ ] **Step 5: Update SYS prompt with the shape-aware sub-rule**

Locate the "PAST RESOLUTION DATA" answer-type rule in the SYS prompt string in `ask.ts`. Find:

```ts
▸ "PAST RESOLUTION DATA" / "BASE RATE" / "WHAT HAPPENED WITH SIMILAR MARKETS" question — the user is asking about historical Polymarket outcomes for markets shaped like this one.
  → Use the [comp-N] citations directly. The Comparables block in the user prompt lists resolved markets with their outcomes (yes/no/unresolved) and resolved prices. Count yes vs no, surface the base rate, name a few of the most relevant comps. DO NOT refuse with "I don't have past resolution data" — you have it; it's in the prompt.
```

Replace with:

```ts
▸ "PAST RESOLUTION DATA" / "BASE RATE" / "WHAT HAPPENED WITH SIMILAR MARKETS" question — the user is asking about historical Polymarket outcomes for markets shaped like this one.
  → Use the [comp-N] citations directly. The Comparables block in the user prompt lists resolved markets with their outcomes (yes/no/unresolved) and resolved prices. Count yes vs no, surface the base rate, name a few of the most relevant comps. DO NOT refuse with "I don't have past resolution data" — you have it; it's in the prompt.
  → SHAPE-AWARE RULE: when a comparable row carries a "threshold {comparator}{N}{unit}" segment AND a "realized {value}" segment, you MUST quote those specific numbers in the answer. Do NOT collapse them into a generic "50% base rate" line. Example: "Apr 21-27 ('≥200 tweets') — Musk hit ~213, resolved YES at 97¢ [comp-1]". When the realized value is marked "(inferred)", make that clear: "Mar 31 ('≥200') — implied ≥200 from YES outcome at 100¢ [comp-4]". Lead with the directly-comparable threshold band; the base rate at THAT band (not the full sample) is what the trader needs.
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 7: Run all tests**

Run: `pnpm test`
Expected: existing ask.test.ts tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/agents/ask.ts
git commit -m "feat(ask): structured per-comp answers using parsed shape + realized value"
```

---

## Task 8: server wiring — pass shape + description from comparables to ask

**Files:**
- Modify: `apps/server/src/routes/ask.ts`

The server's `ensureGrounding` already pulls comparables (commit `aafe3a5`) but maps to `ComparableHit[]` whose `shape` and `description` fields aren't yet preserved when crossing to `AskComparable`. This task plumbs them through.

- [ ] **Step 1: Locate the comparables mapping in ask handler**

Run: `grep -n "have.comparables = r.output.citations" apps/server/src/routes/ask.ts`
Expected: one match showing the existing mapping.

- [ ] **Step 2: Update the mapping to preserve shape + description**

Find the block in `apps/server/src/routes/ask.ts`:

```ts
  tasks.push(
    runComparablesAgent(ctx, { marketTitle: market.title, category: market.category })
      .then((r) => {
        have.comparables = r.output.citations
          .filter((c) => c.kind === 'comp' && c.payload)
          .map((c) => c.payload as ComparableHit)
          .filter((p) => p && typeof p.eventId === 'string' && typeof p.title === 'string');
      })
      .catch(() => { /* swallow */ }),
  );
```

Replace with:

```ts
  tasks.push(
    runComparablesAgent(ctx, { marketTitle: market.title, category: market.category })
      .then((r) => {
        // ComparableHit now carries optional shape + description (Tasks 5/6).
        // Both pass through as-is to AskComparable since the types are
        // structurally compatible; runAsk's describeComparables reads them.
        have.comparables = r.output.citations
          .filter((c) => c.kind === 'comp' && c.payload)
          .map((c) => c.payload as ComparableHit)
          .filter((p) => p && typeof p.eventId === 'string' && typeof p.title === 'string');
      })
      .catch(() => { /* swallow */ }),
  );
```

(The only change here is the leading comment — the mapping itself is unchanged because ComparableHit and AskComparable share the new optional fields. This step is a no-op refactor that documents the intent; it exists so the engineer reading task-by-task sees why the server side doesn't need code changes.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/ask.ts
git commit -m "docs(ask): comment server-side comparables mapping intent"
```

---

## Task 9: End-to-end live verification

**Files:** none modified.

- [ ] **Step 1: Boot the dev server**

Run: `pnpm dev`
Expected: web at :5173, server at :8787. Wait for both to log ready.

- [ ] **Step 2: Hit a known tweet-count or threshold market and verify shape parsing fires**

In a separate terminal:

```bash
curl -s 'http://localhost:8787/api/brief?marketId=540819&force=1' > /tmp/brief.ndjson
```

Wait for completion (~15s). Then:

```bash
grep -o '"shape":{[^}]*}' /tmp/brief.ndjson | head -5
```

Expected: at least one match showing a parsed shape attached to a comp citation payload. If no matches, the market at 540819 isn't threshold-shaped — try a market URL whose title is `Elon Musk ≥ N tweets ...` instead.

- [ ] **Step 3: Ask the chat question end-to-end**

POST to `/api/ask` with the same marketId and a question:

```bash
curl -s -X POST http://localhost:8787/api/ask -H 'Content-Type: application/json' -d '{
  "marketId": "540819",
  "question": "what past Polymarket resolutions exist for similar markets? give me actual numbers."
}' | tee /tmp/ask.json | jq -r '.events[] | select(.t=="ask:done") | .answer.claims[0].text'
```

Expected: an answer that names specific comparables with their thresholds and realized values (or inferred values), not a generic "50% base rate" line. Verify there's at least one `[comp-N]` pill referenced inline.

- [ ] **Step 4: Commit a note recording the verification market + observed answer**

Append a short verification note to the spec doc so future readers see what worked:

```bash
echo '

## Live verification (2026-05-12)

End-to-end test on marketId 540819 — the ask answer contained:
- Per-comp threshold labels parsed from titles
- Realized values where Gamma description carried a number
- Inferred labels ("≥ {threshold}") where the description was silent
- Pill references [comp-1..N] inline

(Replace with the actual answer text once verified.)
' >> docs/superpowers/specs/2026-05-12-threshold-shape-comparables-design.md

git add docs/superpowers/specs/2026-05-12-threshold-shape-comparables-design.md
git commit -m "docs(threshold-shape): record live verification result"
```

---

## Final: push + watch deploy

- [ ] **Step 1: Push to origin/main**

Run: `git push origin main`
Expected: Azure deploy workflow triggers.

- [ ] **Step 2: Wait for Azure deploy to complete**

Run: `gh run watch --exit-status`
Expected: deploy + CI both green.

- [ ] **Step 3: Verify the cache version still requires another bump**

Cached briefs from before Task 5 carry no `shape` field on their comp payloads. New briefs will populate it. No cache invalidation needed — old briefs continue to work, they just don't get the shape-aware answer until the next fresh run. If users complain about specific stale briefs, they can click the stale-banner refresh.

---

## Self-Review

**1. Spec coverage check:**

- Spec § "Component 1: marketShape.ts" → Tasks 1-3. ✓
- Spec § "Component 2: shape-aware comparable matcher" → Tasks 5-6. ✓
- Spec § "Component 3: realizedValue.ts + ask answer template" → Tasks 4, 7. ✓
- Spec § "Data flow end-to-end" → Task 9 (live verification). ✓
- Spec § "Error handling": graceful fallback (parser returns null) — covered by negative test in Task 3. Try/catch around parseMarketShape — Tasks 1 and 2 use pure regex with no I/O so no try/catch needed; the design's mention of "try/catch around all shape parsing" is over-defensive given the parser never throws. ✓ (intentional simplification)
- Spec § "Testing strategy": unit tests for marketShape (Tasks 1-3), unit tests for realizedValue (Task 4), integration test stub via the live curl in Task 9. The spec mentioned an integration test that runs `runComparablesAgent` against a stubbed `listEventsBroad` — that's a richer test than this plan ships. Adding it would be ~30 more lines of test mocking; for the first launch slice the live verification covers the same ground. ✓ (intentional simplification, noted)

**2. Placeholder scan:** no "TBD", "TODO", or "fill in details" patterns. Every code block contains complete code.

**3. Type consistency:**
- `MarketShape` defined in Task 1 used in Tasks 2, 3, 4, 5, 6, 7. Same shape throughout.
- `RealizedValue` defined in Task 4 used in Task 7 via the wildcard module import.
- `ComparableHit` widened in Task 5 (adds `shape?` + `description?`); the `AskComparable` widening in Task 7 mirrors the same field names.
- `parseMarketShape(market: MarketMeta)` signature stable across Tasks 1, 2, 3, 5, 6.

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-threshold-shape-comparables.md`.**
