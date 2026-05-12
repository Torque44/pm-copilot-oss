# Threshold-shape comparables: structured per-market answers

**Date:** 2026-05-12
**Status:** Design approved 2026-05-12 (b-scope locked: all threshold-in-window markets, deterministic parser only)

## Why this exists

The ask agent currently answers "give me past Polymarket resolution data" with a generic base-rate count: *"8 resolved comparables, 4 YES / 4 NO, 50% base rate"*. A trader on a tweet-count or weather market wants the **actual numbers** instead: *"Apr 28 market 'Musk ≥ 200 tweets' resolved YES at 97¢ — he hit ~213"*. That's the bar this design hits.

The gap is structural. Each comparable today carries `{eventId, title, endDate, outcome: 'yes'|'no', resolvedPrice, slug, score}` — no threshold, no realized value, no window. The matcher uses keyword overlap so unrelated markets surface alongside genuinely similar ones. And the ask SYS prompt has no per-shape answer template, so the LLM picks a generic phrasing.

This design adds three deterministic, no-LLM components that close all three gaps for **threshold-in-window markets** — the dominant Polymarket shape covering tweet counts, weather thresholds, crypto/equity price ≥ X markets, vote shares, sports score totals, and similar.

## Scope (locked)

**In scope (scope b):**
- All markets of the form `{entity} {metric} {comparator} {threshold} {time-window}`.
  Examples: "Elon Musk tweets ≥ 200 between Apr 28 and May 4", "Highest NYC temperature this week ≥ 95°F", "BTC ≥ $100k by Dec 31 2026", "Will NYC see ≥ 1 inch of snow before Dec 31?".

**Realized-value primary source:** Polymarket Gamma's resolution-note text (`description`, `resolutionWording`, and `umaResolutionStatuses` fields). Free, deterministic, no external API key required.

**Out of scope (deferred):**
- LLM fallback when the regex parser can't extract a shape.
- Domain-specific realized-value APIs (NWS for weather, X for tweets, CoinGecko for crypto). These plug in later as gaps surface.
- Binary-event markets ("Will X happen by Y date" with no continuous measurement). Scope (c).
- Multi-outcome markets (who-wins events). Scope (d).

## Architecture

Three new modules + targeted edits to existing files. Comparables remain LLM-free; only the ask agent's prompt construction changes shape, not its LLM call shape.

```
                    +-------------------------+
                    | marketShape.ts (NEW)    |
                    |                         |
   MarketMeta ----> | parseMarketShape()      | --> MarketShape | null
                    +-------------------------+
                                 |
                                 v
                    +-------------------------+
  comparables.ts    | shape-aware matcher     |
  (MODIFIED) -----> | (when both sides parse) | --> ranked comps
                    |                         |
                    | falls back to keyword   |
                    | matcher otherwise       |
                    +-------------------------+
                                 |
                                 v
                    +-------------------------+
                    | realizedValue.ts (NEW)  |
                    |                         |
   Gamma payload -> | extractRealizedValue()  | --> { value, confidence }
                    +-------------------------+
                                 |
                                 v
                    +-------------------------+
  ask.ts (MOD) ---> | describeComparables()   | --> structured prompt block
                    | + SYS rule for shape-   |     with per-comp lines
                    | parsed past-resolution  |
                    | questions               |
                    +-------------------------+
```

## Component 1: marketShape.ts

**Location:** `packages/core/src/agents/marketShape.ts` (new)

**Public surface:**

```ts
export type MarketShape = {
  /** Normalised lowercase entity: 'elon musk' | 'nyc' | 'btc' | 'trump'. */
  entity: string;
  /** Normalised metric noun: 'tweets' | 'temperature' | 'price' | 'snow'. */
  metric: string;
  /** Comparison operator between the metric and the threshold. */
  comparator: '>=' | '<=' | '>' | '<' | 'between';
  /** Numeric threshold. For 'between', this is the lower bound. */
  threshold: number;
  /** Upper bound when comparator is 'between'. */
  thresholdUpper?: number;
  /** Optional unit string for display ('tweets', '°F', '$', 'in'). */
  unit?: string;
  /** Resolution window. start may be null when the market is open-ended
   *  ("Will BTC hit $100k by Dec 31?"); end is always set (= market.endDate). */
  window: { start: string | null; end: string };
  /** Original raw matched substrings — useful for debugging mismatches. */
  source: { titlePart?: string; resolutionPart?: string };
};

export function parseMarketShape(market: MarketMeta): MarketShape | null;
```

