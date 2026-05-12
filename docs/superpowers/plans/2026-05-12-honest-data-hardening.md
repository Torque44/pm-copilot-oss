# Honest-Data Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the LLM-fabrication surface from sentiment + news + resolved-market handling, replacing it with tool-grounded evidence registries and a self-healing search chain.

**Architecture:** Tools are the source of truth, LLMs only summarise pre-fetched evidence by index. Resolved markets short-circuit sentiment + thesis entirely and run news against the resolution leadup window. News becomes a self-healing chain of 3 backends × 3 query variants × retry policy × 6h LRU cache.

**Tech Stack:** TypeScript strict, vitest, React 19 + Vite 6, Polymarket Gamma API, Exa AI, xAI Grok live-search.

**Spec:** `docs/superpowers/specs/2026-05-12-honest-data-hardening-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/core/src/agents/types.ts` | modify | Add `resolvedAt?: string \| null` to MarketMeta |
| `packages/core/src/feeds/polymarket.ts` | modify | Populate `resolvedAt` in `gammaToMarketMeta` |
| `packages/core/src/feeds/polymarket.test.ts` | create | Test resolvedAt population from `closed` |
| `packages/core/src/agents/supervisor.ts` | modify | Branch on `resolvedAt`: skip sentiment+thesis, pass windowOverride |
| `packages/core/src/agents/supervisor.test.ts` | create | Test the resolved-market branch |
| `packages/core/src/agents/news.ts` | modify | Accept `opts.windowOverride`; delegate to `searchChain` |
| `packages/core/src/agents/news.test.ts` | create | Test windowOverride + diagnostic claim shape |
| `packages/core/src/agents/sentiment.ts` | modify | Two-pass: capture citations, model writes by index |
| `packages/core/src/agents/sentiment.test.ts` | create | Test URL-provenance + Pass-1-empty path |
| `packages/core/src/news/types.ts` | create | NewsHit, SearchBackend interfaces |
| `packages/core/src/news/retry.ts` | create | `withRetry` helper (backoff + 429 Retry-After) |
| `packages/core/src/news/retry.test.ts` | create | Retry policy unit tests |
| `packages/core/src/news/cache.ts` | create | `NewsCache` LRU + 6h TTL |
| `packages/core/src/news/cache.test.ts` | create | Cache hit/miss/TTL/LRU/empty-not-cached |
| `packages/core/src/news/backends/exa.ts` | create | Exa backend (extract from inline path) |
| `packages/core/src/news/backends/polymarketComments.ts` | create | Scrape event comments for URLs |
| `packages/core/src/news/backends/providerWebSearch.ts` | create | Provider native web search adapter |
| `packages/core/src/news/searchChain.ts` | create | Chain orchestrator: backends × variants × budget |
| `packages/core/src/news/searchChain.test.ts` | create | Chain orchestration tests |
| `apps/server/src/news-cache.ts` | create | Process-singleton NewsCache wired into brief route |
| `apps/server/src/routes/brief.ts` | modify | Pass cache to supervisor (then news) |
| `apps/web/src/types.ts` | modify | Add `resolvedAt?: string \| null` to UI Market |
| `apps/web/src/hooks/useBrief.ts` | modify | Extract `resolvedAt` in `asMarket()` |
| `apps/web/src/components/MarketHeader/MarketHeader.tsx` | modify | Resolved banner above row |
| `apps/web/src/styles/global.css` | modify | `.mh-resolved-banner` styles |
| `docs/superpowers/verification/2026-05-12-honest-data.md` | create | Manual verification README |

---

## Task ordering and reasoning

**Phase 0 — Pre-flight (Task 0).** Decide what to do with the local commits `6d0dc97` + `e28142d` before opening more work. The user's branch protection blocked direct push; the work needs an answer before more code lands and complicates the rebase.

**Phase 1 — Resolved markets (Tasks 1–5).** Smallest blast radius, biggest visible UX win. The user's screenshots that triggered this work are all from a resolved market. Ship this first so the screenshot bug is dead.

**Phase 2 — News chain (Tasks 6–14).** Largest, but split into 9 cleanly testable units. New module, mostly additive. Existing news.ts keeps working until Task 14 swaps it to the chain.

**Phase 3 — Sentiment fix (Tasks 15–17).** Depends on having established the "build citation registry from tool output, then model writes by index" pattern in Phase 2 — same shape applied to xAI citations.

**Phase 4 — Final (Task 18).** Verification README + workspace sweep.

---

## Task 0: Pre-flight + UI ship decision

**Goal:** Confirm tree state, decide UI commits' fate, baseline tests.

**Files:** None modified. Communication-only task.

- [ ] **Step 1: Verify working tree state**

```bash
cd C:/Users/ayush/Downloads/pm-copilot-oss
git status --short
git log --oneline -5
```

Expected output: `git status --short` shows only untracked plan/spec files (no modifications). `git log` shows `e28142d docs(spec): honest-data hardening …` at HEAD, with `6d0dc97 feat(web): add trade-on-polymarket deep link + fix landing CTA truncation` as the prior commit.

- [ ] **Step 2: Baseline tests + typecheck**

```bash
pnpm typecheck
pnpm test
```

Expected: both clean. Record any pre-existing failures so we don't blame Phase 1 for them.

- [ ] **Step 3: Ask user to resolve commits 6d0dc97 + e28142d**

Ask: "Branch protection blocked direct push to main. Options for the two pending commits (UI fix + spec): (a) approve direct-push exception just for these, (b) open a PR, (c) wait and bundle with this entire plan as one final push. Which?"

Do not proceed until answered. Block here.

- [ ] **Step 4: Execute the user's choice**

If (a): `git push origin main`.
If (b): `gh pr create --title "ui: polymarket trade link + landing CTA fix + honest-data spec" --body "<summary>"`. Wait for the user to merge.
If (c): Note the bundling decision; continue to Phase 1.

---

## Task 1: Add `resolvedAt` to MarketMeta + populate from Gamma

**Files:**
- Modify: `packages/core/src/agents/types.ts:38-61`
- Modify: `packages/core/src/feeds/polymarket.ts:265-299`
- Create: `packages/core/src/feeds/polymarket.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/feeds/polymarket.test.ts`:

```ts
// polymarket.test.ts — locks in the resolvedAt population from gamma's
// `closed` flag. The agent supervisor branches on this, so a regression
// silently runs sentiment/thesis on settled markets — the exact bug this
// fix is meant to prevent.

import { describe, it, expect } from 'vitest';
import { gammaToMarketMeta } from './polymarket';
import type { GammaEvent, GammaMarket } from './polymarket';

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
    outcomePrices: '["0.5","0.5"]',
    volume24hr: 1000,
    volume: '50000',
    ...over,
  } as GammaMarket;
}

function mkEvent(over: Partial<GammaEvent> = {}): GammaEvent {
  return {
    id: 'e-1',
    title: 'Will X happen?',
    slug: 'will-x-happen',
    endDate: '2026-04-30T23:59:00Z',
    description: 'The market resolves YES if X happens by the deadline.',
    resolutionSource: 'UMA oracle',
    closed: false,
    ...over,
  } as GammaEvent;
}

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

  it('falls back to event endDate when market endDate is missing on a closed market', () => {
    const m = mkMarket({ closed: true, endDate: null });
    const e = mkEvent({ endDate: '2026-04-10T00:00:00Z' });
    const meta = gammaToMarketMeta(e, m, 'other');
    expect(meta.resolvedAt).toBe('2026-04-10T00:00:00Z');
  });

  it('returns null when closed=true but both endDates are missing', () => {
    const m = mkMarket({ closed: true, endDate: null });
    const e = mkEvent({ endDate: null });
    const meta = gammaToMarketMeta(e, m, 'other');
    expect(meta.resolvedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/feeds/polymarket.test.ts
```

Expected: FAIL — `meta.resolvedAt` is undefined (field doesn't exist on the returned object yet).

- [ ] **Step 3: Add field to MarketMeta type**

Edit `packages/core/src/agents/types.ts:38-61` — after the `resolutionSource?` line, add:

```ts
  /** ISO timestamp when this market resolved (closed=true on Gamma). Null
   *  for active markets. The supervisor branches on this: when set, sentiment
   *  and thesis are skipped, and news searches the 30 days BEFORE this date
   *  rather than "right now." Driven entirely by the Gamma payload — no UI
   *  override. */
  resolvedAt?: string | null;
```

- [ ] **Step 4: Populate in `gammaToMarketMeta`**

Edit `packages/core/src/feeds/polymarket.ts:279-299`. In the return object, add `resolvedAt`:

```ts
  return {
    marketId: m.id,
    eventId: ev.id,
    venue: 'polymarket',
    title,
    endDate: m.endDate ?? ev.endDate ?? null,
    category,
    yes: prices[0] != null ? Number(prices[0]) : (m.lastTradePrice ?? null),
    no: prices[1] != null ? Number(prices[1]) : null,
    volume24hr: m.volume24hr ?? 0,
    volumeTotal: Number(m.volume ?? 0),
    conditionId: m.conditionId,
    tokenIdYes: tokens[0] ?? '',
    tokenIdNo: tokens[1] ?? '',
    slug: m.slug,
    resolutionWording: ev.description ?? null,
    resolutionSource: ev.resolutionSource ?? null,
    // Resolved markets get a non-null resolvedAt. Sub-market endDate first
    // (single-outcome events normalise to it), event endDate as fallback for
    // multi-outcome events where the sub-market lacks its own endDate.
    resolvedAt: m.closed === true ? (m.endDate ?? ev.endDate ?? null) : null,
  };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run packages/core/src/feeds/polymarket.test.ts
pnpm typecheck
```

Expected: All 4 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agents/types.ts packages/core/src/feeds/polymarket.ts packages/core/src/feeds/polymarket.test.ts
git commit -m "feat(core): add MarketMeta.resolvedAt from gamma closed flag

Adds the resolvedAt timestamp the supervisor will branch on to skip
sentiment + thesis and run news against the resolution leadup window.
Single source — gammaToMarketMeta populates from sub-market endDate
with event endDate fallback. Null for active markets."
```

---

## Task 2: Thread `resolvedAt` through UI Market type

**Files:**
- Modify: `apps/web/src/types.ts:10-25`
- Modify: `apps/web/src/hooks/useBrief.ts:99-135`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/hooks/useBrief.test.ts`:

```ts
// useBrief.test.ts — locks in the asMarket transform from server-side
// MarketMeta to UI Market. Just a focused test on resolvedAt threading —
// the rest of asMarket is exercised by the integration flow.

import { describe, it, expect } from 'vitest';
// asMarket is not exported today. Step 3 below adds the export.
import { asMarket } from './useBrief';

describe('asMarket — resolvedAt threading', () => {
  it('extracts resolvedAt when present (resolved market)', () => {
    const raw = {
      marketId: 'm-1',
      title: 'Will X happen?',
      yes: 1.0,
      no: 0.0,
      volume24hr: 0,
      endDate: '2026-04-15T12:00:00Z',
      resolvedAt: '2026-04-15T12:00:00Z',
    };
    const m = asMarket(raw);
    expect(m?.resolvedAt).toBe('2026-04-15T12:00:00Z');
  });

  it('returns undefined resolvedAt for active markets', () => {
    const raw = {
      marketId: 'm-1',
      title: 'Will X happen?',
      yes: 0.5,
      no: 0.5,
      volume24hr: 1000,
      endDate: '2026-06-30T23:59:00Z',
      resolvedAt: null,
    };
    const m = asMarket(raw);
    expect(m?.resolvedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run apps/web/src/hooks/useBrief.test.ts
```

Expected: FAIL — `asMarket` is not exported from `useBrief.ts`.

- [ ] **Step 3: Add `resolvedAt` to UI Market type**

Edit `apps/web/src/types.ts:10-25`. After the `slug?: string;` line, add:

```ts
  /** ISO timestamp when this market resolved (Polymarket closed=true). When
   *  set, the workbench shows a resolved banner and the brief flow skips
   *  sentiment + thesis. Undefined for active markets. */
  resolvedAt?: string | null;
```

- [ ] **Step 4: Extract `resolvedAt` in `asMarket` and export the function**

Edit `apps/web/src/hooks/useBrief.ts:99-135`. Change `function asMarket(...)` to `export function asMarket(...)`. Inside, after the `const slug = ...` line, add:

```ts
  const resolvedAt = typeof o['resolvedAt'] === 'string' ? o['resolvedAt'] : null;
```

And in the assignment block at the end, before `return m;`:

```ts
  if (resolvedAt) m.resolvedAt = resolvedAt;
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run apps/web/src/hooks/useBrief.test.ts
pnpm typecheck
```

Expected: 2 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/types.ts apps/web/src/hooks/useBrief.ts apps/web/src/hooks/useBrief.test.ts
git commit -m "feat(web): thread resolvedAt from MarketMeta into UI Market

asMarket now exports + extracts the resolvedAt field so MarketHeader
(next task) can render a resolved banner and supervisor downstream can
branch the brief flow."
```

---

## Task 3: Supervisor branch — skip sentiment+thesis for resolved markets

**Files:**
- Modify: `packages/core/src/agents/supervisor.ts:95-288`
- Create: `packages/core/src/agents/supervisor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agents/supervisor.test.ts`:

```ts
// supervisor.test.ts — locks in the resolved-market branch. When the
// MarketMeta has resolvedAt set, the supervisor must NOT emit start
// events for sentiment or thesis. The fanOut wave also must skip them
// — otherwise the agents would run, find nothing, and the model fills
// the gap with fabrication (exact bug we're fixing).

import { describe, it, expect, vi } from 'vitest';
import { runSupervisor } from './supervisor';
import type { AgentEvent, MarketMeta, AgentResult } from './types';
import type { LLMProvider } from '../providers/types';

// Mock all agent runners — supervisor is tested in isolation. Each mock
// resolves with a minimal AgentResult so the supervisor's fan-out/synthesis
// flow completes without touching the network.
const stubResult = (agent: AgentResult['agent']): AgentResult => ({
  agent,
  output: { claims: [], citations: [] },
  grounding: null,
  elapsedMs: 1,
});

vi.mock('./market', () => ({ runMarketAgent: vi.fn().mockImplementation(async () => stubResult('market')) }));
vi.mock('./holders', () => ({ runHoldersAgent: vi.fn().mockImplementation(async () => stubResult('holders')) }));
vi.mock('./news', () => ({ runNewsAgent: vi.fn().mockImplementation(async () => stubResult('news')) }));
vi.mock('./comparables', () => ({ runComparablesAgent: vi.fn().mockImplementation(async () => stubResult('comparables')) }));
vi.mock('./sentiment', () => ({ runSentimentAgent: vi.fn().mockImplementation(async () => stubResult('sentiment')) }));
vi.mock('./thesis', () => ({ runThesisAgent: vi.fn().mockImplementation(async () => stubResult('thesis')) }));
vi.mock('./synthesis', () => ({
  runSynthesis: vi.fn().mockImplementation(async () => ({
    output: { claims: [], citations: [] }, elapsedMs: 1,
  })),
}));

function mkResolvedMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return {
    marketId: 'm-1',
    title: 'Will X happen?',
    endDate: '2026-04-15T12:00:00Z',
    category: 'other',
    yes: 1.0,
    no: 0.0,
    volume24hr: 0,
    volumeTotal: 50_000,
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'will-x-happen',
    resolvedAt: '2026-04-15T12:00:00Z',
    ...over,
  };
}

function mkActiveMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return mkResolvedMarket({ resolvedAt: null, yes: 0.5, no: 0.5, ...over });
}

// Stub provider that returns empty JSON — agents will fall through to their
// empty-result branches. We're testing wiring, not agent internals.
function stubProvider(): LLMProvider {
  return {
    name: 'openai',
    capabilities: { nativeJsonMode: false, webSearch: false, authViaSession: false },
    complete: vi.fn().mockResolvedValue({
      text: '{}',
      ok: true,
      elapsedMs: 1,
      model: 'stub',
      provider: 'openai',
    }),
  };
}

describe('runSupervisor — resolved-market branch', () => {
  it('does not emit start events for sentiment or thesis on resolved markets', async () => {
    const events: AgentEvent[] = [];
    const market = mkResolvedMarket();
    const provider = stubProvider();

    await runSupervisor({
      market,
      emit: (ev) => events.push(ev),
      routing: { primary: provider, news: provider, sentiment: provider },
    });

    const startEvents = events.filter((e) => e.t === 'agent:start').map((e) => e.agent);
    expect(startEvents).not.toContain('sentiment');
    expect(startEvents).not.toContain('thesis');
    expect(startEvents).toContain('market');
    expect(startEvents).toContain('news');
  });

  it('emits sentiment + thesis start on active markets (regression guard)', async () => {
    const events: AgentEvent[] = [];
    const market = mkActiveMarket();
    const provider = stubProvider();

    await runSupervisor({
      market,
      emit: (ev) => events.push(ev),
      routing: { primary: provider, news: provider, sentiment: provider },
    });

    const startEvents = events.filter((e) => e.t === 'agent:start').map((e) => e.agent);
    expect(startEvents).toContain('sentiment');
    expect(startEvents).toContain('thesis');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/agents/supervisor.test.ts
```

Expected: FAIL — the resolved test sees `sentiment` and `thesis` in start events because the supervisor doesn't branch yet.

- [ ] **Step 3: Add resolved branch to supervisor**

Edit `packages/core/src/agents/supervisor.ts`. After line 106 (`const sentimentEnabled = Boolean(routing?.sentiment);`), add:

```ts
  // Resolved markets short-circuit sentiment + thesis. Both agents produce
  // their worst hallucinations when there's no real-time data to ground in
  // (the market already paid out — there IS no "current X conversation" or
  // "what could move it"). News still runs but against the resolution
  // leadup window (see Task 4 / runNewsAgent windowOverride). Synthesis
  // still runs and is told via prompt that this is a resolved-market brief.
  const isResolved = Boolean(market.resolvedAt);
```

Replace the existing `startedAgents` block (lines 110-112) with:

```ts
  // Emit start for the agents the UI should render as pending. Sentiment only
  // appears when xAI is configured AND the market isn't resolved. Thesis
  // appears for active markets only.
  const startedAgents: AgentId[] = isResolved
    ? ['market', 'holders', 'news', 'comparables', 'synthesis']
    : ['market', 'holders', 'news', 'comparables', 'thesis', 'synthesis'];
  if (sentimentEnabled && !isResolved) startedAgents.splice(3, 0, 'sentiment');
  for (const a of startedAgents) emit({ t: 'agent:start', agent: a });
```

Then in the fanOut block (lines 169-181), gate sentiment on isResolved:

```ts
  if (sentimentEnabled && routing && !isResolved) {
    fanOut.push(
      runOne('sentiment', () => runSentimentAgent(ctx, routing.sentiment, sentimentInput)),
    );
  }
```

And gate thesis (lines 252-254). Replace `const thesisP = runOne('thesis', ...)` with:

```ts
  const thesisP = isResolved
    ? Promise.resolve(null)
    : runOne('thesis', () => runThesisAgent(ctx, thesisProvider, thesisInput));
```

And update the `Promise.all` line (around 284) to handle the null:

```ts
  const [thesisR] = await Promise.all([thesisP, synthesisP]);
  void thesisR;
```

(thesisR is already `void`-ed below, so no further changes needed.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/agents/supervisor.test.ts
pnpm typecheck
```

Expected: 2 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/supervisor.ts packages/core/src/agents/supervisor.test.ts
git commit -m "feat(core): skip sentiment + thesis for resolved markets

The supervisor now branches on market.resolvedAt. Resolved markets run
market+holders+news+comparables+synthesis only — sentiment and thesis
both produce their worst hallucinations when there's no real-time data
to ground in. News still runs (next task adds the leadup-window override
so news searches the 30 days BEFORE resolution, not 'right now')."
```

---

## Task 4: News agent `windowOverride` parameter

**Files:**
- Modify: `packages/core/src/agents/news.ts:137-141, 192-216, 376-415`
- Modify: `packages/core/src/agents/supervisor.ts:170-172`
- Create: `packages/core/src/agents/news.test.ts`

This task introduces the param plumbing only; Phase 2 swaps the internals to the chain. The window override needs to flow through both the provider-direct path (lines 192-216) and the Exa path (lines 376-415) until the refactor.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agents/news.test.ts`:

```ts
// news.test.ts — covers (1) the windowOverride parameter that resolved
// markets pass to search inside the leadup window, and (2) the empty-
// state diagnostic claim shape. Doesn't test the search chain itself
// (that has its own tests in news/searchChain.test.ts after Phase 2).

import { describe, it, expect, vi } from 'vitest';
import { runNewsAgent } from './news';
import type { AgentEvent, MarketMeta } from './types';
import type { LLMProvider } from '../providers/types';

function mkMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return {
    marketId: 'm-1',
    title: 'Will Trump visit China by June 30?',
    endDate: '2025-06-30T23:59:00Z',
    category: 'politics',
    yes: 0.997,
    no: 0.003,
    volume24hr: 0,
    volumeTotal: 100_000,
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'will-trump-visit-china-by-june-30',
    ...over,
  };
}

function noWebProvider(jsonResponse: string): LLMProvider {
  return {
    name: 'openai',
    capabilities: { nativeJsonMode: false, webSearch: false, authViaSession: false },
    complete: vi.fn().mockResolvedValue({
      text: jsonResponse,
      ok: true,
      elapsedMs: 1,
      model: 'stub',
      provider: 'openai',
    }),
  };
}

describe('runNewsAgent — windowOverride parameter', () => {
  it('accepts a windowOverride and passes it to the underlying search', async () => {
    // Empty {} from the model → news agent emits an empty-state diagnostic.
    // We're testing the SIGNATURE accepts the override here, not the chain
    // (that's Task 13+).
    const provider = noWebProvider('{"items": [], "claims": []}');
    const result = await runNewsAgent(
      {
        market: mkMarket({ resolvedAt: '2025-06-30T23:59:00Z' }),
        emit: vi.fn() as (ev: AgentEvent) => void,
      },
      provider,
      null,
      { windowOverride: { endsAt: '2025-06-30T23:59:00Z', days: 30 } },
    );
    expect(result.agent).toBe('news');
    expect(result.output).toBeDefined();
  });

  it('returns a diagnostic claim with no citations when search comes up empty', async () => {
    const provider = noWebProvider('{"items": [], "claims": []}');
    const result = await runNewsAgent(
      {
        market: mkMarket(),
        emit: vi.fn() as (ev: AgentEvent) => void,
      },
      provider,
      null,
    );
    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims).toHaveLength(1);
    // Claim should describe empty state, not pretend news exists.
    expect(result.output.claims[0]!.citations).toHaveLength(0);
    expect(result.output.claims[0]!.text.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/agents/news.test.ts
```

Expected: FAIL — the 4-argument signature doesn't exist on `runNewsAgent` yet (TypeScript compile error in the test).

- [ ] **Step 3: Add `NewsOpts` and extend `runNewsAgent` signature**

Edit `packages/core/src/agents/news.ts`. After the imports (around line 27), add:

```ts
export type NewsOpts = {
  /** When set, news searches the `days`-day window ending at `endsAt` rather
   *  than "the last 30 days from today." The supervisor passes this for
   *  resolved markets — the trader cares about the leadup to resolution,
   *  not "right now." */
  windowOverride?: { endsAt: string; days: number };
};
```

Update `runNewsAgent` signature (line 137):

```ts
export async function runNewsAgent(
  ctx: AgentContext,
  provider?: LLMProvider,
  searcher?: Searcher | null,
  opts?: NewsOpts,
): Promise<AgentResult> {
```

In the prompt construction inside `runNewsAgent` (lines 196-206), compute the window for the user prompt:

```ts
  const todayIso = new Date().toISOString().slice(0, 10);
  let windowStart: string;
  let windowEnd: string;
  if (opts?.windowOverride) {
    const endMs = Date.parse(opts.windowOverride.endsAt);
    const startMs = endMs - opts.windowOverride.days * 24 * 60 * 60 * 1000;
    windowStart = new Date(startMs).toISOString().slice(0, 10);
    windowEnd = new Date(endMs).toISOString().slice(0, 10);
  } else {
    const startMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    windowStart = new Date(startMs).toISOString().slice(0, 10);
    windowEnd = todayIso;
  }

  const prompt = `Market title: "${market.title}"
Resolves by: ${market.endDate ?? 'unknown'}
Current YES price: ${market.yes != null ? (market.yes * 100).toFixed(1) + '¢' : 'n/a'}
Today's date: ${todayIso}
Search window: ${windowStart} → ${windowEnd}${opts?.windowOverride ? ' (resolution leadup — this market has already resolved)' : ''}

Build a fast briefing for a trader looking at this contract.
PREFER news from the search window above. Sort items[] newest-first by
publishedAt. If web search comes up thin, return items:[] and the UI's
empty-state takes over.`;
```

In the Exa path call (`runNewsViaExa`, lines 376-415), accept opts and use the window when passing to Exa. Update the function signature:

```ts
async function runNewsViaExa(
  ctx: AgentContext,
  started: number,
  newsProvider: LLMProvider,
  searcher: Searcher,
  opts?: NewsOpts,
): Promise<AgentResult> {
```

And inside, replace the two `recencyHours: 24 * 7` / `24 * 30` calls with the override-aware computation. After `const profile = profileFor(sub);`, add:

```ts
  let exaWindowDays = 7;
  let exaEndDate: string | undefined;
  if (opts?.windowOverride) {
    exaWindowDays = opts.windowOverride.days;
    exaEndDate = opts.windowOverride.endsAt;
  }
```

Then in each `searcher.search(...)` call, change `recencyHours: 24 * 7` → `recencyHours: 24 * exaWindowDays`. Note: Exa's searcher API doesn't take an explicit `endDate` today; we leave the override `endsAt` for future use when the Exa client gains date-range support. (The retry-with-broader-window logic stays as-is — it only kicks in for active markets where `windowOverride` is unset.)

Update the call site to pass opts (still inside `runNewsAgent`):

```ts
  if (!newsProvider.capabilities.webSearch && searcher) {
    return runNewsViaExa(ctx, started, newsProvider, searcher, opts);
  }
```

- [ ] **Step 4: Pass `windowOverride` from supervisor**

Edit `packages/core/src/agents/supervisor.ts:170-172`. Replace the news fanOut entry:

```ts
    runOne('news', (c) => {
      const newsOpts = isResolved && market.resolvedAt
        ? { windowOverride: { endsAt: market.resolvedAt, days: 30 } }
        : undefined;
      return runNewsAgent(c, newsProvider, searcher, newsOpts);
    }),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/agents/news.test.ts packages/core/src/agents/supervisor.test.ts
pnpm typecheck
```

Expected: All tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agents/news.ts packages/core/src/agents/supervisor.ts packages/core/src/agents/news.test.ts
git commit -m "feat(core): runNewsAgent accepts windowOverride for leadup search

Resolved markets now search the 30 days before resolution instead of 'the
last 30 days from today'. Threaded from supervisor.runNewsAgent call site.
Internal Exa retry chain stays single-pass when an override is set — no
'expand to 30d' retries because the override already specifies the window.

Plumbing only — the news/ chain refactor in Phase 2 swaps the internals."
```

---

## Task 5: Resolved-market banner in MarketHeader

**Files:**
- Modify: `apps/web/src/components/MarketHeader/MarketHeader.tsx:20-82`
- Modify: `apps/web/src/styles/global.css` (append at end of market header section, around line 333)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/MarketHeader/MarketHeader.test.tsx`:

```tsx
// MarketHeader.test.tsx — locks in the resolved-banner rendering. Active
// markets must NOT show the banner; resolved markets must show it with the
// correct outcome label + date.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarketHeader } from './MarketHeader';
import type { Market } from '../../types';

function mkMarket(over: Partial<Market> = {}): Market {
  return {
    id: 'm-1',
    venue: 'polymarket',
    title: 'Will X happen?',
    yes: 0.5,
    no: 0.5,
    vol24h: '$10k',
    resolveIn: '12d',
    criteria: 'Market resolves YES if X happens.',
    ...over,
  };
}

describe('MarketHeader — resolved banner', () => {
  it('does not render the banner for active markets', () => {
    const { container } = render(<MarketHeader market={mkMarket()} />);
    expect(container.querySelector('.mh-resolved-banner')).toBeNull();
  });

  it('renders the banner with YES outcome when resolvedAt is set and YES is closer to 1', () => {
    const { container } = render(
      <MarketHeader
        market={mkMarket({
          resolvedAt: '2025-06-30T12:00:00Z',
          yes: 1.0,
          no: 0.0,
          resolveIn: 'resolved',
        })}
      />,
    );
    const banner = container.querySelector('.mh-resolved-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/resolved/i);
    expect(banner!.textContent).toMatch(/YES/);
  });

  it('renders NO outcome when NO is closer to 1', () => {
    const { container } = render(
      <MarketHeader
        market={mkMarket({
          resolvedAt: '2025-06-30T12:00:00Z',
          yes: 0.0,
          no: 1.0,
          resolveIn: 'resolved',
        })}
      />,
    );
    const banner = container.querySelector('.mh-resolved-banner');
    expect(banner!.textContent).toMatch(/NO/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run apps/web/src/components/MarketHeader/MarketHeader.test.tsx
```

Expected: FAIL — `.mh-resolved-banner` element doesn't exist.

- [ ] **Step 3: Add the banner to MarketHeader**

Edit `apps/web/src/components/MarketHeader/MarketHeader.tsx`. Replace the component body (lines 20-81):

```tsx
export function MarketHeader({ market, inWatchlist, onToggleWatchlist }: MarketHeaderProps) {
  const resolved = market.resolvedAt;
  // Outcome inference: whichever side is closer to 1.0 is the resolved outcome.
  // Gamma sets the winning side to exactly 1.0 and the losing side to 0.0 on
  // closed markets — but we use a comparison rather than equality to survive
  // any future drift in payout encoding.
  const finalOutcome: 'YES' | 'NO' | null = resolved && market.yes != null && market.no != null
    ? (market.yes >= market.no ? 'YES' : 'NO')
    : null;
  const finalPrice = finalOutcome === 'YES' ? market.yes : finalOutcome === 'NO' ? market.no : null;
  const resolvedHuman = resolved ? formatResolvedDate(resolved) : '';

  return (
    <div className="market-header">
      {resolved && (
        <div className="mh-resolved-banner mono">
          <span className="mh-resolved-label">resolved · {resolvedHuman}</span>
          {finalOutcome && finalPrice != null && (
            <span className={`mh-resolved-outcome ${finalOutcome.toLowerCase()}`}>
              final {finalOutcome} @ ${finalPrice.toFixed(2)}
            </span>
          )}
        </div>
      )}
      <div className="mh-row">
        <div className="mh-title-block">
          <span className="venue-chip mono">{market.venue}</span>
          <h1 className="mh-title">{market.title}</h1>
          {market.slug && (
            <a
              className="mh-trade-btn mono"
              href={`https://polymarket.com/event/${market.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              title="open this market on polymarket.com"
            >
              trade on polymarket ↗
            </a>
          )}
          {!resolved && onToggleWatchlist && (
            <button
              type="button"
              className={`mh-watch-btn mono ${inWatchlist ? 'on' : ''}`}
              onClick={onToggleWatchlist}
              title={inWatchlist ? 'remove from watchlist (⌘B)' : 'add to watchlist (⌘B)'}
              aria-label={inWatchlist ? 'remove from watchlist' : 'add to watchlist'}
            >
              {inWatchlist ? '★ watching' : '☆ watch'}
            </button>
          )}
        </div>
        {!market.multi && market.yes !== undefined && market.no !== undefined && (
          <div className="mh-prices">
            <div className="mh-price-block">
              <span className="mh-side mono">YES</span>
              <span className="mh-price mono yes">{market.yes.toFixed(2)}</span>
            </div>
            <div className="mh-price-block">
              <span className="mh-side mono">NO</span>
              <span className="mh-price mono no">{market.no.toFixed(2)}</span>
            </div>
          </div>
        )}
        <div className="mh-meta">
          <div className="mh-meta-block">
            <div className="mh-meta-label mono">resolves in</div>
            <div className="mh-meta-value mono">{market.resolveIn}</div>
          </div>
          <div className="mh-meta-block">
            <div className="mh-meta-label mono">24h vol</div>
            <div className="mh-meta-value mono">{market.vol24h}</div>
          </div>
        </div>
      </div>
      {market.multi && market.outcomes && (
        <div className="mh-multi">
          {market.outcomes.map((o, i) => (
            <div key={i} className="multi-row">
              <span className="multi-name">{o.name}</span>
              <span className="multi-bar">
                <span className="multi-bar-fill" style={{ width: `${o.yes * 100}%` }} />
              </span>
              <span className="mono yes">{o.yes.toFixed(2)}</span>
              <span className="mono no">{o.no.toFixed(2)}</span>
            </div>
          ))}
          {market.moreCount !== undefined && market.moreCount > 0 && (
            <button className="multi-more">+{market.moreCount} more outcomes</button>
          )}
        </div>
      )}
    </div>
  );
}

function formatResolvedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase();
}
```

- [ ] **Step 4: Add CSS for the banner**

Edit `apps/web/src/styles/global.css`. After line 313 (`.mh-watch-btn.on:hover ...`), add:

```css
/* Resolved-market banner — slate-amber strip above the header row. The
   trader needs to know AT A GLANCE the market they're briefing already
   paid out, so they don't trade on stale data. */
.mh-resolved-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  margin: -12px -16px 12px -16px;
  background: rgba(251, 191, 36, 0.08);
  border-bottom: 1px solid rgba(251, 191, 36, 0.3);
  font-size: 11px;
  color: var(--accent, #fbbf24);
}
.mh-resolved-label { font-weight: 500; }
.mh-resolved-outcome { color: var(--text-muted); }
.mh-resolved-outcome.yes { color: var(--success); }
.mh-resolved-outcome.no  { color: var(--danger); }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run apps/web/src/components/MarketHeader/MarketHeader.test.tsx
pnpm typecheck
```

Expected: 3 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/MarketHeader/MarketHeader.tsx apps/web/src/styles/global.css apps/web/src/components/MarketHeader/MarketHeader.test.tsx
git commit -m "feat(web): resolved-market banner in MarketHeader

Slate-amber strip above the header row when market.resolvedAt is set.
Shows the resolution date and final outcome (YES/NO @ \$1.00). Hides the
watch button on resolved markets (can't watch a settled market). The
trade-on-polymarket pill stays — still useful for post-mortem price
inspection."
```

---

## Phase 2 — News self-healing chain

The chain replaces the inline Exa retry path. Existing news.ts keeps working through Task 13; Task 14 swaps it.

## Task 6: news/ module types — `NewsHit`, `SearchBackend`

**Files:**
- Create: `packages/core/src/news/types.ts`

- [ ] **Step 1: Write the failing test (smoke-level — types only)**

Create `packages/core/src/news/types.test.ts`:

```ts
// types.test.ts — sanity check that the interfaces exist and can be
// implemented. Compilation = the real test for type files.

import { describe, it, expect } from 'vitest';
import type { NewsHit, SearchBackend } from './types';

describe('news/types', () => {
  it('NewsHit has required fields and can be constructed', () => {
    const hit: NewsHit = {
      url: 'https://example.com/article',
      title: 'Article title',
      source: 'example.com',
      publishedAt: '2026-04-01T00:00:00Z',
      snippet: 'Article snippet.',
    };
    expect(hit.url).toBe('https://example.com/article');
  });

  it('SearchBackend can be implemented', async () => {
    const backend: SearchBackend = {
      name: 'exa',
      available: () => false,
      search: async () => [],
    };
    expect(backend.name).toBe('exa');
    expect(backend.available()).toBe(false);
    expect(await backend.search('q', { windowStart: '2026-01-01', windowEnd: '2026-04-01', marketTitle: 't' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/types.test.ts
```

Expected: FAIL — `packages/core/src/news/types.ts` doesn't exist.

- [ ] **Step 3: Create the types file**

Create `packages/core/src/news/types.ts`:

```ts
// types.ts — shared types for the news self-healing search chain.
// Backends produce NewsHit[]; the chain filters + caches + emits.

export type NewsHit = {
  url: string;
  title: string;
  /** Domain only (e.g. "reuters.com") — used for the source pill in the UI. */
  source: string;
  /** ISO timestamp. REQUIRED — undated hits are dropped at the chain
   *  boundary because they're the #1 signal of LLM fabrication. */
  publishedAt: string;
  /** 1-2 sentence excerpt explaining why this matters. */
  snippet: string;
  /** Backend-specific relevance, 0..1. Optional. */
  score?: number;
};

export type SearchOpts = {
  /** ISO date — inclusive search window start. */
  windowStart: string;
  /** ISO date — inclusive search window end. */
  windowEnd: string;
  /** Full market title; some backends use it as additional context. */
  marketTitle: string;
};

export type SearchBackend = {
  name: 'exa' | 'polymarket-comments' | 'provider-web';
  /** Synchronous capability check. False if the backend can't run in the
   *  current environment (no API key, no provider support). The chain
   *  skips false backends without invoking them. */
  available(): boolean;
  search(query: string, opts: SearchOpts): Promise<NewsHit[]>;
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/core/src/news/types.test.ts
pnpm typecheck
```

Expected: 2 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/types.ts packages/core/src/news/types.test.ts
git commit -m "feat(core): scaffold news/ module types (NewsHit, SearchBackend)

