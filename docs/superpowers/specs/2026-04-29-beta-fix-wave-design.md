# pm-copilot-oss · v0.1.0-beta.0 · fix-wave design

**Date:** 2026-04-29
**Status:** approved-for-spec-review (option C)
**Audit baseline:** 4/10 production-readiness — see `Per-screen audit` below.
**Target after wave:** 9.5/10. Workbench panels reflect real brief data; no decorative
mocks visible to users; full keyboard surface functional; sentiment tab demoable
via stub KOL feed.

---

## 1 · Goal

Close the gap between "everything compiles + dev boots" (current state) and
"every visible panel reflects the real brief" (production beta). All 12 items
flagged in the audit get fixed in one wave, in dependency order. No
architectural changes — only wiring, reducer extension, and display formatters.
Stays inside the HANDOFF.md plan; no new endpoints, no session-token
handshake, no SSE redesign.

## 2 · Per-screen audit (verified via `mcp__Claude_Preview` against running app)

| # | Defect | Severity | Root cause |
|---|---|---|---|
| 1 | `/api/events` 500s on contested mode | BLOCKER | server requests `limit=400` from Gamma; Gamma's tag-filtered endpoint 500s above ~100 |
| 2 | BookPanel/HoldersPanel show mock data | CRITICAL | `useBrief` reducer only consumes claims+citations from `agent:done`; ignores `agent:data` grounding rows |
| 3 | VerdictBand stats hardcoded (5 of 6) | HIGH | App.tsx never derives stats from grounding |
| 4 | MarketHeader: raw ISO datetime; empty criteria | HIGH | `useBrief.asMarket` reads `resolutionWording` (server uses `criteria`); no human-format for endDate |
| 5 | Chat doesn't call `/api/ask` | HIGH | `Chat.onSend` prop never threaded in App.tsx; no `useAsk` hook |
| 6 | News citations show only IDs, not full headlines | MEDIUM | NewsAgent emits citations with `label: 'news·N'` and full payload buried; UI extracts label, not payload.title |
| 7 | ThesisPanel falls back to mock when claims don't match `top:`/`compound:` shape | MEDIUM | parser too strict; doesn't tolerate provider variations |
| 8 | EmptyState "recently viewed" hardcoded | MEDIUM | demo data baked into component; no localStorage history |
| 9 | Setup screen: redundant skip CTAs | LOW | both Claude Code card and footer link call `onSkip` |
| 10 | CommandPalette items don't execute | LOW | UI shell only; no command handlers wired |
| 11 | Sentiment tab: empty `tweets[]` even with xAI key | LOW (deferred-spec) | no MCP feed registered for X mentions |
| 12 | Setup card crops footer at short viewports | LOW (cosmetic) | min-height not set; max-height not capped |

## 3 · Fix design (per item, scoped to existing files)

### Item 1 · Cap Gamma upstream limit · `apps/server/src/routes/markets.ts`

`listEventsForCategory` and `listMarketsForCategory` compute
`candidatePool = Math.max(150, limit * 5)` for contested mode. Cap at **100**
because Gamma's tag-filtered endpoint reliably 500s above that. Trade-off:
fewer candidates to bucket-sort by closeness-to-mid, but the per-tag pool
size makes that statistically fine for top-N rankings (limit ≤ 80 means we
still see 100 ÷ 80 = 1.25× coverage, which is enough for `mode=contested`).

```ts
const candidatePool = mode === 'contested'
  ? Math.min(100, Math.max(50, limit * 2))
  : Math.min(100, Math.max(40, limit * 2));
```

Apply identical cap inside `listMarketsForCategory`. ~2 lines per function.

### Item 2 · Reduce grounding into `useBrief` shape · `apps/web/src/hooks/useBrief.ts` + `apps/web/src/types.ts`