**Behaviour:**
- Pure deterministic regex over `market.title` and `market.resolutionWording`. No LLM, no network.
- Returns `null` when no shape pattern matches — caller falls back to today's keyword matcher.
- Recognises common Polymarket phrasings:
  - `{entity} {metric} (between|over|under|at least|at most|≥|≤|>|<) {N}` → `{>=, <=, >, <, between}`
  - `Will {entity} {verb} {metric} {N} {by|before} {date}` → comparator inferred from verb (hit/reach → `>=`, fall to → `<=`, etc.)
  - `Highest/Lowest {metric} of {entity} {window}` → max/min framing; threshold parsed from companion criteria text
- Window parsed from `market.endDate` plus duration hints in title ("this week", "between A and B"); when no start is stated, `window.start = null`.

**Testing:**
- Snapshot test ~30 real Polymarket titles spanning tweet count / temperature / price / snow / vote share / sports total / hurricane landfall. Each has an expected `MarketShape | null` output committed alongside the regex.
- Test that titles outside threshold-in-window shape return `null` (multi-outcome, free-form binary events).

## Component 2: shape-aware comparable matcher

**Location:** `packages/core/src/agents/comparables.ts` (modified, ~80 added lines)

**Behaviour:**

When the *current* market parses to a `MarketShape`:

1. For each candidate event from the Gamma scan, parse its top sub-market to a shape.
2. Score by shape similarity:
   - `+5.0` same `(entity, metric)` pair — same person tweeting, same city's weather
   - `+2.5` same `metric` only — different entity, same kind of measurement
   - `+1.0` same time-scale: comparable's window duration within 0.5×-2× of the current market's window duration (so a weekly market matches other 1-2 week windows but not monthly markets)
   - `+0.5` threshold within 0.67×-1.5× of current's threshold (so `≥200 tweets` matches `≥150` and `≥250` but not `≥10` or `≥1000`)
   - `0` no shape match (the existing keyword/synonym scorer still gives this some weight as a floor)
3. Resolved comparables outrank unresolved at equal score (existing tiebreak preserved).
4. Top 15 retained (existing cap).

When the current market doesn't parse: fall back to today's keyword + synonym matcher unchanged. Shape parser failures are silent — coverage degrades gracefully.

**Public surface:** unchanged. `runComparablesAgent` returns the same `AgentResult` with `ComparableHit[]`, just with the parsed shape attached to the citation payload when available so downstream consumers (Component 3) can read it without re-parsing.

```ts
export type ComparableHit = {
  // ...existing fields...
  /** Parsed shape of this comparable when it fits the threshold-in-window
   *  pattern. Null when the comparable's title didn't parse. */
  shape?: MarketShape | null;
};
```

## Component 3: realizedValue.ts + ask answer template

**Location:**
- `packages/core/src/agents/realizedValue.ts` (new)
- `packages/core/src/agents/ask.ts` (modified)

**realizedValue.ts public surface:**

```ts
export type RealizedValue = {
  /** The realized number when extractable. */
  value: number | null;
  /** How we got it. */
  source: 'gamma-note' | 'inferred-from-outcome' | 'unknown';
  /** Free-text display of the value with unit ('213 tweets', '97°F', '$104,231'). */
  display: string | null;
};

export function extractRealizedValue(
  comp: ComparableHit,
  shape: MarketShape | null,
): RealizedValue;
```

**Extraction priority:**

1. **Gamma resolution-note text** (`comp.payload.description`, `resolutionWording`, `umaResolutionStatuses`). Regex for patterns like:
   - `"settled at (\d+)"`, `"final count: (\d+)"`, `"closed at \$(\d[\d,]*)"`, `"high of (\d+)°?F"`, `"received (\d+(?:\.\d+)?) inches"`
   - Returns `{ value: <parsed>, source: 'gamma-note', display: <formatted with unit> }`.
2. **Inference from `outcome` + `threshold`** when no number is found:
   - `outcome: 'yes'` with `comparator: '>='` → realized ≥ threshold; `display = '≥ {threshold}{unit}'`, `value: null`
   - `outcome: 'no'` with `comparator: '>='` → realized < threshold; `display = '< {threshold}{unit}'`, `value: null`
   - Same logic mirrored for `<=`, `>`, `<`, `between`.
   - Returns `source: 'inferred-from-outcome'`.