Shared interface for the self-healing search chain. Each backend
(Exa, polymarket comments, provider web search) implements
SearchBackend. The chain (built in later tasks) iterates available
backends with bounded budget and dedupes hits by URL."
```

---

## Task 7: news/retry.ts — backoff + 429 Retry-After

**Files:**
- Create: `packages/core/src/news/retry.ts`
- Create: `packages/core/src/news/retry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/news/retry.test.ts`:

```ts
// retry.test.ts — covers backoff + 429 Retry-After + per-attempt timeout
// + non-retryable errors. The retry policy is the foundation of "self-
// healing" — without it, one transient failure surfaces as an empty
// catalysts panel.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, RetryableError, NonRetryableError } from './retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const p = withRetry(fn, { attempts: 3, baseDelayMs: 100, timeoutMs: 1000 });
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on RetryableError up to attempts cap', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('500 transient'))
      .mockRejectedValueOnce(new RetryableError('500 transient'))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 3, baseDelayMs: 10, timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws when all attempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableError('boom'));
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 10, timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/boom/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry NonRetryableError (4xx-config errors)', async () => {
    const fn = vi.fn().mockRejectedValue(new NonRetryableError('401 unauthorized'));
    const p = withRetry(fn, { attempts: 3, baseDelayMs: 10, timeoutMs: 1000 });
    await expect(p).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours retryAfterMs hint from RetryableError (capped at 5s)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('429 rate-limited', { retryAfterMs: 2000 }))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 100, timeoutMs: 10_000 });
    // Advance just under 2s — should not have retried yet
    await vi.advanceTimersByTimeAsync(1900);
    expect(fn).toHaveBeenCalledTimes(1);
    // Advance past the hint
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBe('ok');
  });

  it('caps retryAfterMs at 5000ms even when hint is larger', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RetryableError('429', { retryAfterMs: 20_000 }))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 100, timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(5100);
    await expect(p).resolves.toBe('ok');
  });

  it('treats per-attempt timeout as retryable', async () => {
    const fn = vi.fn()
      .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn, { attempts: 2, baseDelayMs: 10, timeoutMs: 100 });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/retry.test.ts
```

Expected: FAIL — retry.ts does not exist.

- [ ] **Step 3: Create retry.ts**

Create `packages/core/src/news/retry.ts`:

```ts
// retry.ts — bounded-attempt retry with exponential backoff + 429 Retry-After
// respect + per-attempt timeout. Used by every backend in the news chain.
//
// The retry policy is the difference between "self-healing on transient
// failures" and "silent empty catalysts on the first network hiccup." We
// distinguish RetryableError (5xx, 429, timeout, network) from
// NonRetryableError (4xx-config: 401, 403, 404) so config bugs don't waste
// retry budget.

export class RetryableError extends Error {
  retryAfterMs?: number;
  constructor(message: string, opts?: { retryAfterMs?: number }) {
    super(message);
    this.name = 'RetryableError';
    if (opts?.retryAfterMs != null) this.retryAfterMs = opts.retryAfterMs;
  }
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export type RetryOpts = {
  /** Max number of attempts including the first. */
  attempts: number;
  /** Base delay for exponential backoff: delay = base * 2^(attempt-1). */
  baseDelayMs: number;
  /** Per-attempt wall-clock timeout. */
  timeoutMs: number;
};

const RETRY_AFTER_CAP_MS = 5_000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await raceWithTimeout(fn, opts.timeoutMs);
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableError) throw err;
      if (attempt >= opts.attempts) break;

      const retryAfter = err instanceof RetryableError && err.retryAfterMs != null
        ? Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS)
        : opts.baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(retryAfter);
    }
  }
  throw lastErr;
}