Extend `BriefShape` with `bookRows: BookRow[]`, `holderRows: HolderRow[]`,
`newsItems: NewsItem[]`. Reducer adds an `agent:data` branch that maps the
incoming `BookGrounding`/`HoldersGrounding`/`NewsGrounding` payloads into the
UI row types. Type adapters live next to the reducer (no separate utility
module — they're 10 lines each).

**Polymarket book shape:** server emits `BookGrounding` for the YES token,
i.e. `bids[]` are YES bids (someone wants to buy YES at price P) and `asks[]`
are YES asks. The design bundle's panel renders NO rows on top → spread →
YES rows on bottom, where each NO row is the equivalent of a YES bid
(NO ask price = `1 - YES_bid_price`). Mapping:

```ts
function bookGroundingToRows(g: BookGrounding): BookRow[] {
  const rows: BookRow[] = [];
  // Top half: NO asks (= YES bids inverted). Best-first → descending NO price.
  g.bids.slice(0, 3).forEach((l, i) => rows.push({
    id: `book-1b-${i + 1}`,                 // matches the citation IDs the supervisor emits
    side: 'NO',
    price: Number((1 - l.price).toFixed(3)),
    size: l.size,
    cum: l.cumulative ?? 0,
  }));
  // Bottom half: YES asks. Best-first → ascending YES price.
  g.asks.slice(0, 3).forEach((l, i) => rows.push({
    id: `book-1a-${i + 1}`,
    side: 'YES',
    price: l.price,
    size: l.size,
    cum: l.cumulative ?? 0,
  }));
  return rows;
}
```

**Citation alignment:** book/holder/news row IDs must match the citation IDs
agents emit (`book-stats`, `book-1b`, `book-1a` for book; `whale·1`,
`whale·stats` for holders; `news·1` etc for news). BookPanel/HoldersPanel/
NewsPanel use `id={\`src-${row.id}\`}` so `flashCitation('book-1b')`
locates `#src-book-1b`. The new reducer uses these IDs directly so click-
to-flash works without further wiring.

Similar mapping for holders (preserve `whale·N` indexing) and news
(preserve `news·N`). App.tsx threads `bookRows`, `holderRows`, `catalysts`
through `<EvidenceGrid>` props (props already exist on the component; only
the wire-up is missing).

### Item 3 · VerdictBand stats from grounding · `apps/web/src/App.tsx`

Compute the 5 stats inline from the brief shape:

```ts
const verdictSections: VerdictSection[] = useMemo(() => {
  if (!market) return [];
  const yes = market.yes ?? 0;
  const no = market.no ?? 0;
  const impliedYield = yes > 0 ? `${((1 / yes - 1) * 100).toFixed(1)}%` : '—';
  const daysToResolve = market.resolveIn; // already formatted by item 4
  const bookDepth = brief.bookRows.length
    ? `$${Math.round(brief.bookRows.reduce((s, r) => s + r.size, 0)).toLocaleString()} @ ${yes.toFixed(2)}`
    : '—';
  const spread = computeSpread(brief.bookRows);
  const concentration = brief.holderRows.length
    ? `${concentrationTopN(brief.holderRows, 10).toFixed(0)}% top10`
    : '—';
  return [
    { label: 'implied yield', value: impliedYield },
    { label: 'days to resolve', value: daysToResolve },
    { label: 'book depth (yes)', value: bookDepth },
    { label: 'spread', value: spread },
    { label: 'holders concentration', value: concentration },
  ];
}, [market, brief.bookRows, brief.holderRows]);
```

`computeSpread` and `concentrationTopN` go in `apps/web/src/lib/derivedStats.ts` (new
~40-line file).

### Item 4 · MarketHeader formatting · `apps/web/src/hooks/useBrief.ts` + `apps/web/src/lib/format.ts` (new)

Fix `asMarket` mapping:
- `criteria`: read `resolutionWording` OR `criteria` (server uses both names depending on
  source — Gamma vs cached). Fallback to `description` from event.
- `resolveIn`: format `endDate` ISO into `Nd Hh` via new `formatRelativeDuration(iso)`
  in `lib/format.ts`. ~25 lines.

### Item 5 · Chat → `/api/ask` · new `apps/web/src/hooks/useAsk.ts` + `App.tsx` wire

`useAsk(marketId, market)` returns `{ messages, send, busy, error }`.
- POST to `/api/ask` with body `{ marketId, market, question }`.
- Server returns SSE; reuse `useSSE<AskEvent>` against a one-shot endpoint.
  Since `EventSource` is GET-only, we instead use `fetch` + `ReadableStream`
  reading SSE frames manually. ~80 lines.
- Append assistant message with citation pills as the stream progresses.

App.tsx: `<Chat messages={ask.messages} onSend={ask.send} />`.

The on-demand chat agent is `ask` in the supervisor's 7-slot model — this
wires the last agent dot too.

### Item 6 · Full citation labels · `packages/core/src/agents/news.ts` + `useBrief`

NewsAgent currently emits citations with `label: 'news·N'` and the full
article in `payload`. Change `label` to the article headline (truncated 80
chars) so the UI displays the real title without consumers digging into the
opaque `payload`. Reducer no-op — `Citation.label` already maps through.

For book/whale citations the existing labels are fine (numeric indexes are
the right granularity in panel rows).

### Item 7 · Tolerant thesis parser · `apps/web/src/App.tsx::thesisFromSection`

Current parser only matches `top:` and `compound:` prefixes. Real provider
output sometimes drops the `top:` prefix or uses `Top claim:` / `Conclusion:`.
Tolerate variations:

```ts
const ROOT_PATTERNS = [/^top\s*:\s*/i, /^top\s+claim\s*:\s*/i, /^conclusion\s*:\s*/i];
const COMPOUND_PATTERNS = [/^compound\s*:\s*/i, /^summary\s*:\s*/i];
```

If no root matches, the FIRST claim becomes the root. If `subClaims < 1`,
return undefined (let the panel show the loading skeleton until data arrives).

### Item 8 · Recently-viewed from localStorage · `apps/web/src/hooks/useRecentlyViewed.ts` (new) + `EmptyState`

New hook persists last 6 marketIds visited (with their cached `MarketMeta`)
under `pm-copilot:recents:v1`. App.tsx pushes on every `selectedMarketId`
change. EmptyState reads via prop instead of using its hardcoded list.

If localStorage has fewer than 3 recents, the section heading hides entirely
(no awkward half-empty grid).

### Item 9 · Setup screen: drop secondary skip CTA · `apps/web/src/components/SetupFlow/SetupScreen.tsx`

Remove the bottom `setup-skip` button. Esc shortcut + the "claude code
(auto-detect)" card are sufficient. Update the footer `mono` line to read
`esc to skip · keys never leave your machine` (already does).

### Item 10 · CommandPalette items execute · `apps/web/src/components/CommandPalette/CommandPalette.tsx` + `App.tsx`

Each item gets an `onSelect: () => void` callback. App.tsx passes:
- `⌘1-4` → `setFocusedPanel`
- `⌘[` `⌘]` → rail collapse setters
- `⌘P` (pin chat answer to verdict) → defer to post-beta (no-op for now)
- `⌘,` (settings) → no-op for now (route exists but page deferred)

Filter input: substring match on item label. Enter triggers the top match's
`onSelect`. Click ditto.

### Item 11 · Sentiment MCP stub · `packages/core/src/mcp/loaders/x-stub.ts` (new) + `apps/server/src/routes/brief.ts`

Stub feed registered under venue `polymarket` scope `news` (sentiment
sub-scope when supported; for v0 we shoehorn through the brief's `tweets`
input). The stub reads a JSON file from `packages/core/src/mcp/loaders/x-stub-data.json`
containing 50 pre-curated KOL tweets with shape:

```json
[
  { "handle": "0xayushya", "text": "btc just broke 96k...", "url": "https://x.com/...", "createdAt": "2026-04-28T..." }
]
```

`brief.ts` filters by simple keyword match on `market.title.toLowerCase()` →
top 10 → passes to `runSupervisor({ ..., tweets })`. Sentiment agent now has
input even before an X-actions MCP server is registered. The seed JSON ships
with the repo so users can demo immediately. Production users supplying an
X-actions MCP get real-time data.

### Item 12 · Setup card sizing · `apps/web/src/styles/components.css`

Add `min-height: 100vh; padding: 24px 0; overflow: auto` to `.setup-screen`.
Cap `.setup-card` at `max-height: calc(100vh - 48px); overflow-y: auto`.

## 4 · Architecture (unchanged)

No new modules cross package boundaries. No new HTTP endpoints. No
EventSource → fetch+ReadableStream migration for `/api/brief` (deferred per
HANDOFF stance — paste-key BYOK on SSE remains a documented gap; subprocess
auth is the supported v0 path). The fix-wave is purely:

- 1 server route patch (item 1)
- 1 hook reducer extension (item 2)
- 2 new lib files (`derivedStats.ts`, `format.ts`)
- 1 new hook (`useAsk`)
- 1 new hook (`useRecentlyViewed`)
- 1 new MCP stub loader + JSON seed
- 1 component rewire (CommandPalette)
- 1 small component edit (SetupScreen)
- App.tsx orchestration glue (~80 lines added)

## 5 · Acceptance criteria (verify via Claude Preview)

After the wave lands and dev reloads, the following must all be true:

1. `GET /api/events?category=crypto&limit=80&mode=contested` returns 200 with ≥1 event.
2. LeftRail renders ≥6 real polymarket events (one per category tab); no "loading…" hang.
3. `/m/<liveMarketId>` after brief completes:
   a. MarketHeader shows formatted `resolves in` like `60d 14h`.
   b. Resolution criteria text is non-empty (length > 0) when expanded.
   c. BookPanel shows ≥3 NO rows + ≥3 YES rows from the real grounding.
   d. HoldersPanel shows top 6 real wallet rows (real addresses, not `0xABCD…1234`).
   e. NewsPanel `catalysts` tab shows ≥1 row whose `news-title` text is a real headline (>20 chars, not equal to `news·N`).
   f. ThesisPanel: shows root claim derived from real thesis section (not "btc reaches $100k by eoy 2026" mock).
   g. VerdictBand: 5 stats values are derived (`bookDepth` matches `Σ size` in BookRow), `citations` count > 0.
4. Cmd+B: toggling a market on/off updates `localStorage['pm-copilot:watchlist:v1']` and the right-rail watch list.
5. Cmd+K: palette opens. Typing "book" highlights the `focus book panel` row; Enter focuses the book panel; Esc closes.
6. Chat: typing a question + Enter triggers POST `/api/ask`; assistant message appears within 60s; agent-dot for `ask` flips done.
7. Setup screen at viewport 1280×600: card fits without footer being clipped; only ONE skip path visible (the claude code card).
8. Recently viewed in EmptyState: after visiting 3 markets and going `/`, the section shows real markets with real prices — not the hardcoded "btc at $100k by eoy 2026".
9. Sentiment tab (with `XAI_API_KEY` env var set on server, no client-side xAI key): tab is enabled and shows ≥1 row sourced from the bundled stub feed.
10. `pnpm typecheck` exits 0.
11. `pnpm smoke` exits 0.

## 6 · Out of scope (explicitly deferred)

- BYOK paste-key delivery to `/api/brief` SSE (HANDOFF acknowledged gap; subprocess auth covers v0)
- `⌘P` "pin chat answer to verdict band" command (no `pinned` slot in VerdictBand yet)
- Settings page (route reserved, screen deferred)
- Compare mode, Mobile fallback (per spec §16 cuts)
- Real-time X feed (the stub is intentionally static for the demo; a registered X-actions MCP overrides at runtime)
- Vercel + Render deploy (configs already in repo from Task K; verifying the live URL is post-merge)

## 7 · Risk / rollback

Every fix is additive or replacement of decorative defaults. If item N breaks
something, revert just that file — no cross-cutting changes. The reducer
extension in `useBrief` (item 2) carries the most risk because it changes the
hook's return shape; mitigated by adding fields rather than renaming, so
existing consumers (none other than App.tsx today) keep working.

## 8 · Time budget

| Item | Files touched | Est |
|---|---|---|
| 1 | `markets.ts` | 5 min |
| 2 | `useBrief.ts`, `types.ts`, `App.tsx`, `EvidenceGrid.tsx` | 60 min |
| 3 | `App.tsx`, `lib/derivedStats.ts` (new) | 30 min |
| 4 | `useBrief.ts`, `lib/format.ts` (new) | 25 min |
| 5 | `hooks/useAsk.ts` (new), `App.tsx`, `Chat.tsx` | 80 min |
| 6 | `agents/news.ts`, `useBrief.ts` (small) | 20 min |
| 7 | `App.tsx::thesisFromSection` | 15 min |
| 8 | `hooks/useRecentlyViewed.ts` (new), `EmptyState.tsx`, `App.tsx` | 40 min |
| 9 | `SetupScreen.tsx` | 5 min |
| 10 | `CommandPalette.tsx`, `App.tsx` | 30 min |
| 11 | `mcp/loaders/x-stub.ts` (new), JSON seed, `brief.ts` wiring | 60 min |
| 12 | `components.css` | 10 min |
| End-to-end retest via Claude Preview | n/a | 30 min |
| **TOTAL** | | **~7 hr** |