3. **Empty** when neither (1) nor (2) applies (rare — only when the comparable has no parsed shape AND no parseable note): `{ value: null, source: 'unknown', display: null }`. Comp is still surfaced but reported with outcome only — same as today.

**ask.ts changes:**

`describeComparables()` is updated to include the parsed shape and realized value for each comp when available:

```
Resolved comparables (n=5 resolved, base rate 60% YES at this threshold band):
[comp-1] Apr 21-27 — Musk ≥ 200 tweets — realized ~213 tweets — resolved YES @ 97¢
[comp-2] Apr 14-20 — Musk ≥ 150 tweets — realized ~178 tweets — resolved YES @ 94¢
[comp-3] Apr 7-13  — Musk ≥ 250 tweets — realized ~187 tweets — resolved NO  @  4¢
[comp-4] Mar 31    — Musk ≥ 200 tweets — realized ≥ 200 (inferred)  — resolved YES @ 100¢
[comp-5] Mar 24    — Musk ≥ 175 tweets — realized < 175 (inferred)  — resolved NO  @  2¢
```

The ask SYS prompt's existing "PAST RESOLUTION DATA" answer-type rule gets a shape-aware sub-rule:

> When the current market parses to a shape AND comparables include parsed shapes with realized values, the answer MUST quote specific realized numbers per [comp-N] cite, not just YES/NO outcomes. Lead with the directly-comparable threshold band; surface the base rate within that band, not across the full set.

The SYS prompt's CITATION PILLS list is unchanged (`[comp-N]` already documented in the prior fix).

## Data flow end-to-end

1. User selects the Elon-tweet-count market in the workbench. Brief streams.
2. The supervisor's comparables agent runs (already in the pipeline). Inside it:
   - `parseMarketShape(market)` returns `{ entity: 'elon musk', metric: 'tweets', comparator: '>=', threshold: 200, window: { start, end } }`.
   - For each Gamma candidate event, parse its sub-market's shape, score by shape similarity, take top 15.
   - For each kept comp, run `extractRealizedValue(comp, shape)` and attach to the payload.
3. User asks "give me past resolution data for similar markets".
4. The ask agent's `ensureGrounding` already pulls comparables (commit `aafe3a5`). The comps now have `shape` + realized payloads attached.
5. `describeComparables()` emits the structured block above into the LLM prompt.
6. The shape-aware SYS rule fires; the LLM produces an answer that names specific tweet counts per `[comp-N]`.

No new LLM calls. No new network calls. The realized-value extractor is regex over data we already fetch.

## Error handling

- Parser returns `null` → keyword matcher takes over; behaviour matches pre-fix.
- Gamma resolution-note text missing for a comp → realized value falls back to "inferred-from-outcome" or "unknown"; comp is still rendered with outcome only.
- Realized-value regex matches incorrectly → display string carries source tag (`'~213'` for gamma-note vs `'≥ 200'` for inferred); the LLM can hedge appropriately. No crash path.
- All shape parsing is wrapped in try/catch; an unexpected regex failure logs `[market-shape] parse failed: <error-class>` (no title leaked per logging policy) and returns null.

## Testing strategy

**Unit tests:**
- `marketShape.test.ts` — snapshot ~30 Polymarket titles (tweet count / temperature / price / snow / vote share / sports total / hurricane landfall) with expected shape outputs. Includes negative cases (multi-outcome, free-form binary).
- `realizedValue.test.ts` — ~20 Gamma resolution-note payloads from real resolved markets, expected realized values per priority tier. Includes "inferred-from-outcome" and "unknown" branches.

**Integration test:**
- One end-to-end test that runs `runComparablesAgent` against a stubbed `listEventsBroad` returning the 30+ titles, asserts the top-5 comps for a tweet-count market are all tweet-count markets (no random keyword overlap leakers).

**Live verification:**
After deploy, on the Elon-tweet-count market, ask *"what past Polymarket resolutions exist for similar markets?"* and expect specific tweet counts per comp instead of a generic base-rate summary.

## File layout

```
packages/core/src/agents/
  marketShape.ts            NEW — parseMarketShape()
  marketShape.test.ts       NEW — title snapshot tests
  realizedValue.ts          NEW — extractRealizedValue()
  realizedValue.test.ts     NEW — gamma-note extraction tests
  comparables.ts            MODIFIED — shape-aware matcher + shape attach
  ask.ts                    MODIFIED — describeComparables() + SYS rule update
```

## Risks