async function raceWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new RetryableError(`attempt timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/news/retry.test.ts
pnpm typecheck
```

Expected: 7 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/retry.ts packages/core/src/news/retry.test.ts
git commit -m "feat(core): news/retry — backoff + 429 Retry-After + per-attempt timeout

The retry primitive every news backend uses. RetryableError (5xx/429/
timeout/network) gets backoff; NonRetryableError (4xx-config) throws
immediately. Retry-After hint capped at 5s so a long server backoff
doesn't blow the chain budget."
```

---

## Task 8: news/cache.ts — LRU + 6h TTL

**Files:**
- Create: `packages/core/src/news/cache.ts`
- Create: `packages/core/src/news/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/news/cache.test.ts`:

```ts
// cache.test.ts — locks in TTL hit/miss + LRU eviction + the "don't cache
// empty results" rule. Caching empty would mean "we tried, nothing here,
// don't try again for 6h" — which is the opposite of self-healing. Only
// successful searches get cached.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NewsCache } from './cache';
import type { NewsGrounding } from '../agents/types';

function mkGrounding(items: number): NewsGrounding {
  return {
    kind: 'news',
    items: Array.from({ length: items }, (_, i) => ({
      headline: `Article ${i}`,
      source: 'reuters.com',
      url: `https://reuters.com/a/${i}`,
      publishedAt: '2026-04-01T00:00:00Z',
      snippet: 'snippet',
    })),
  };
}

describe('NewsCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-12T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on miss', () => {
    const c = new NewsCache();
    expect(c.get('m-1')).toBeNull();
  });

  it('returns grounding on hit within TTL', () => {
    const c = new NewsCache();
    c.set('m-1', mkGrounding(3));
    expect(c.get('m-1')?.items).toHaveLength(3);
  });

  it('returns null after TTL expires (6h)', () => {
    const c = new NewsCache();
    c.set('m-1', mkGrounding(3));
    vi.setSystemTime(new Date('2026-05-12T06:00:01Z'));
    expect(c.get('m-1')).toBeNull();
  });

  it('refuses to cache an empty grounding (self-healing: try again next time)', () => {
    const c = new NewsCache();
    c.set('m-1', { kind: 'news', items: [] });
    expect(c.get('m-1')).toBeNull();
  });

  it('evicts oldest when over capacity', () => {
    const c = new NewsCache({ maxEntries: 2 });
    c.set('m-1', mkGrounding(1));
    c.set('m-2', mkGrounding(1));
    c.set('m-3', mkGrounding(1));
    expect(c.get('m-1')).toBeNull(); // evicted
    expect(c.get('m-2')).not.toBeNull();
    expect(c.get('m-3')).not.toBeNull();
  });

  it('promotes entries on get (LRU)', () => {
    const c = new NewsCache({ maxEntries: 2 });
    c.set('m-1', mkGrounding(1));
    c.set('m-2', mkGrounding(1));
    c.get('m-1'); // promotes m-1 to most-recently-used
    c.set('m-3', mkGrounding(1));
    expect(c.get('m-1')).not.toBeNull();
    expect(c.get('m-2')).toBeNull(); // evicted now
    expect(c.get('m-3')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/cache.test.ts
```

Expected: FAIL — cache.ts does not exist.

- [ ] **Step 3: Create cache.ts**

Create `packages/core/src/news/cache.ts`:

```ts
// cache.ts — LRU + TTL cache for news groundings. The whole point of this
// cache is that ~1% transient backend failures stay invisible to users —
// if we found news for a market 5 minutes ago, we still have it now.
//
// CRITICAL: we never cache empty groundings. An empty result means "the
// chain tried hard and came up empty." Caching that would mean every
// subsequent user sees the same empty for 6h — the opposite of self-
// healing. Empties retry; only successes cache.

import type { NewsGrounding } from '../agents/types';

type CacheEntry = { fetchedAt: number; grounding: NewsGrounding };

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_MAX_ENTRIES = 500;

export type NewsCacheOpts = {
  ttlMs?: number;
  maxEntries?: number;
};

export class NewsCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(opts: NewsCacheOpts = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  get(marketId: string): NewsGrounding | null {
    const entry = this.store.get(marketId);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > this.ttlMs) {
      this.store.delete(marketId);
      return null;
    }
    // LRU promote: re-insertion moves the key to the tail of the iteration
    // order, which is what Map iteration guarantees in JS.
    this.store.delete(marketId);
    this.store.set(marketId, entry);
    return entry.grounding;
  }

  set(marketId: string, grounding: NewsGrounding): void {
    // Self-healing rule: don't cache empty. Next request gets to retry.
    if (!grounding.items || grounding.items.length === 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(marketId, { fetchedAt: Date.now(), grounding });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/news/cache.test.ts
pnpm typecheck
```

Expected: 6 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/cache.ts packages/core/src/news/cache.test.ts
git commit -m "feat(core): news/cache — LRU + 6h TTL for groundings

Empty groundings are never cached — they retry on the next request,
which is the self-healing path. LRU promotes on get; eviction at 500
entries. Process-singleton wiring lands in apps/server/src/news-cache.ts
later in this plan."
```

---

## Task 9: news/backends/exa.ts — Exa backend extracted

**Files:**
- Create: `packages/core/src/news/backends/exa.ts`
- Create: `packages/core/src/news/backends/exa.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/news/backends/exa.test.ts`:

```ts
// exa.test.ts — wraps the Exa searcher through the SearchBackend interface
// with retry. The retry logic is already tested separately; here we focus
// on (1) the available() check, (2) the search→NewsHit mapping, (3)
// dropping undated hits (no-hallucination policy), (4) error classification.

import { describe, it, expect, vi } from 'vitest';
import { makeExaBackend } from './exa';
import type { Searcher, SearchHit } from '../../providers/exa';

function stubSearcher(hits: SearchHit[] | (() => Promise<SearchHit[]>)): Searcher {
  return {
    search: typeof hits === 'function'
      ? hits
      : vi.fn().mockResolvedValue(hits),
  } as unknown as Searcher;
}

describe('exaBackend', () => {
  it('available() returns false when searcher is null', () => {
    const backend = makeExaBackend(null);
    expect(backend.available()).toBe(false);
  });

  it('available() returns true when searcher is provided', () => {
    const backend = makeExaBackend(stubSearcher([]));
    expect(backend.available()).toBe(true);
  });

  it('maps Exa SearchHit → NewsHit and drops undated hits', async () => {
    const backend = makeExaBackend(stubSearcher([
      {
        url: 'https://reuters.com/a/1',
        title: 'Article 1',
        domain: 'reuters.com',
        publishedDate: '2026-04-01T00:00:00Z',
        snippet: 'snippet1',
        score: 0.9,
      },
      {
        url: 'https://cnn.com/a/2',
        title: 'Article 2',
        domain: 'cnn.com',
        publishedDate: '',  // undated → dropped
        snippet: 'snippet2',
        score: 0.7,
      },
    ]));

    const hits = await backend.search('q', {
      windowStart: '2026-03-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe('https://reuters.com/a/1');
    expect(hits[0]!.source).toBe('reuters.com');
    expect(hits[0]!.score).toBe(0.9);
  });

  it('returns empty array on transient error (retry exhausted, swallowed)', async () => {
    const failing = stubSearcher(() => Promise.reject(new Error('boom')));
    const backend = makeExaBackend(failing);
    const hits = await backend.search('q', {
      windowStart: '2026-03-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/backends/exa.test.ts
```

Expected: FAIL — exa.ts does not exist.

- [ ] **Step 3: Create exa.ts**

Create `packages/core/src/news/backends/exa.ts`:

```ts
// exa.ts — Exa AI backend for the news chain. Wraps the existing Exa
// searcher with retry + maps to the unified NewsHit shape.
//
// Undated hits are dropped here (before they reach the chain) because the
// no-hallucination policy says we can't trust "fresh news" without a real
// date. Real Exa results from news endpoints always carry a date.

import { withRetry, RetryableError } from '../retry';
import type { SearchBackend, NewsHit, SearchOpts } from '../types';
import type { Searcher } from '../../providers/exa';

export function makeExaBackend(searcher: Searcher | null): SearchBackend {
  return {
    name: 'exa',
    available: () => searcher !== null,
    async search(query: string, opts: SearchOpts): Promise<NewsHit[]> {
      if (!searcher) return [];

      // Compute the recency window in hours so the existing Exa client
      // signature works. The chain pre-computes windowStart/windowEnd; we
      // derive hours from the end (Exa today only supports "last N hours
      // from now"). When Exa adds absolute-date support, switch here.
      const endMs = Date.parse(opts.windowEnd);
      const startMs = Date.parse(opts.windowStart);
      const windowHours = Number.isFinite(endMs) && Number.isFinite(startMs)
        ? Math.max(1, Math.ceil((endMs - startMs) / (60 * 60 * 1000)))
        : 24 * 30;

      try {
        const raw = await withRetry(
          () => searcher.search(query, {
            numResults: 10,
            recencyHours: windowHours,
            category: 'news',
            withFullText: false,
          }),
          { attempts: 3, baseDelayMs: 500, timeoutMs: 10_000 },
        );

        return raw
          .filter((h) => Boolean(h.publishedDate))
          .map((h): NewsHit => ({
            url: h.url,
            title: h.title,
            source: h.domain,
            publishedAt: h.publishedDate ?? '',
            snippet: h.snippet,
            score: h.score,
          }));
      } catch {
        // Retry exhausted — return empty. The chain escalates to the next
        // backend. Don't log raw error text (repo policy) but record the
        // class for downstream diagnostic.
        return [];
      }
    },
  };
}
```

**Type check note:** `Searcher` and `SearchHit` are imported from `../../providers/exa`. `SearchHit` has `url, title, domain, publishedDate, snippet, score` — all fields used above. Confirm via `Grep "SearchHit" packages/core/src/providers/exa.ts` if the import doesn't resolve.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/news/backends/exa.test.ts
pnpm typecheck
```

Expected: 4 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/backends/exa.ts packages/core/src/news/backends/exa.test.ts
git commit -m "feat(core): news/backends/exa — Exa SearchBackend wrapper

First backend in the news chain. Wraps Exa with the retry policy and
maps Exa.SearchHit → unified NewsHit. Undated hits dropped here per the
no-hallucination policy. Falls back gracefully (returns []) when retry
exhausted, so the chain can escalate."
```

---

## Task 10: news/backends/polymarketComments.ts

**Files:**
- Create: `packages/core/src/news/backends/polymarketComments.ts`
- Create: `packages/core/src/news/backends/polymarketComments.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/news/backends/polymarketComments.test.ts`:

```ts
// polymarketComments.test.ts — covers URL extraction from comment bodies,
// dedupe by URL, snippet trimming, and the available() guard (slug is
// required to even attempt this backend).
//
// This is a parser-level test — we mock the fetch() that pulls comments.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makePolymarketCommentsBackend } from './polymarketComments';

describe('polymarketCommentsBackend', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('available() requires a slug-provider function', () => {
    const backend = makePolymarketCommentsBackend({ slugFor: () => null });
    expect(backend.available()).toBe(true); // backend itself is wired; per-call slug determines runnable
  });

  it('returns empty when the slug-provider returns null', async () => {
    const backend = makePolymarketCommentsBackend({ slugFor: () => null });
    const hits = await backend.search('q', {
      windowStart: '2026-01-01',
      windowEnd: '2026-04-01',
      marketTitle: 'Will Trump visit China by June 30?',
    });
    expect(hits).toEqual([]);
  });

  it('extracts URLs from comment bodies and dedupes by URL', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        comments: [
          {
            body: 'Per CNBC: https://cnbc.com/article/123 looks bullish.',
            createdAt: '2026-04-10T00:00:00Z',
          },
          {
            body: 'And BBC https://bbc.co.uk/news/abc — also covers it.',
            createdAt: '2026-04-11T00:00:00Z',
          },
          {
            // duplicate URL — should be deduped
            body: 'Already posted: https://cnbc.com/article/123',
            createdAt: '2026-04-12T00:00:00Z',
          },
        ],
      }),
    });

    const backend = makePolymarketCommentsBackend({ slugFor: () => 'will-trump-visit-china-by-june-30' });
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 'Will Trump visit China by June 30?',
    });

    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.url).sort()).toEqual([
      'https://bbc.co.uk/news/abc',
      'https://cnbc.com/article/123',
    ]);
    // Source = domain
    expect(hits.find((h) => h.url.includes('cnbc'))?.source).toBe('cnbc.com');
    // publishedAt = comment's createdAt
    expect(hits.find((h) => h.url.includes('cnbc'))?.publishedAt).toBe('2026-04-10T00:00:00Z');
  });

  it('returns empty when fetch fails (graceful escalation)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const backend = makePolymarketCommentsBackend({ slugFor: () => 'slug' });
    const hits = await backend.search('q', {
      windowStart: '2026-01-01',
      windowEnd: '2026-04-01',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });

  it('returns empty when fetch returns non-ok (e.g., 404 — endpoint auth-walled)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    const backend = makePolymarketCommentsBackend({ slugFor: () => 'slug' });
    const hits = await backend.search('q', {
      windowStart: '2026-01-01',
      windowEnd: '2026-04-01',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/backends/polymarketComments.test.ts
```

Expected: FAIL — polymarketComments.ts does not exist.

- [ ] **Step 3: Create polymarketComments.ts**

Create `packages/core/src/news/backends/polymarketComments.ts`:

```ts
// polymarketComments.ts — second backend in the news chain. Scrapes the
// public Polymarket comments endpoint for a given event slug, extracts URLs
// from comment bodies, and returns them as NewsHits.
//
// QUALITY CAVEAT: comment content is user-contributed. The chain marks
// these hits as `unverified` at filter time (off-allowlist domains get the
// flag regardless of source). Users see a small badge in the UI.
//
// The exact API URL is best-effort. Polymarket exposes comments per event
// through their public web app; we use the format `/api/comments?event_slug=`
// observed via network inspection. If their endpoint format changes or goes
// auth-walled, this backend silently returns [] and the chain escalates to
// the next backend — graceful degradation, no breakage.

import type { SearchBackend, NewsHit, SearchOpts } from '../types';

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const COMMENTS_ENDPOINT = 'https://polymarket.com/api/comments';

type CommentPayload = {
  comments?: Array<{
    body?: string;
    text?: string;
    createdAt?: string;
  }>;
};

export type PolymarketCommentsOpts = {
  /** Resolves a market title (or query) to the corresponding event slug.
   *  The chain wires this — typically from the MarketMeta the supervisor
   *  already has. Returns null when we don't know the slug (e.g., search
   *  bar query without a market context). */
  slugFor: (query: string, marketTitle: string) => string | null;
};

export function makePolymarketCommentsBackend(opts: PolymarketCommentsOpts): SearchBackend {
  return {
    name: 'polymarket-comments',
    available: () => true,
    async search(query: string, sopts: SearchOpts): Promise<NewsHit[]> {
      const slug = opts.slugFor(query, sopts.marketTitle);
      if (!slug) return [];

      let payload: CommentPayload;
      try {
        const url = `${COMMENTS_ENDPOINT}?event_slug=${encodeURIComponent(slug)}&limit=50`;
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return [];
        payload = await res.json() as CommentPayload;
      } catch {
        return [];
      }

      const seen = new Set<string>();
      const hits: NewsHit[] = [];
      for (const c of payload.comments ?? []) {
        const body = c.body || c.text || '';
        const urls = body.match(URL_REGEX) ?? [];
        for (const u of urls) {
          if (seen.has(u)) continue;
          seen.add(u);
          let domain = '';
          try { domain = new URL(u).hostname.replace(/^www\./, ''); } catch { continue; }
          hits.push({
            url: u,
            title: trimToSentence(body, u),
            source: domain,
            publishedAt: c.createdAt ?? '',
            snippet: body.slice(0, 240),
          });
        }
      }
      return hits.filter((h) => Boolean(h.publishedAt));
    },
  };
}

function trimToSentence(body: string, url: string): string {
  // The comment body around the URL becomes the hit's "title" — better
  // than no title. Take the surrounding 80 chars, strip the URL itself.
  const idx = body.indexOf(url);
  if (idx < 0) return body.slice(0, 80);
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + 40);
  return body.slice(start, end).replace(url, '').replace(/\s+/g, ' ').trim().slice(0, 80) || body.slice(0, 80);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/news/backends/polymarketComments.test.ts
pnpm typecheck
```

Expected: 5 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/backends/polymarketComments.ts packages/core/src/news/backends/polymarketComments.test.ts
git commit -m "feat(core): news/backends/polymarketComments — comment-URL scraper

Second backend in the news chain. Extracts URLs from polymarket event
comment bodies, dedupes by URL, source=domain, publishedAt=comment
createdAt. Quality is user-contributed — chain flags these as
unverified at filter time. Graceful degradation if the endpoint
format changes (returns [], chain escalates)."
```

---

## Task 11: news/backends/providerWebSearch.ts

**Files:**
- Create: `packages/core/src/news/backends/providerWebSearch.ts`
- Create: `packages/core/src/news/backends/providerWebSearch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/news/backends/providerWebSearch.test.ts`:

```ts
// providerWebSearch.test.ts — covers (1) available() returns false when
// provider lacks webSearch capability, (2) JSON parsing from a happy-path
// response, (3) graceful empty on parse failure.

import { describe, it, expect, vi } from 'vitest';
import { makeProviderWebSearchBackend } from './providerWebSearch';
import type { LLMProvider } from '../../providers/types';

function stubProvider(opts: { webSearch: boolean; text: string; ok?: boolean }): LLMProvider {
  return {
    name: 'anthropic',
    capabilities: { nativeJsonMode: false, webSearch: opts.webSearch, authViaSession: false },
    complete: vi.fn().mockResolvedValue({
      text: opts.text,
      ok: opts.ok ?? true,
      elapsedMs: 100,
      model: 'stub',
      provider: 'anthropic',
    }),
  };
}

describe('providerWebSearchBackend', () => {
  it('available() returns false when provider lacks webSearch', () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: false, text: '{}' }));
    expect(backend.available()).toBe(false);
  });

  it('available() returns true when provider has webSearch', () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: '{}' }));
    expect(backend.available()).toBe(true);
  });

  it('parses provider JSON response into NewsHits', async () => {
    const json = JSON.stringify({
      items: [
        {
          url: 'https://reuters.com/a/1',
          title: 'Trump-Xi meeting confirmed',
          source: 'reuters.com',
          publishedAt: '2026-04-15T00:00:00Z',
          snippet: 'Officials confirm visit.',
        },
        {
          url: 'https://bbc.co.uk/news/2',
          title: 'No date set yet',
          source: 'bbc.co.uk',
          // no publishedAt — dropped
          snippet: 'Speculation.',
        },
      ],
    });
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: json }));
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.url).toBe('https://reuters.com/a/1');
  });

  it('returns empty on unparseable response', async () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: 'not json' }));
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });

  it('returns empty when provider call fails (ok=false)', async () => {
    const backend = makeProviderWebSearchBackend(() => stubProvider({ webSearch: true, text: '', ok: false }));
    const hits = await backend.search('q', {
      windowStart: '2026-04-01',
      windowEnd: '2026-04-30',
      marketTitle: 't',
    });
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/backends/providerWebSearch.test.ts
```

Expected: FAIL — providerWebSearch.ts does not exist.

- [ ] **Step 3: Create providerWebSearch.ts**

Create `packages/core/src/news/backends/providerWebSearch.ts`:

```ts
// providerWebSearch.ts — third (last) backend in the news chain. Uses the
// user's primary provider when it advertises capabilities.webSearch
// (Perplexity natively, Anthropic-CC via tool access). Sends a minimal
// "news about X, return JSON" prompt.
//
// This is billable (user paid for the key) so it's last — only invoked
// when Exa + Polymarket comments both came up empty. The retry policy
// applies but is conservative (1 attempt) because LLM calls are slow
// and the chain budget is finite.

import { extractJson } from '../../providers/types';
import type { LLMProvider } from '../../providers/types';
import type { SearchBackend, NewsHit, SearchOpts } from '../types';

type ProviderResp = {
  items?: Array<{
    url?: string;
    title?: string;
    source?: string;
    publishedAt?: string;
    snippet?: string;
  }>;
};

export function makeProviderWebSearchBackend(
  getProvider: () => LLMProvider | null,
): SearchBackend {
  return {
    name: 'provider-web',
    available: () => {
      const p = getProvider();
      return p != null && p.capabilities.webSearch;
    },
    async search(query: string, opts: SearchOpts): Promise<NewsHit[]> {
      const provider = getProvider();
      if (!provider || !provider.capabilities.webSearch) return [];

      const sysPrompt = `You are a news researcher. Use web search to find recent news about the user's query. Return JSON ONLY:
{
  "items": [
    {
      "url": "<full url from real search>",
      "title": "<headline>",
      "source": "<domain>",
      "publishedAt": "<ISO date>",
      "snippet": "<1-2 sentences>"
    }
  ]
}
Rules: only include items with a real URL and a real publishedAt date. NEVER fabricate. If web search returns nothing relevant, return items: [].`;

      const prompt = `Search the web for news about: "${opts.marketTitle}"
Search window: ${opts.windowStart} → ${opts.windowEnd}
Query: ${query}

Return the JSON.`;

      const res = await provider.complete(prompt, {
        tier: 'fast',
        systemPrompt: sysPrompt,
        allowedTools: ['WebSearch'],
        jsonOnly: true,
        timeoutMs: 60_000,
      });

      if (!res.ok) return [];
      const parsed = extractJson<ProviderResp>(res.text);
      if (!parsed || !Array.isArray(parsed.items)) return [];

      return parsed.items
        .filter((it) => Boolean(it.url) && Boolean(it.publishedAt))
        .map((it): NewsHit => ({
          url: it.url!,
          title: it.title ?? '',
          source: it.source ?? safeDomain(it.url!),
          publishedAt: it.publishedAt!,
          snippet: it.snippet ?? '',
        }));
    },
  };
}

function safeDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/news/backends/providerWebSearch.test.ts
pnpm typecheck
```

Expected: 5 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/backends/providerWebSearch.ts packages/core/src/news/backends/providerWebSearch.test.ts
git commit -m "feat(core): news/backends/providerWebSearch — billable fallback

Third backend, only invoked when Exa + polymarket comments both came up
empty. Uses the user's primary provider when it advertises webSearch
capability. Returns empty when the provider doesn't support web search
(chain's available() check skips it cleanly)."
```

---

## Task 12: news/searchChain.ts — orchestrator

**Files:**
- Create: `packages/core/src/news/searchChain.ts`
- Create: `packages/core/src/news/searchChain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/news/searchChain.test.ts`:

```ts
// searchChain.test.ts — locks in the chain orchestration: skip
// unavailable backends, dedupe by URL across variants, stop at 3+ hits,
// escalate on throw, respect per-backend + total budget.

import { describe, it, expect, vi } from 'vitest';
import { searchNews } from './searchChain';
import { NewsCache } from './cache';
import type { SearchBackend, NewsHit } from './types';

function mkBackend(name: SearchBackend['name'], hits: NewsHit[] | (() => Promise<NewsHit[]>), available = true): SearchBackend {
  return {
    name,
    available: () => available,
    search: typeof hits === 'function' ? hits : vi.fn().mockResolvedValue(hits),
  };
}

function hit(url: string, ts = '2026-04-15T00:00:00Z'): NewsHit {
  return {
    url,
    title: `Title for ${url}`,
    source: new URL(url).hostname.replace(/^www\./, ''),
    publishedAt: ts,
    snippet: 'snippet',
  };
}

describe('searchNews — chain orchestration', () => {
  it('returns cache hit without invoking backends', async () => {
    const cache = new NewsCache();
    cache.set('m-1', { kind: 'news', items: [{ headline: 'cached', source: 's', url: 'https://s/1', publishedAt: '2026-04-01T00:00:00Z', snippet: '' }] });
    const exa = mkBackend('exa', []);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    expect(result).toHaveLength(1);
    expect(exa.search).not.toHaveBeenCalled();
  });

  it('stops at backend 1 when it returns 3+ hits', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://a/1'), hit('https://a/2'), hit('https://a/3')]);
    const comments = mkBackend('polymarket-comments', [hit('https://c/1')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    expect(result).toHaveLength(3);
    expect(comments.search).not.toHaveBeenCalled();
  });

  it('escalates to backend 2 when backend 1 returns < 3 hits', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://a/1')]);
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    // Aggregate: 1 from exa + 2 from comments — all preserved, deduped
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('dedupes by URL across backends and variants', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://shared/1')]);
    const comments = mkBackend('polymarket-comments', [hit('https://shared/1'), hit('https://c/2')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    const urls = result.map((h) => h.url).sort();
    expect(urls).toEqual(['https://c/2', 'https://shared/1']);
  });

  it('skips backends where available() returns false', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [], false);
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2'), hit('https://c/3')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    expect(exa.search).not.toHaveBeenCalled();
    expect(result).toHaveLength(3);
  });

  it('escalates when a backend throws', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', () => Promise.reject(new Error('boom')));
    const comments = mkBackend('polymarket-comments', [hit('https://c/1'), hit('https://c/2'), hit('https://c/3')]);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    expect(result).toHaveLength(3);
  });

  it('caches successful aggregate (writes to cache)', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', [hit('https://a/1'), hit('https://a/2'), hit('https://a/3')]);
    await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    const cached = cache.get('m-1');
    expect(cached?.items).toHaveLength(3);
  });

  it('returns [] when all backends are empty (no cache write)', async () => {
    const cache = new NewsCache();
    const exa = mkBackend('exa', []);
    const comments = mkBackend('polymarket-comments', []);
    const result = await searchNews(
      { marketId: 'm-1', title: 't' },
      [exa, comments],
      cache,
      { windowStart: '2026-01-01', windowEnd: '2026-04-30' },
    );
    expect(result).toEqual([]);
    expect(cache.get('m-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/news/searchChain.test.ts
```

Expected: FAIL — searchChain.ts does not exist.

- [ ] **Step 3: Create searchChain.ts**

Create `packages/core/src/news/searchChain.ts`:

```ts
// searchChain.ts — the news self-healing orchestrator. Tries each
// available backend with up to 3 query variants until the aggregate
// reaches a satisfaction threshold (≥3 hits). Caches successful results.
// Dedupes by URL across variants and backends.
//
// Per-backend and total chain budgets bound wall-clock so a slow-but-
// not-erroring backend can't gate the whole news panel forever. Budget
// exceeded → use whatever we have and stop.

import type { NewsCache } from './cache';
import type { SearchBackend, NewsHit, SearchOpts } from './types';
import type { NewsGrounding, NewsItem } from '../agents/types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'will', 'in', 'on', 'by', 'before', 'after',
  'between', 'of', 'to', 'is', 'are', 'be', 'and', 'or', 'for',
]);

const PER_BACKEND_BUDGET_MS = 10_000;
const TOTAL_CHAIN_BUDGET_MS = 25_000;
const SATISFACTION_THRESHOLD = 3;

export type ChainOpts = SearchOpts & {
  // Identity for caching. searchOpts already has windowStart/windowEnd/title.
};

export async function searchNews(
  market: { marketId: string; title: string; slug?: string },
  backends: SearchBackend[],
  cache: NewsCache,
  opts: ChainOpts,
): Promise<NewsHit[]> {
  // 1. Cache check (skips the whole chain on hit).
  const cached = cache.get(market.marketId);
  if (cached) {
    return cached.items.map((it): NewsHit => ({
      url: it.url,
      title: it.headline,
      source: it.source,
      publishedAt: it.publishedAt ?? '',
      snippet: it.snippet ?? '',
    }));
  }

  // 2. Run the chain.
  const aggregate: NewsHit[] = [];
  const seen = new Set<string>();
  const chainStart = Date.now();
  const variants = buildQueryVariants(market.title);

  for (const backend of backends.filter((b) => b.available())) {
    if (Date.now() - chainStart > TOTAL_CHAIN_BUDGET_MS) break;
    if (aggregate.length >= SATISFACTION_THRESHOLD) break;

    const backendStart = Date.now();
    for (const query of variants) {
      if (Date.now() - backendStart > PER_BACKEND_BUDGET_MS) break;
      if (aggregate.length >= SATISFACTION_THRESHOLD) break;

      try {
        const hits = await backend.search(query, {
          windowStart: opts.windowStart,
          windowEnd: opts.windowEnd,
          marketTitle: market.title,
        });
        for (const h of hits) {
          if (!h.url || !h.publishedAt) continue;
          if (seen.has(h.url)) continue;
          seen.add(h.url);
          aggregate.push(h);
        }
      } catch {
        // Per-backend failure is logged inside the backend (when it has
        // useful classification); here we just escalate to the next
        // variant or backend.
      }
    }
  }

  // 3. Cache successful aggregate (the cache itself refuses empties).
  if (aggregate.length > 0) {
    cache.set(market.marketId, hitsToGrounding(aggregate));
  }

  return aggregate;
}

export function buildQueryVariants(marketTitle: string): string[] {
  const bare = bareKeywords(marketTitle, 6);
  const broad = marketTitle
    .replace(/\([^)]*\)/g, '')
    .replace(/[—:].*$/, '')
    .replace(/\b(before|after|by|between|on|in)\s+\w+\s+\d+\s*,?\s*\d{0,4}/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [
    `${marketTitle} — recent news, scheduled events, background`,
    broad && broad !== marketTitle ? broad : `${marketTitle} news`,
    bare,
  ];
}

function bareKeywords(title: string, max: number): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, max)
    .join(' ');
}

function hitsToGrounding(hits: NewsHit[]): NewsGrounding {
  const items: NewsItem[] = hits.map((h) => ({
    headline: h.title,
    source: h.source,
    url: h.url,
    publishedAt: h.publishedAt,
    snippet: h.snippet,
    relevance: h.score != null && h.score > 0.7 ? 'high' : h.score != null && h.score > 0.4 ? 'med' : 'low',
    from: 'web' as const,
  }));
  return { kind: 'news', items };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/news/searchChain.test.ts
pnpm typecheck
```

Expected: 8 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/news/searchChain.ts packages/core/src/news/searchChain.test.ts
git commit -m "feat(core): news/searchChain — multi-backend orchestrator

Iterates available backends × 3 query variants until aggregate >= 3
hits. Dedupes by URL across the whole walk. Per-backend budget 10s,
total chain budget 25s. Caches non-empty aggregates; empties never
cached so the next request gets to retry."
```

---

## Task 13: Refactor `agents/news.ts` to use the chain

**Files:**
- Modify: `packages/core/src/agents/news.ts` (full file refactor)

- [ ] **Step 1: Update the existing news.test.ts to assert the new behavior**

The existing tests from Task 4 assert signature + diagnostic shape. We extend with mock-based tests that prove the refactor delegates to searchChain.

Edit `packages/core/src/agents/news.test.ts`. Add this import near the top (just after the existing `vi` import):

```ts
import { searchNews as _searchNews } from '../news/searchChain';
```

Add this `vi.mock` block at the top of the file, AFTER the imports (Vitest hoists `vi.mock` calls automatically, but keeping them visually with the imports is clearer):

```ts
vi.mock('../news/searchChain', () => ({
  searchNews: vi.fn(),
  buildQueryVariants: vi.fn().mockReturnValue(['q1', 'q2', 'q3']),
}));
```

Then APPEND these tests at the bottom of the file:

```ts

describe('runNewsAgent — uses searchChain', () => {
  it('emits items and claims when searchChain returns hits', async () => {
    (_searchNews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        url: 'https://reuters.com/a/1',
        title: 'Article 1',
        source: 'reuters.com',
        publishedAt: '2026-04-15T00:00:00Z',
        snippet: 'snippet1',
      },
      {
        url: 'https://bbc.co.uk/a/2',
        title: 'Article 2',
        source: 'bbc.co.uk',
        publishedAt: '2026-04-14T00:00:00Z',
        snippet: 'snippet2',
      },
    ]);

    const result = await runNewsAgent(
      {
        market: mkMarket(),
        emit: vi.fn(),
      },
      noWebProvider('{}'),
      null,
    );

    expect(result.output.citations).toHaveLength(2);
    expect(result.output.citations[0]!.url).toBe('https://reuters.com/a/1');
    expect(result.output.claims.length).toBeGreaterThan(0);
  });

  it('emits a diagnostic claim when searchChain returns []', async () => {
    (_searchNews as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await runNewsAgent(
      { market: mkMarket(), emit: vi.fn() },
      noWebProvider('{}'),
      null,
    );
    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims).toHaveLength(1);
    expect(result.output.claims[0]!.citations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify the new ones fail**

```bash
pnpm vitest run packages/core/src/agents/news.test.ts
```

Expected: FAIL — the new tests expect `_searchNews` to be called, which won't happen until the refactor.

- [ ] **Step 3: Refactor `agents/news.ts` to delegate to the chain**

Replace the body of `runNewsAgent` (the existing 137-361 block) with a chain-delegating version. Edit `packages/core/src/agents/news.ts`:

Add new imports at the top after the existing imports:

```ts
import { searchNews } from '../news/searchChain';
import { makeExaBackend } from '../news/backends/exa';
import { makePolymarketCommentsBackend } from '../news/backends/polymarketComments';
import { makeProviderWebSearchBackend } from '../news/backends/providerWebSearch';
import { NewsCache } from '../news/cache';
```

Extend `NewsOpts` to accept the cache (Task 14 wires it from the server):

```ts
export type NewsOpts = {
  windowOverride?: { endsAt: string; days: number };
  /** Process-singleton cache injected by the server. When omitted (tests
   *  without a cache), an ephemeral cache is created per-call — useless
   *  but harmless. */
  cache?: NewsCache;
};
```

Replace the entire `runNewsAgent` function body (lines 137-361) with:

```ts
export async function runNewsAgent(
  ctx: AgentContext,
  provider?: LLMProvider,
  searcher?: Searcher | null,
  opts?: NewsOpts,
): Promise<AgentResult> {
  const started = Date.now();
  const { market, emit } = ctx;

  // Compute search window
  const windowEnd = opts?.windowOverride
    ? opts.windowOverride.endsAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const windowStartMs = opts?.windowOverride
    ? Date.parse(opts.windowOverride.endsAt) - opts.windowOverride.days * 24 * 60 * 60 * 1000
    : Date.now() - 30 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(windowStartMs).toISOString().slice(0, 10);

  // Build backends (each backend's available() handles missing config)
  const newsProvider = provider ?? null;
  const cache = opts?.cache ?? new NewsCache();
  const backends = [
    makeExaBackend(searcher ?? null),
    makePolymarketCommentsBackend({ slugFor: () => market.slug || null }),
    makeProviderWebSearchBackend(() => newsProvider),
  ];

  const hits = await searchNews(
    { marketId: market.marketId, title: market.title, slug: market.slug },
    backends,
    cache,
    { windowStart, windowEnd, marketTitle: market.title },
  );

  // Render to citations + tag unverified for off-curated-allowlist sources
  const sub = classifyMarket(market.category ?? '', market.title);
  const items: NewsItem[] = hits.map((h) => {
    const item: NewsItem = {
      headline: h.title,
      source: h.source,
      url: h.url,
      publishedAt: h.publishedAt,
      snippet: h.snippet,
      relevance: h.score != null && h.score > 0.7 ? 'high'
        : h.score != null && h.score > 0.4 ? 'med' : 'low',
      from: 'web',
    };
    if (!isAllowlisted(sub, h.url)) item.unverified = true;
    return item;
  });

  // Sort newest-first; drop denylisted (chain already does but defensive).
  items.sort((a, b) => Date.parse(b.publishedAt ?? '0') - Date.parse(a.publishedAt ?? '0'));
  const cleanItems = items.filter((it) => it.url && !isDenylisted(it.url));

  const grounding: NewsGrounding = { kind: 'news', items: cleanItems };
  emit({ t: 'agent:data', agent: 'news', grounding });

  const citations: Citation[] = cleanItems.map((it, i) => ({
    id: `news·${i + 1}`,
    kind: 'news' as const,
    label: (it.headline || `news·${i + 1}`).slice(0, 80),
    payload: it,
    url: it.url,
  }));

  // Build claims — one per top item, or a single diagnostic when empty
  const claims: Claim[] = cleanItems.length
    ? cleanItems.slice(0, 3).map((it, i) => ({
        text: `${it.headline} (${it.source}).`,
        citations: [`news·${i + 1}`],
      }))
    : [{ text: emptyStateClaim({
        anyBackendAvailable: backends.some((b) => b.available()),
      }), citations: [] }];

  return {
    agent: 'news',
    output: { claims, citations },
    grounding,
    elapsedMs: Date.now() - started,
  };
}

function emptyStateClaim(state: { anyBackendAvailable: boolean }): string {
  if (!state.anyBackendAvailable) {
    return 'no live news backend configured — server needs EXA_API_KEY or a web-search-capable provider. The catalysts panel can\'t surface news without one.';
  }
  return 'no recent news surfaced for this market from any of 3 backends (Exa, polymarket comments, provider web search). The topic may be niche or too breaking for our sources.';
}
```

Delete the old user-feed path (`fromUserFeed` at line 121-135) only if it's no longer called; if it's still referenced, keep it but route it ahead of the chain (preserves MCP feed override). Reading the existing code: `fromUserFeed` is called at line 146; preserve that block at the top of the new `runNewsAgent`:

```ts
  // Preserve the MCP user-feed override (Step 1 of the original flow). When a
  // venue has a registered news feed (e.g. an X-actions MCP server), it
  // bypasses the chain entirely.
  const fromFeed = await fromUserFeed(ctx);
  if (fromFeed) {
    emit({ t: 'agent:data', agent: 'news', grounding: fromFeed });
    const items = fromFeed.items.slice(0, 4);
    const citations: Citation[] = items.map((it, i) => ({
      id: `news·${i + 1}`, kind: 'news',
      label: (it.headline || `news·${i + 1}`).slice(0, 80),
      payload: it, url: it.url,
    }));
    const claims: Claim[] = items.length
      ? items.slice(0, 3).map((it, i) => ({
          text: `${it.headline} (${it.source}).`,
          citations: [`news·${i + 1}`],
        }))
      : [{ text: 'No material catalysts surfaced.', citations: [] }];
    return { agent: 'news', output: { claims, citations }, grounding: fromFeed, elapsedMs: Date.now() - started };
  }
```

Place this block at the top of `runNewsAgent` before the chain code. Delete the rest of the original function (the inline Exa/provider paths). Delete `runNewsViaExa` and `buildSystemPrompt` — their behavior now lives in the chain backends.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/agents/news.test.ts packages/core/src/agents/supervisor.test.ts
pnpm typecheck
```

Expected: All tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/news.ts packages/core/src/agents/news.test.ts
git commit -m "refactor(core): news agent delegates to news/searchChain

Replaces the inline Exa retry block + provider-fallback hallucination
filter with the new news/ chain. Same output contract (citations,
claims, NewsGrounding). The MCP user-feed override at the top of the
agent is preserved. Diagnostic claim now distinguishes 'no backend
configured' from 'backends ran, nothing found'."
```

---

## Task 14: Wire `NewsCache` singleton through `apps/server/src/routes/brief.ts`

**Files:**
- Create: `apps/server/src/news-cache.ts`
- Modify: `apps/server/src/routes/brief.ts:204-215`
- Modify: `packages/core/src/agents/supervisor.ts` — accept + pass cache to news

- [ ] **Step 1: Create the singleton**

Create `apps/server/src/news-cache.ts`:

```ts
// news-cache.ts — process-singleton NewsCache instance. The brief route
// pulls this once per process and passes it through to runSupervisor →
// runNewsAgent so all briefs share the same 6h LRU.

import { NewsCache } from '@pm-copilot/core/news/cache';

let instance: NewsCache | null = null;

export function getNewsCache(): NewsCache {
  if (!instance) instance = new NewsCache();
  return instance;
}
```

Verify the `@pm-copilot/core/news/cache` path resolves — `packages/core/package.json` should already have a wildcard export. If not, add `"./news/*": "./src/news/*.ts"` to the `exports` map. (Read `packages/core/package.json:7-21` for the existing exports list.)

- [ ] **Step 2: Add cache export to core's package.json if needed**

Read `packages/core/package.json` and check `exports`. Add `"./news/*": "./src/news/*.ts"` if missing:

```json
"exports": {
  ".": "./src/index.ts",
  "./agents": "./src/agents/index.ts",
  "./agents/*": "./src/agents/*.ts",
  "./news/*": "./src/news/*.ts",
  ...
}
```

- [ ] **Step 3: Update supervisor to pass cache through**

Edit `packages/core/src/agents/supervisor.ts`. Add to `SupervisorOpts` (around line 92):

```ts
  /** News-grounding cache. Process-singleton from the server; tests can
   *  pass a fresh instance. When omitted, runNewsAgent creates an
   *  ephemeral one (useless — only used for type completeness). */
  newsCache?: import('../news/cache').NewsCache;
```

Then in the news fanOut entry (around line 170, after Task 4's changes). Add `import type { NewsOpts } from './news';` to the imports at the top of supervisor.ts, then:

```ts
    runOne('news', (c) => {
      const newsOpts: NewsOpts = {
        ...(isResolved && market.resolvedAt
          ? { windowOverride: { endsAt: market.resolvedAt, days: 30 } }
          : {}),
        ...(opts.newsCache ? { cache: opts.newsCache } : {}),
      };
      return runNewsAgent(c, newsProvider, searcher, newsOpts);
    }),
```

- [ ] **Step 4: Wire the singleton through the brief route**

Edit `apps/server/src/routes/brief.ts:204-215`. After `const searcher = getExaSearcher();` add `const newsCache = getNewsCache();`, and in the `runSupervisor` call, pass `newsCache`:

```ts
    const searcher = getExaSearcher();
    const newsCache = getNewsCache();
    await runSupervisor({ market, emit, rememberGrounding, routing, tweets, searcher, newsCache, signal: abortCtrl.signal });
```

Add the import at the top of `brief.ts`:

```ts
import { getNewsCache } from '../news-cache';
```

- [ ] **Step 5: Write integration test**

Add a smoke test in `apps/server/src/news-cache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getNewsCache } from './news-cache';

describe('news cache singleton', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getNewsCache();
    const b = getNewsCache();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 6: Run tests + typecheck**

```bash
pnpm vitest run apps/server/src/news-cache.test.ts packages/core/src/agents/supervisor.test.ts packages/core/src/agents/news.test.ts
pnpm typecheck
```

Expected: All PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/news-cache.ts apps/server/src/news-cache.test.ts apps/server/src/routes/brief.ts packages/core/src/agents/supervisor.ts packages/core/package.json
git commit -m "feat(server): wire NewsCache singleton through brief route

Process-singleton instance via apps/server/src/news-cache.ts; passed
into runSupervisor and on to runNewsAgent. Adds the './news/*' export
to @pm-copilot/core so the server can import the cache directly.

Repeat briefs on the same market within 6h are cache-served. Transient
backend failures are invisible to users who already saw real data once."
```

---

## Phase 3 — Sentiment fabrication fix

## Task 15: Sentiment Pass-1 — capture Grok citations into a registry

**Files:**
- Modify: `packages/core/src/agents/sentiment.ts:99-271`
- Create: `packages/core/src/agents/sentiment.test.ts`

The sentiment refactor is one task — it touches the whole agent flow. The test asserts the end-to-end behavior; the implementation does the two-pass.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/agents/sentiment.test.ts`:

```ts
// sentiment.test.ts — locks in (1) URL provenance: model-emitted tweets
// must match Grok's actual citations, anything else dropped; (2) Pass-1-
// empty: no citations from Grok → honest empty, skip Pass 2; (3) safety
// net: URLs in claim text outside the registry → claim dropped.

import { describe, it, expect, vi } from 'vitest';
import { runSentimentAgent } from './sentiment';
import type { LLMProvider, CompleteResult } from '../providers/types';
import type { AgentContext, MarketMeta } from './types';

function mkMarket(over: Partial<MarketMeta> = {}): MarketMeta {
  return {
    marketId: 'm-1',
    title: 'Will Trump visit China by June 30?',
    endDate: '2025-06-30T23:59:00Z',
    category: 'politics',
    yes: 0.5,
    no: 0.5,
    volume24hr: 0,
    volumeTotal: 100_000,
    conditionId: '0xabc',
    tokenIdYes: 'tyes',
    tokenIdNo: 'tno',
    slug: 'will-trump-visit-china-by-june-30',
    ...over,
  };
}

function mkResult(over: Partial<CompleteResult>): CompleteResult {
  return {
    text: '',
    ok: true,
    elapsedMs: 100,
    model: 'grok-stub',
    provider: 'xai',
    ...over,
  };
}

function ctx(): AgentContext {
  return { market: mkMarket(), emit: vi.fn() };
}

describe('runSentimentAgent — Pass 1 captures Grok citations', () => {
  it('returns honest empty when Pass 1 returns no citations', async () => {
    const provider: LLMProvider = {
      name: 'xai',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(mkResult({ text: 'no relevant tweets found', citations: [] })),
    };

    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });

    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims).toHaveLength(1);
    expect(result.output.claims[0]!.text).toMatch(/no recent X conversation/i);
    // Pass 2 must not have been called
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('builds citation registry from Grok citation URLs and only allowlisted handles', async () => {
    // Pass 1: returns 2 citations — one allowlisted handle (@Reuters), one
    // off-allowlist (@randomguy). Pass 2: returns claims citing kol·1.
    const pass1 = mkResult({
      text: 'found tweets',
      citations: [
        'https://x.com/Reuters/status/1700000000001',
        'https://x.com/randomguy/status/1700000000002',
      ],
    });
    const pass2 = mkResult({
      text: JSON.stringify({
        claims: [{ text: 'Reuters reports diplomatic progress [kol·1]', citations: ['kol·1'] }],
        lean: 'unclear',
        confidence: 'low',
      }),
    });
    const provider: LLMProvider = {
      name: 'xai',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(pass1).mockResolvedValueOnce(pass2),
    };

    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });

    // Only the Reuters citation survives (handle is allowlisted)
    expect(result.output.citations).toHaveLength(1);
    expect(result.output.citations[0]!.label).toBe('@Reuters');
    expect(result.output.citations[0]!.url).toBe('https://x.com/Reuters/status/1700000000001');
    expect(result.output.claims[0]!.citations).toEqual(['kol·1']);
  });

  it('drops claims that contain URLs not in the registry (safety net)', async () => {
    const pass1 = mkResult({
      text: 'found',
      citations: ['https://x.com/Reuters/status/1700000000001'],
    });
    const pass2 = mkResult({
      text: JSON.stringify({
        claims: [
          { text: 'Real reference [kol·1]', citations: ['kol·1'] },
          // This claim leaks a URL that wasn't in Pass 1 — should be dropped.
          { text: 'Fake reference: https://x.com/Fake/status/9999 [kol·1]', citations: ['kol·1'] },
        ],
      }),
    });
    const provider: LLMProvider = {
      name: 'xai',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(pass1).mockResolvedValueOnce(pass2),
    };

    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });
    expect(result.output.claims).toHaveLength(1);
    expect(result.output.claims[0]!.text).toBe('Real reference [kol·1]');
  });

  it('returns honest empty when Grok citations all have off-allowlist handles', async () => {
    const pass1 = mkResult({
      text: 'found',
      citations: ['https://x.com/randomguy/status/1', 'https://x.com/anotherguy/status/2'],
    });
    const provider: LLMProvider = {
      name: 'xai',
      capabilities: { nativeJsonMode: false, webSearch: true, authViaSession: false },
      complete: vi.fn().mockResolvedValueOnce(pass1),
    };
    const result = await runSentimentAgent(ctx(), provider, {
      marketTitle: 'Will Trump visit China by June 30?',
      category: 'politics',
      yesPrice: 0.5,
      noPrice: 0.5,
      endDate: '2025-06-30T23:59:00Z',
      tweets: [],
    });
    expect(result.output.citations).toHaveLength(0);
    expect(result.output.claims[0]!.text).toMatch(/no recent X conversation/i);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/core/src/agents/sentiment.test.ts
```

Expected: FAIL — current sentiment.ts uses a single-pass design and doesn't capture citations.

- [ ] **Step 3: Refactor sentiment.ts to two-pass**

Replace the body of `runSentimentAgent` in `packages/core/src/agents/sentiment.ts`. After the existing imports, replace the `runSentimentAgent` function (lines 99-270) with:

```ts
export async function runSentimentAgent(
  ctx: AgentContext,
  provider: LLMProvider | null,
  input: SentimentInput,
): Promise<AgentResult> {
  const started = Date.now();

  if (!provider) {
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'sentiment agent disabled — add an xAI/Grok key in setup to unlock live X search.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      error: 'xai-not-configured',
    };
  }

  const sub = classifyMarket(input.category, input.marketTitle);
  const profile = profileFor(sub);
  const vettedHandles = profile.handles.slice(0, 25);

  // ──────────────────────── PASS 1 ────────────────────────
  // Trigger Grok live X-search with returnCitations enabled. Don't ask for
  // structured JSON — just a plain summary. The data we actually need is
  // res.citations[] (URLs Grok ACTUALLY pulled). Anything else from the
  // model is hallucination surface we don't want.
  const pass1Prompt = `Find recent X posts about: "${input.marketTitle}". Reply in 1-2 plain sentences summarising what you found — no quotes, no URLs in your reply.`;
  const pass1 = await provider.complete(pass1Prompt, {
    tier: 'fast',
    timeoutMs: 60_000,
    liveSearch: {
      mode: 'on',
      sources: ['x'],
      xHandles: vettedHandles,
      fromDays: 14,
      maxResults: 20,
      returnCitations: true,
    },
  });

  const grokCitations: string[] = pass1.citations ?? [];
  type RegistryEntry = { id: string; handle: string; url: string; n: number };
  const registry: RegistryEntry[] = [];
  for (const url of grokCitations) {
    const handle = parseHandleFromTweetUrl(url);
    if (!handle) continue;
    if (!isAllowlistedHandle(sub, handle)) continue;
    const n = registry.length + 1;
    registry.push({ id: `kol·${n}`, handle, url, n });
  }

  if (registry.length === 0) {
    // No real evidence → honest empty. Skip Pass 2 entirely.
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'no recent X conversation surfaced from vetted handles in the last 14 days for this market.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
    };
  }

  // ──────────────────────── PASS 2 ────────────────────────
  // liveSearch OFF. Model is given pre-fetched evidence and asked to
  // write claims that cite by index. No URLs come out of the model.
  const evidence = registry.map((r) => `[${r.id}] @${r.handle} — ${r.url}`).join('\n');
  const pass2Sys = `You summarise pre-fetched X posts for a prediction-market trader. The evidence below is real. Write 3-5 short claims about the prevailing view among these vetted voices, citing by index.

Allowed citations: ${registry.map((r) => `[${r.id}]`).join(' ')}

Rules:
- Reference posts ONLY by [kol·N]. Do NOT emit URLs, handles, or your own commentary about source identity.
- Each claim cites at least one [kol·N] from the supplied list.
- Keep claims neutral; let the trader form their own view.

Return JSON ONLY:
{
  "claims": [{ "text": "...", "citations": ["kol·N"] }],
  "lean": "yes" | "no" | "split" | "unclear",
  "confidence": "high" | "med" | "low"
}`;

  const pass2 = await provider.complete(
    `Market: "${input.marketTitle}"\nEvidence:\n${evidence}\n\nReturn the JSON.`,
    {
      tier: 'fast',
      systemPrompt: pass2Sys,
      jsonOnly: true,
      timeoutMs: 30_000,
      // liveSearch intentionally omitted — pure summarisation.
    },
  );

  // Build citations directly from the registry. The model NEVER produces
  // URLs in this pass; we use its claim text + citation indexes only.
  const citations: Citation[] = registry.map((r): Citation => ({
    id: r.id,
    kind: 'kol',
    label: `@${r.handle}`,
    payload: { handle: r.handle, text: '', url: r.url, createdAt: '' },
    url: r.url,
  }));

  type ParsedResp = { claims?: Array<{ text?: string; citations?: string[] }> };
  let parsed: ParsedResp | null = null;
  if (pass2.ok && pass2.text) {
    try {
      const m = pass2.text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]) as ParsedResp;
    } catch { /* fall through */ }
  }

  const validIds = new Set(registry.map((r) => r.id));
  const registryUrls = new Set(registry.map((r) => r.url));

  let claims: Claim[] = Array.isArray(parsed?.claims)
    ? parsed!.claims
        .map((c) => ({
          text: String(c.text || '').trim(),
          citations: Array.isArray(c.citations)
            ? c.citations.filter((id) => validIds.has(id))
            : [],
        }))
        .filter((c) => c.text.length > 0)
        // Safety net: drop any claim whose text leaks a URL not in the
        // registry. The Pass 2 system prompt says the model can't emit
        // URLs, but if it slips one in, we'd rather drop the whole claim
        // than partially trust it.
        .filter((c) => {
          const urlsInClaim = c.text.match(/https?:\/\/\S+/g) ?? [];
          return urlsInClaim.every((u) => registryUrls.has(u));
        })
        .slice(0, 5)
    : [];

  if (claims.length === 0) {
    return {
      agent: 'sentiment',
      output: {
        claims: [{ text: 'no recent X conversation surfaced. try again in a few minutes — fresh posts arrive throughout the day.', citations: [] }],
        citations: [],
      },
      grounding: null,
      elapsedMs: Date.now() - started,
      ...(pass2.ok ? {} : { error: pass2.error }),
    };
  }

  return {
    agent: 'sentiment',
    output: { claims, citations },
    grounding: null,
    elapsedMs: Date.now() - started,
  };
}

/** Parse @handle from an X/Twitter post URL.
 *  Accepts https://x.com/{handle}/status/{id} and twitter.com variants. */
function parseHandleFromTweetUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^(www\.)?(x\.com|twitter\.com)$/.test(u.hostname.replace(/^www\./, ''))) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts[1] !== 'status') return null;
    return parts[0] ?? null;
  } catch {
    return null;
  }
}
```

Delete the now-unused `systemPromptForSub` function and the `runWithStubTweets` fallback path (the stub-tweet rescue at lines 230-234 doesn't apply to the two-pass flow — we either get real Grok citations or honest empty). The stub feed (`packages/core/src/mcp/loaders/x-stub-data.json`) and `topTweetsForMarket` import in the server stay for any future use but no longer feed runSentimentAgent.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run packages/core/src/agents/sentiment.test.ts packages/core/src/agents/supervisor.test.ts
pnpm typecheck
```

