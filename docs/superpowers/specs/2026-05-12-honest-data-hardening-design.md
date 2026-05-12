# Honest-Data Hardening — Design Spec

**Date:** 2026-05-12
**Status:** Approved (user said "approve" during brainstorming session 2026-05-12)
**Author:** ayushya (with claude-opus-4-7)

## Problem

Three production bugs from user-reported screenshots, plus two pending UI commits awaiting deploy.

1. **Sentiment fabricates tweets.** A resolved market ("Will Trump visit China by June 30?") showed `@Reuters`, `@CFR_org`, `@StateDept` with 2023-10 dates as "live X sentiment." Those handles are real, but Grok's live-search returned nothing — the LLM filled the gap from training data and the agent's only check is "is this handle on the allowlist?" Real handle + fabricated URL passes today.

2. **News returns empty when Google has plenty.** Same market: catalysts tab showed "no catalysts surfaced." A 5-second Google query returned CNBC, BBC, AlJazeera, YouTube coverage. The current pipeline has no retry, no multi-backend fallback, no cache — one transient Exa failure or an unset `EXA_API_KEY` and the user sees a silent empty.

3. **Resolved markets get treated as active.** The brief flow fans out news + sentiment + thesis on settled markets. Sentiment has nothing to summarise → fabricates. Thesis builds a forward-looking model for a question that already paid out. Both are the worst hallucination surfaces precisely because there *is* no current real-time data to ground in.

Plus two UI fixes from earlier in the day, sitting on local commit `6d0dc97`:
- Brand-cyan "trade on polymarket ↗" pill in MarketHeader
- Landing CTA placeholder truncation + dual-flow hint line

## Unifying principle

Every agent that surfaces evidence (URLs, tweets, articles) must build its **citation registry from a real tool first**, then constrain the LLM to *reference by index only*. The LLM never emits a primary key (URL, handle, date) that wasn't already in the registry.

Today, news already partially follows this pattern via the Exa path. Sentiment violates it. Resolved markets bypass it by running agents that have nothing real to cite.

## Architecture

### Touch list (~10 files, mostly small)

| File | Change |
|---|---|
| `packages/core/src/agents/types.ts` | Add `resolvedAt?: string \| null` to MarketMeta |
| `packages/core/src/feeds/polymarket.ts` | Populate `resolvedAt` from gamma `closed + endDate` |
| `packages/core/src/agents/supervisor.ts` | Branch on `resolvedAt`: skip sentiment + thesis; pass `windowOverride` to news |
| `packages/core/src/agents/news.ts` | Becomes thin orchestrator over the new `news/` module; accept `windowOverride` |
| `packages/core/src/agents/sentiment.ts` | Two-pass design: capture Grok citations, model writes claims only |
| `packages/core/src/news/searchChain.ts` | **NEW** — orchestrate 3 backends × 3 queries × retries × cache |
| `packages/core/src/news/backends/exa.ts` | **NEW** — moved from inline Exa path, wrapped in retry policy |
| `packages/core/src/news/backends/polymarketComments.ts` | **NEW** — scrape polymarket.com/event/{slug}#comments for article URLs |
| `packages/core/src/news/backends/providerWebSearch.ts` | **NEW** — Anthropic-CC / Perplexity native web search adapter |
| `packages/core/src/news/cache.ts` | **NEW** — LRU `Map<marketId, NewsGrounding>`, 6h TTL, 500-entry cap |
| `packages/core/src/news/retry.ts` | **NEW** — retry policy helper (backoff + 429 Retry-After) |
| `apps/server/src/routes/brief.ts` | Pass cache singleton to news agent |
| `apps/web/src/components/MarketHeader/MarketHeader.tsx` | Resolved banner above title row |
| `apps/web/src/hooks/useBrief.ts` | Extract `resolvedAt` into UI Market type |
| `apps/web/src/types.ts` | Add `resolvedAt?: string \| null` to Market |
| `apps/web/src/styles/global.css` | `.mh-resolved-banner` styles |

The two pending UI commits (`6d0dc97`) are merged into the same plan as Task 0 — push or PR them so they ship with the rest.

---

## Section 1 — Resolved-market handling