| Risk | Mitigation |
|---|---|
| Regex misses 20% of edge-case titles | Graceful fallback to keyword matcher. Tracked via console warn count after deploy; if >5% of briefs fail shape parsing we add LLM fallback. |
| Gamma resolution-note format varies and breaks the realized-value regex | Multi-pattern regex list; if all patterns fail, fall through to inference-from-outcome. Display tag (`~213` vs `≥ 200`) tells the LLM which it is. |
| Shape similarity over-prioritizes structural match and drops semantically similar but differently-shaped comps | The keyword/synonym scorer still contributes a floor weight even when shape matches add bonus points — semantically similar markets aren't excluded, just outranked by shape-perfect ones. |
| LLM ignores the per-comp realized values and falls back to its old generic phrasing | SYS rule says MUST quote specific numbers. Add a one-shot example in the SYS prompt showing the desired output format. |

## Out of scope (explicit)

- Domain-specific realized-value APIs (NWS, X, CoinGecko). These slot in later as a registry `realizedValueProviders.ts` when (1) Gamma extraction and (2) outcome inference both fail for a meaningful fraction of comps.
- LLM fallback for unparseable shapes.
- Binary-event markets (scope c) and multi-outcome markets (scope d).
- Frontend UI changes — the comparables panel renders the same `[comp-N]` rows. Shape data lives only in the ask agent's prompt construction.

## Verification examples

After ship, on the Elon-tweet-count market, the question "give me past resolution data for similar markets" should produce something like:

> Of 5 comparable Musk tweet-count markets in the last 8 weeks, **3 resolved YES, 2 NO** (60% base rate at the 175-225 threshold band):
> - **Apr 21-27 (≥ 200)** — Musk hit ~213 tweets, resolved YES at 97¢ [comp-1]
> - **Apr 14-20 (≥ 150)** — Musk hit ~178 tweets, resolved YES at 94¢ [comp-2]
> - **Apr 7-13 (≥ 250)** — Musk hit ~187 tweets, resolved NO at 4¢ [comp-3]
> - **Mar 31 (≥ 200)** — resolved YES at 100¢ (no exact count in resolution note, but implied ≥ 200) [comp-4]
> - **Mar 24 (≥ 175)** — resolved NO at 2¢ (implied < 175) [comp-5]
>
> The 200 threshold this week is right at his recent average. Base rate at this threshold band: 60% YES.

On a weather market ("Highest NYC temperature week of Jun 16-22 ≥ 95°F"):

> Of 6 comparable NYC summer-high markets in the last 4 weeks:
> - **Jun 9-15 (≥ 95°F)** — NYC hit 97°F (LGA), resolved YES at 99¢ [comp-1]
> - **Jun 2-8 (≥ 90°F)** — NYC hit 88°F, resolved NO at 2¢ [comp-2]
> - **May 26-Jun 1 (≥ 85°F)** — NYC hit 91°F, resolved YES at 100¢ [comp-3]
>
> Threshold this week is 92°F. Past resolutions at the 90-95°F band: 4 of 6 YES (67%).

## Live verification notes (2026-05-12)

End-to-end verification status at the close of the implementation pass:

**Unit coverage**: 119 tests pass. `marketShape.test.ts` exercises tweet-count, temperature, price, precipitation parsers plus negative cases plus the year-prefix and "Will CITY see" regression tests. `realizedValue.test.ts` exercises all three priority tiers including top-level + nested description paths.

**Cold-cache integration check (non-threshold market)**: ran `/api/brief?marketId=540819&force=1` against the "Will Jesus Christ return before GTA VI?" event. Result: 5 comparable citations, **0 with parsed shapes**. This is correct — the query market is a binary-event shape (scope c), so `queryShape` is null and the candidate-shape parser is correctly skipped. The keyword-only fallback continues to produce comparables.

**Cold-cache integration check (threshold market)**: deferred. Polymarket's current top-100-by-volume catalog has no active threshold-in-window markets (no tweet-count, temperature, snow, or threshold-priced markets in the trending feed). Pipeline correctness for threshold markets is locked in by unit tests but the human-readable answer text for a real threshold market on the live URL will need to be inspected when one surfaces.

**Recommended live retry**: when a threshold market does appear (e.g., a weekly Musk tweet-count market, a daily NYC weather market, a "BTC ≥ $X by date" market), open it in the workbench, ask "what past Polymarket resolutions exist for similar markets?", and confirm the answer cites per-comp threshold + realized values (or `(inferred)` markers) rather than collapsing to a base-rate one-liner.