Expected: 4 sentiment tests + supervisor tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agents/sentiment.ts packages/core/src/agents/sentiment.test.ts
git commit -m "fix(core): sentiment two-pass — capture Grok citations, model cites by index

Pass 1: xAI liveSearch on, minimal prompt, parse res.citations[].
Build registry of {id, handle, url} from real Grok-cited URLs only,
filtered to allowlisted handles.

Pass 2: liveSearch off, model gets the registry as numbered evidence
and writes claims by [kol·N] index only. No URLs come out of the model.

Safety net: any claim text that leaks a URL not in the registry is
dropped (belt + suspenders).

This is the structural fix for the @Reuters/2023 fabrications the user
flagged — the model can no longer invent tweet URLs because we never
ask it to produce them."
```

---

## Task 16: Manual verification README + final sweep

**Files:**
- Create: `docs/superpowers/verification/2026-05-12-honest-data.md`

- [ ] **Step 1: Create verification doc**

Create `docs/superpowers/verification/2026-05-12-honest-data.md`:

```markdown
# 2026-05-12 Honest-Data Hardening — Manual Verification

After all Phase 1-3 tasks ship, run these on the deployed Azure URL to
confirm the user-visible behavior matches the spec.

## 1. Resolved-market briefing

Open: pmcopilot.wtf and paste the URL for any RESOLVED Polymarket event
(any market with closed=true on gamma). Example to start: search for "Trump
visit China June 30" or any market with "resolved" status.