### Detection

In `packages/core/src/feeds/polymarket.ts:265`, `gammaToMarketMeta(ev, m, category)` is the single entry that builds MarketMeta from the Gamma payload. Add to its return object:

```ts
// Resolved = gamma's `closed: boolean` flag. Polymarket markets always have
// endDate, so resolvedAt aligns to the official close time. Active markets
// leave this field undefined.
resolvedAt: m.closed === true ? (m.endDate ?? null) : null,
```

All MarketMeta construction flows through `gammaToMarketMeta`, so a single change there populates `resolvedAt` everywhere (full-market route, event-by-slug, outcome-promoted singles). UI `Market` type gets the same field, threaded through `asMarket()` in `useBrief.ts`.

### Supervisor branch

`packages/core/src/agents/supervisor.ts:runSupervisor()` currently fans out four specialists + optional sentiment, then thesis + synthesis. After fix:

```ts
const isResolved = Boolean(rawMarket.resolvedAt);

// Sentiment + thesis are not in the agent dot list for resolved markets —
// they never appear "pending", they never resolve to a stub claim, they
// simply don't run.
const startedAgents: AgentId[] = isResolved
  ? ['market', 'holders', 'news', 'comparables', 'synthesis']
  : ['market', 'holders', 'news', 'comparables', 'thesis', 'synthesis'];
if (sentimentEnabled && !isResolved) startedAgents.splice(3, 0, 'sentiment');

// fanOut
const newsCall = isResolved
  ? () => runNewsAgent(ctx, newsProvider, searcher, {
      windowOverride: { endsAt: rawMarket.resolvedAt!, days: 30 },
    })
  : () => runNewsAgent(ctx, newsProvider, searcher);

const fanOut = [
  runOne('market', ...),
  runOne('holders', ...),
  runOne('news', newsCall),
  runOne('comparables', ...),
];
if (sentimentEnabled && !isResolved) fanOut.push(runOne('sentiment', ...));

// wave 2
const wave2 = isResolved
  ? [runSynthesisCall]                // no thesis
  : [thesisCall, runSynthesisCall];
```

Synthesis for resolved markets gets a flag in its context so its system prompt becomes "this market resolved on {date} — describe the path to resolution and what the leadup news shows, not what's coming."

### News window override

`runNewsAgent` accepts a new optional param:

```ts
type NewsOpts = {
  windowOverride?: { endsAt: string; days: number };
};
```

When set, every backend's date filter shifts: instead of `now - 30d → now`, it's `endsAt - days → endsAt`. Exa's `startPublishedDate`/`endPublishedDate` already support absolute date windows. Same for Polymarket comments (filter by createdAt). The provider native search gets the window in the user prompt: "search for news published between {start} and {end}."

### UI

`MarketHeader.tsx` — when `market.resolvedAt`:

```tsx
<div className="mh-resolved-banner mono">
  resolved · {humanDate(market.resolvedAt)} · final{' '}
  {finalOutcome === 'YES' ? <span className="yes">YES @ ${finalPrice}</span>
                          : <span className="no">NO @ ${finalPrice}</span>}
</div>
```