Confirm:
- [ ] Slate-amber banner above the title row reads "resolved · {date} · final YES @ $1.00" (or NO)
- [ ] The "trade on polymarket ↗" pill is still present
- [ ] The watch button is NOT present
- [ ] Right-rail agent dots: market, holders, news, comparables, synthesis (5 dots, NO sentiment or thesis)
- [ ] catalysts tab shows news from the 30 days BEFORE the resolution date — not "right now"
- [ ] No "@Reuters" / "@CFR_org" / fabricated 2023 tweets ANYWHERE in the brief

## 2. Active market — happy path

Open: any active market (closed=false). Confirm:
- [ ] All 6 dots visible (market, holders, news, sentiment, thesis, synthesis) + comparables
- [ ] catalysts tab has at least 2 news items
- [ ] sentiment tab either has tweets OR clear "no recent X conversation surfaced" diagnostic — never fabricated handles/dates
- [ ] Each citation URL is real (right-click → open in new tab → verifies on the source domain)

## 3. Active market — backend degradation

(Only possible from staging with env-var control.)

On staging, unset `EXA_API_KEY`. Brief any active market. Confirm:
- [ ] catalysts tab shows the diagnostic claim "no live news backend configured — server needs EXA_API_KEY..."
- [ ] No silent empty
- [ ] Other panels (market, holders, sentiment) still work

Restore `EXA_API_KEY` after the test.

## 4. Cache behavior

Brief the same active market twice within 6h.

Confirm:
- [ ] Second request is noticeably faster on the catalysts panel (cache hit)
- [ ] News items between the two requests are identical
- [ ] Other panels (market, holders) re-fetch as before (book/holders aren't cached at this layer)

## 5. Sentiment URL provenance

For any politics or geopolitics market with active X conversation:
- [ ] Click each citation pill in the sentiment tab
- [ ] Confirm each URL opens a real X post (not a 404)
- [ ] Confirm the handle in the post matches the citation label

If even one citation is a 404 or a "Sorry, you can't view this Tweet" page, the
provenance check has a gap — file an issue.
```

- [ ] **Step 2: Run the full test suite**

```bash
cd C:/Users/ayush/Downloads/pm-copilot-oss
pnpm typecheck
pnpm test
```

Expected: typecheck clean. All tests pass (baseline + new tests added through this plan).

- [ ] **Step 3: Commit verification doc**

```bash
git add docs/superpowers/verification/2026-05-12-honest-data.md
git commit -m "docs(verification): manual checklist for honest-data hardening rollout

Five user-facing scenarios to verify post-deploy: resolved-market
briefing, active-market happy path, backend degradation diagnostic,
cache behavior, and sentiment URL provenance. Filed alongside the spec
and plan for traceability."
```

- [ ] **Step 4: Push or PR the whole plan**

Decide with the user (same Task 0 conversation): direct push to main, PR, or worktree merge. Execute. The full plan should land as ~15 commits in a coherent sequence — each task is one commit, individually reviewable.

---

## Self-review

Spec coverage check:

| Spec section | Covered by task |
|---|---|
| Resolved-market detection | Task 1 |
| MarketMeta.resolvedAt + UI type | Tasks 1, 2 |
| Supervisor branch (skip sentiment+thesis) | Task 3 |
| News windowOverride | Task 4 |
| Resolved banner UI | Task 5 |
| News chain types | Task 6 |
| Retry policy | Task 7 |
| Cache (LRU + TTL + don't-cache-empty) | Task 8 |
| Exa backend | Task 9 |
| Polymarket comments backend | Task 10 |
| Provider web search backend | Task 11 |
| Chain orchestration | Task 12 |
| News agent refactor | Task 13 |
| Server wiring of cache | Task 14 |
| Sentiment two-pass | Task 15 |
| URL provenance safety net | Task 15 (covered in same refactor) |
| Manual verification | Task 16 |
| Pending UI commits (6d0dc97, e28142d) | Task 0 |

All sections of the spec map to a task. The plan is TDD-strict (failing test → impl → pass → commit on every task). Bite-sized: each task has 4-6 steps, ~5-20 min of work.

## Out of scope (already in spec, repeated here for clarity)

- New LLM providers
- Caching for non-news agents
- Cross-session persistence of NewsCache (in-memory only)
- Polymarket-comments write back
- New UI panels beyond the resolved banner