Slate-amber strip above `.mh-row`. The watch button is hidden (can't watch a settled market). The trade-on-polymarket pill stays — still useful for post-mortem price inspection.

`finalOutcome` and `finalPrice` come from `market.yes`/`market.no`: whichever is closer to 1.0 is the resolved outcome. (Verified by the Gamma payload: closed markets have one side at $1.00 and one at $0.00.)

---

## Section 2 — News self-healing chain

### Module layout

```
packages/core/src/news/
├── searchChain.ts       — orchestrator
├── cache.ts             — LRU + TTL
├── retry.ts             — backoff policy
└── backends/
    ├── exa.ts
    ├── polymarketComments.ts
    └── providerWebSearch.ts
```

`agents/news.ts` becomes ~80 lines: build query/context → call searchChain → render claims/citations from the returned hits → emit events.

### Backend interface

```ts
export type NewsHit = {
  url: string;
  title: string;
  source: string;       // domain
  publishedAt: string;  // ISO; REQUIRED — no undated hits ever
  snippet: string;
  score?: number;       // backend-specific relevance, optional
};

export type SearchBackend = {
  name: 'exa' | 'polymarket-comments' | 'provider-web';
  available(): boolean;  // synchronous capability check (key set, provider supports it)
  search(query: string, opts: {
    windowStart: string;  // ISO
    windowEnd: string;    // ISO
    marketTitle: string;  // for backends that need extra context
  }): Promise<NewsHit[]>;
};
```

Each backend handles its own auth, request shape, and result parsing. Output is normalised `NewsHit[]`. Denylist + allowlist filtering happens *after* the backend returns — in searchChain, not inside each backend. That keeps backends single-responsibility.

### Backends

**`exa.ts`** — Moved from the existing `runNewsViaExa` path in news.ts. Uses `process.env.EXA_API_KEY`. Returns hits with publishedDate; backends drop undated hits at the boundary so searchChain never sees them.

**`polymarketComments.ts`** — Polymarket exposes comments per event via their public site; the exact endpoint (`api/comments/?slug=...` or similar) needs to be confirmed during implementation by inspecting network calls on a live event page. Strategy: pull recent comments for the event, extract `https://...` URLs from comment bodies, dedupe by URL, snippet = the surrounding comment text trimmed to 240 chars, publishedAt = the comment's createdAt. Denylist applied at chain level. **All hits get `unverified: true`** — user-contributed quality, the UI badge surfaces that to the trader. If the endpoint turns out to be private/auth-walled, this backend stays `available() === false` and the chain skips it (no breakage).

**`providerWebSearch.ts`** — Uses the user's `primary` provider when it advertises `capabilities.webSearch`. Sends a minimal "news about X, return URLs + dates + titles in JSON" prompt. Parses the response. This is billable (the user paid for the key), so it's last in the chain to minimize cost.

### Retry policy (`retry.ts`)

```ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts: number;        // default 3
    baseDelayMs: number;     // default 500
    timeoutMs: number;       // default 10_000 per attempt
    onRateLimitedHeader?: (retryAfterSec: number) => void;
  },
): Promise<T>
```

Behavior:
- Wraps `fn` in `Promise.race` with a per-attempt timeout
- On 429: parse Retry-After header (if response object available), sleep `min(retryAfter, 5_000)`ms, retry (counts toward attempts)
- On 5xx: exponential backoff `baseDelayMs * 2^(attempt-1)` (500 → 1000 → 2000), retry
- On 4xx non-429: throw immediately (don't retry config errors)
- On timeout/network: backoff retry
- After `attempts` exhausted: throw the last error

Each backend wraps its outbound call(s) in `withRetry`. The chain wraps the *whole backend* in a per-backend wall-clock budget (10s) so a slow-but-not-erroring backend doesn't block the chain forever.

### Query variants

Three variants per backend, run in order. Stop when the running aggregate has ≥3 hits that pass denylist + dated checks.

```ts
const variants = [
  // 1. Title with recency framing
  `${market.title} — recent news, scheduled events, background`,
  // 2. Title with date qualifiers + parens stripped
  market.title
    .replace(/\([^)]*\)/g, '')
    .replace(/[—:].*$/, '')
    .replace(/\b(before|after|by|between|on|in)\s+\w+\s+\d+\s*,?\s*\d{0,4}/gi, '')
    .replace(/\s+/g, ' ')
    .trim(),
  // 3. Bare keywords — first 6 nouns after stripping fillers
  bareKeywords(market.title, 6),
];
```

`bareKeywords` is a new helper in `searchChain.ts` — splits on whitespace, drops stopwords (`the, a, will, in, by, before, after, between, on, of, to, ?`), takes the first 6.

### Cache (`cache.ts`)

```ts
type CacheEntry = { fetchedAt: number; grounding: NewsGrounding };

export class NewsCache {
  private store = new Map<string, CacheEntry>();
  private maxEntries = 500;
  private ttlMs = 6 * 60 * 60 * 1000; // 6h

  get(marketId: string): NewsGrounding | null {
    const e = this.store.get(marketId);
    if (!e) return null;
    if (Date.now() - e.fetchedAt > this.ttlMs) {
      this.store.delete(marketId);
      return null;
    }
    // LRU promotion: re-insert moves to the end
    this.store.delete(marketId);
    this.store.set(marketId, e);
    return e.grounding;
  }

  set(marketId: string, grounding: NewsGrounding): void {
    // Don't cache empty results — we want the chain to retry next time
    if (!grounding.items?.length) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(marketId, { fetchedAt: Date.now(), grounding });
  }
}
```

Process-singleton via `apps/server/src/news-cache.ts` (same pattern as `exa.ts`). Wired through `routes/brief.ts` into the supervisor's news call.

When a brief request hits a cached market, the news agent emits `agent:done` with `grounding.cached = true` so the UI can show a tiny "from cache" hint (optional, not in v1).

### Chain orchestration

```ts
export async function searchNews(
  market: { marketId: string; title: string; slug?: string },
  backends: SearchBackend[],
  cache: NewsCache,
  opts: { windowStart: string; windowEnd: string },
): Promise<NewsHit[]> {
  // 1. Cache check
  const cached = cache.get(market.marketId);
  if (cached) return cached.items;

  const aggregate: NewsHit[] = [];
  const chainBudget = 25_000;
  const chainStart = Date.now();

  for (const backend of backends.filter(b => b.available())) {
    if (Date.now() - chainStart > chainBudget) break;

    const backendBudget = 10_000;
    const backendStart = Date.now();

    for (const query of buildQueryVariants(market.title)) {
      if (Date.now() - backendStart > backendBudget) break;
      try {
        const hits = await backend.search(query, opts);
        const cleaned = hits
          .filter(h => h.url && h.publishedAt)
          .filter(h => !isDenylisted(h.url));
        // Dedupe by URL across variants
        for (const h of cleaned) {
          if (!aggregate.find(a => a.url === h.url)) aggregate.push(h);
        }
        if (aggregate.length >= 3) break; // enough hits for this backend
      } catch (err) {
        // Logged but not surfaced — try next variant or backend
        console.warn(`[news/${backend.name}] query failed: ${errorClass(err)}`);
      }
    }

    if (aggregate.length >= 3) break; // satisfied the chain
  }

  // Tag uncurated allowlist sources as unverified
  const tagged = aggregate.map(h => ({
    ...h,
    unverified: !isAllowlisted(sub, h.url),
  }));

  if (tagged.length) cache.set(market.marketId, { kind: 'news', items: tagged });
  return tagged;
}
```

### Diagnostic surface

When `searchNews` returns `[]`, news.ts emits one of three diagnostic claims (no citations):

```ts
function newsDiagnostic(state: {
  anyBackendConfigured: boolean;
  anyBackendErrored: boolean;
  errorClasses: Record<string, string>;
}): string {
  if (!state.anyBackendConfigured) {
    return 'no live news backend configured — server needs EXA_API_KEY or a web-search-capable provider. The catalysts panel can\'t surface news without one.';
  }
  if (state.anyBackendErrored) {
    return `news search degraded · ${Object.entries(state.errorClasses).map(([n,c]) => `${n}: ${c}`).join(' · ')} — try refreshing in a few minutes.`;
  }
  return 'no recent news surfaced for this market from any of 3 backends (Exa, polymarket comments, provider web search). The topic may be niche or too breaking for our sources.';
}
```

The UI shows the diagnostic in the catalysts tab. A small ⚠ on the news dot signals the agent ran but returned diagnostic-only.

---

## Section 3 — Sentiment fabrication fix

### Two-pass design

**Pass 1: live search**

```ts
const pass1 = await provider.complete(
  `Find recent X posts about: "${input.marketTitle}". Reply in plain text — just summarise what you found.`,
  {
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
  },
);

// Citations are URLs Grok actually pulled. Anything else is fabrication.
const grokCitations: string[] = pass1.citations ?? [];
```

If `pass1.citations` is empty → no real evidence → return honest empty (skip Pass 2 entirely).

**Build citation registry on our side**

```ts
const registry: Array<{ id: string; handle: string; url: string; n: number }> = [];
for (const url of grokCitations) {
  const handle = parseHandleFromTweetUrl(url); // /^https?:\/\/x\.com\/([^/]+)\/status\/\d+/
  if (!handle) continue;
  if (!isAllowlistedHandle(sub, handle)) continue;
  const n = registry.length + 1;
  registry.push({ id: `kol·${n}`, handle, url, n });
}

if (registry.length === 0) {
  // All Grok citations were off-allowlist or unparseable — same honest-empty
  // path as if Grok returned nothing.
  return honestEmpty();
}
```

**Pass 2: claim synthesis with `liveSearch: off`**

```ts
const evidence = registry.map(r => `[${r.id}] @${r.handle} — ${r.url}`).join('\n');
const sysPrompt = `You summarise pre-fetched X posts for a prediction-market trader. The evidence below is real. Write 3-5 short claims about the prevailing view, citing by index.

Allowed citations: ${registry.map(r => `[${r.id}]`).join(' ')}

Rules:
- Reference posts ONLY by [kol·N]. Do NOT emit URLs, handles, or your own commentary about source identity.
- Each claim cites at least one [kol·N] from the supplied list.
- Keep claims neutral; the trader forms their own view.

Return JSON ONLY: { "claims": [{ "text": "...", "citations": ["kol·N"] }], "lean": "yes|no|split|unclear", "confidence": "high|med|low" }`;

const pass2 = await provider.complete(
  `Market: "${input.marketTitle}"\nEvidence:\n${evidence}\n\nReturn the JSON.`,
  {
    tier: 'fast',
    systemPrompt: sysPrompt,
    jsonOnly: true,
    timeoutMs: 30_000,
    // No live search — purely summarisation.
  },
);
```

Citations are built directly from `registry`. Model emissions are claims only. The `tweets` field from the old response is **ignored entirely** — even if the model emits it, we don't read it.

### Safety net

URL-provenance guard, in case any URL leaks through (e.g., a future schema change):

```ts
function isFromRegistry(url: string): boolean {
  return registry.some(r => r.url === url);
}

// In claim parsing: if a claim text contains a URL substring that isn't in
// the registry, drop the claim entirely (don't try to "fix" it).
claims = claims.filter(c => {
  const urlsInClaim = c.text.match(/https?:\/\/\S+/g) ?? [];
  return urlsInClaim.every(isFromRegistry);
});
```

### Empty-state cascade

If Pass 1 returns 0 citations:
1. Retry with `fromDays: 30`
2. Retry without `xHandles` (broader X search, but post-hoc allowlist still applies to the citation list)
3. Honest empty: `"no recent X conversation surfaced from vetted handles in the last 30 days for this market"`

Stub-tweet fallback (`runWithStubTweets`) keeps working as-is for non-xAI providers — that path doesn't have the URL-fabrication risk (the stub URLs are real bundled data).

---

## Section 4 — UI fixes (pending push)

Commit `6d0dc97` on local main:
- `apps/web/src/types.ts` — added `slug?: string` to Market
- `apps/web/src/hooks/useBrief.ts` — `asMarket()` extracts slug
- `apps/web/src/components/MarketHeader/MarketHeader.tsx` — brand-cyan "trade on polymarket ↗" pill
- `apps/web/src/styles/global.css` — `.mh-trade-btn` styles
- `apps/web/src/components/LandingFlow/LandingFlow.tsx` — shorter placeholder + hint line
- `apps/web/src/components/LandingFlow/landing.css` — flex layout + `.cta-hint` styles

These changes ship as **Task 0** of the implementation plan — push the existing commit (with user approval) or open a PR for it, depending on the user's call on branch protection. They block nothing else.

The resolved-banner work in Section 1 extends MarketHeader.tsx further; that's a separate task that builds on Task 0 being deployed (or at least merged).

---

## Section 5 — Testing

### Unit tests (`pnpm vitest run`)

**`packages/core/src/agents/sentiment.test.ts`**
- Model emits URL not in Grok citations → dropped
- Pass 1 returns 0 citations → honest empty, Pass 2 not invoked
- Pass 1 returns citations with off-allowlist handles → all filtered, honest empty
- Pass 2 model emits URL substring in claim text → claim dropped

**`packages/core/src/news/retry.test.ts`**
- 429 with Retry-After: 2 → sleeps 2s then retries
- 429 with Retry-After: 10 → caps at 5s
- 500 → exponential backoff
- 401 (config) → throws immediately, no retry
- All attempts exhausted → throws last error

**`packages/core/src/news/cache.test.ts`**
- Set then get within TTL → returns grounding
- Set, advance time past TTL → returns null
- Set empty grounding → not cached
- 501 entries → oldest evicted
- Get → promotes entry (LRU)

**`packages/core/src/news/searchChain.test.ts`**
- Backend 1 returns 3+ hits → stops at backend 1
- Backend 1 returns 0 → tries backend 2
- All backends mocked empty → returns []
- Backend 1 throws → escalates to backend 2 (no propagation)
- Per-backend budget exceeded → escalates
- Chain budget exceeded → returns aggregate so far

**`packages/core/src/agents/supervisor.test.ts`**
- `market.resolvedAt` set → `startedAgents` excludes sentiment + thesis
- `market.resolvedAt` set → fanOut has 4 entries, not 5
- `market.resolvedAt` set → news called with windowOverride
- `market.resolvedAt` null → today's flow, unchanged

**`packages/core/src/feeds/polymarket.test.ts`**
- `closed: true` → `resolvedAt = endDate`
- `closed: false` → `resolvedAt = null`
- `closed: true, endDate: null` → `resolvedAt = null` (rare edge)

### Integration tests (server-level)

`apps/server/src/routes/brief.integration.test.ts` (or extend existing):
- POST resolved-market URL → response has `resolvedAt`, no sentiment in agents, news items dated within leadup window
- POST active market URL → response has news ≥1 item or diagnostic (not silent empty)
- All backends mocked failing → response has diagnostic claim, no fabricated items

### Manual verification (post-deploy)

A short README in `docs/superpowers/verification/2026-05-12-honest-data.md`:
1. Brief 5 known-active markets from different categories (sports, crypto, politics, tweets, weather). Confirm news panel populated for each.
2. Brief the Trump/China resolved market. Confirm: resolved banner shows; catalysts tab has leadup news (dated before resolution); sentiment dot is absent; thesis dot is absent.
3. Temporarily unset `EXA_API_KEY` on staging, brief any market. Confirm diagnostic claim renders correctly (not silent empty).

---

## Out of scope

- Adding new LLM providers beyond what's already wired
- Caching grounding for non-news agents (positions, holders, book stay direct)
- New UI panels — just the resolved banner above the existing header
- Cross-session persistence of the cache (in-memory only; OK to lose on deploy restart)
- Polymarket-comments backend writing — read-only scrape only
- xAI provider-internal retry beyond what already exists (sentiment fix is at the agent level)

## Success criteria

1. Brief the user's exact "Will Trump visit China" screenshot URL — resolved banner shows; catalysts populated from real CNBC/BBC/AlJazeera/etc. coverage in the 30 days before resolution; no sentiment tab; no fabricated 2023 dates anywhere.
2. Brief any active market with `EXA_API_KEY` unset on the server — catalysts tab shows a clear, actionable diagnostic instead of a silent empty.
3. Brief any active politics market with Grok keyed — sentiment tab shows tweets only from URLs Grok actually cited; zero handles attributable to fabrication.
4. Run `pnpm typecheck` and `pnpm vitest run` cleanly. No new lints, no test regressions.
5. The two pending UI fixes (`6d0dc97`) deploy alongside the rest as part of the same plan.

## Decisions log

| # | Decision | Chosen | Reason |
|---|---|---|---|
| Q1 | Scope | A (all 3 + UI fixes, one spec) | User wants this done right in one push |
| Q2 | Resolved-market UX | B (skip sentiment+thesis, leadup news, banner) | Kills worst hallucination surface; keeps post-mortem useful |
| Q3 | News chain | A+B+C (hard retries × multi-backend × cache) | Self-healing system; diagnostics only when truly stuck |
| Q4 | Sentiment fabrication | C (two-pass refactor + URL provenance) | Belt + suspenders; B is right architecture, A catches edges |
