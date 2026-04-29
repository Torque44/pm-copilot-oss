# pm-copilot-oss — design spec

**Status:** Approved 2026-04-29 via `superpowers:brainstorming`
**Author:** Ayushya Jain ([@0xayushya](https://x.com/0xayushya))
**Repo target:** `C:/Users/ayush/Downloads/pm-copilot-oss/` (new)
**Supersedes:** `pm-copilot/` rebuild (2026-04-28). pm-copilot is kept as a working reference; the open-source release ships from this fresh tree.

---

## 0 · Why this exists

pm-copilot-oss is the open-source-ready reference implementation of a **grounded research desk for prediction-market traders**. The job is *pre-trade research* — the user has a market in mind, wants depth before they place the bet — not portfolio monitoring, not opportunity scanning, not execution. Everything else falls out of that.

The product replaces the hallucinating "AI research" surface in existing PM terminals (Kairos, Polymarket native chat) with a multi-agent grounded pipeline. Three specialists fan out in parallel against real Polymarket data; an optional Perplexity News specialist + an optional xAI Sentiment specialist add web-grounded and X-grounded layers; a Synthesis pass merges with a citation-ID allowlist. Every claim is a clickable pill that flashes its source row.

Read-only by design: no order placement, no wallet management, no buy/sell calls.

---

## 1 · Foundational decisions (locked)

| # | Decision | Value |
|---|---|---|
| 1 | Primary job | Pre-trade research desk |
| 2 | Verdict opinion-level | Neutral evidence (descriptive only — no buy/sell calls) |
| 3 | Density | Bloomberg-dense workbench; 2×2 evidence grid + verdict band + chat |
| 4 | Repo strategy | Fresh repo, port working backend from `pm-copilot/`, rebuild UI from claude-design bundle |
| 5 | Repo name + path | `pm-copilot` at `C:/Users/ayush/Downloads/pm-copilot-oss/`, MIT license |
| 6 | Positions identity | username + wallet (both supported); Polymarket profile API resolves handles |
| 7 | LLM auth model | Claude Code auto-detect → BYOK guided picker (no free-tier shared backend) |
| 8 | Multi-provider | Primary AI required; optional Perplexity (News enhancement) + xAI (Sentiment agent) |
| 9 | Distribution | Static demo site + one-click deploy buttons + GitHub Codespaces config |
| 10 | Theme | Dark default (non-negotiable); light mode is a secondary toggle |
| 11 | Identity sync | Sign-in-with-Google for cross-device favorites/watchlist sync (deferred to v0.2) |

The full rationale for each decision is captured in the brainstorming session 2026-04-29; transcript not preserved but every section was approved before locking.

---

## 2 · Project structure

```
pm-copilot-oss/
├── README.md                      # hero, demo link, deploy buttons, screenshots
├── LICENSE                        # MIT
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md             # Contributor Covenant 2.1
├── SECURITY.md
├── CHANGELOG.md                   # semver, automated by changesets
├── ROADMAP.md
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # typecheck + lint + tests + build
│   │   ├── secrets-scan.yml       # gitleaks
│   │   ├── release.yml            # manual; publish core to npm + skill bundle to releases
│   │   └── deploy-demo.yml        # auto-deploy demo on main
│   ├── ISSUE_TEMPLATE/{bug,feature}.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── package.json                   # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json             # strict: true, target ES2022
├── .editorconfig
├── .prettierrc
├── .eslintrc.cjs                  # @typescript-eslint/strict + react-hooks + jsx-a11y
├── .gitignore
├── .env.example
├── mcp.config.example.json
│
├── apps/
│   ├── web/                       # React frontend, rebuilt from design bundle
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── LeftRail/
│   │   │   │   ├── RightRail/    # tabs: Positions | Watchlist | Recent + agent dots pinned
│   │   │   │   ├── MarketHeader/
│   │   │   │   ├── EvidenceGrid/ # 2×2: Book | Holders | News(tabs) | Thesis
│   │   │   │   ├── VerdictBand/
│   │   │   │   ├── Chat/
│   │   │   │   ├── CommandPalette/
│   │   │   │   ├── SettingsModal/
│   │   │   │   ├── SetupFlow/    # provider picker + key paste + live test
│   │   │   │   └── States/       # Empty, Loading, Error, Compare, Mobile
│   │   │   ├── hooks/
│   │   │   │   ├── useBrief.ts
│   │   │   │   ├── useEventsList.ts
│   │   │   │   ├── usePositions.ts
│   │   │   │   ├── useWatchlist.ts
│   │   │   │   ├── useProviders.ts
│   │   │   │   └── useSSE.ts
│   │   │   ├── lib/
│   │   │   │   ├── client.ts      # HTTP + SSE thin wrapper
│   │   │   │   ├── scroll-rail.ts # ported from design bundle, TS
│   │   │   │   ├── citationFlash.ts
│   │   │   │   ├── cryptoStorage.ts # IndexedDB AES-GCM for keys
│   │   │   │   └── routing.ts     # URL <> state
│   │   │   └── styles/
│   │   │       ├── tokens.css     # from design bundle verbatim
│   │   │       └── global.css
│   │   ├── public/
│   │   │   ├── logo-mark.svg      # from bundle
│   │   │   └── logo-wordmark.svg
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── server/                    # Express, ported + extended for positions
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── brief.ts
│   │   │   │   ├── ask.ts
│   │   │   │   ├── events.ts
│   │   │   │   ├── markets-list.ts # legacy/back-compat
│   │   │   │   ├── positions.ts   # NEW: GET /api/positions?wallet=…
│   │   │   │   ├── profile.ts     # NEW: GET /api/profile/{handle} → wallet resolve
│   │   │   │   ├── watchlist.ts   # NEW: only used in Google-sync mode
│   │   │   │   └── auth/test.ts   # NEW: validate provider key
│   │   │   ├── cache.ts
│   │   │   ├── briefStore.ts
│   │   │   ├── eventBus.ts
│   │   │   ├── groundingStore.ts
│   │   │   ├── persist.ts
│   │   │   └── positionsStore.ts  # NEW: per-wallet 60s cache
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── demo/                      # static showcase build
│       ├── briefs/                # pre-recorded JSON brief streams
│       │   ├── btc-100k.json
│       │   ├── fed-april.json
│       │   └── …
│       ├── index.html
│       └── vite.config.ts
│
├── packages/
│   ├── core/                      # pure logic; zero DOM/server deps; npm-publishable
│   │   ├── src/
│   │   │   ├── agents/
│   │   │   │   ├── market.ts
│   │   │   │   ├── holders.ts
│   │   │   │   ├── news.ts        # uses Perplexity if configured, else primary
│   │   │   │   ├── sentiment.ts   # NEW: xAI Grok required; agent skips if not configured
│   │   │   │   ├── thesis.ts
│   │   │   │   ├── synthesis.ts
│   │   │   │   ├── ask.ts
│   │   │   │   └── supervisor.ts
│   │   │   ├── providers/
│   │   │   │   ├── anthropic.ts   # auto-detects Claude Code subprocess vs API key
│   │   │   │   ├── openai.ts
│   │   │   │   ├── google.ts
│   │   │   │   ├── perplexity.ts
│   │   │   │   ├── xai.ts         # NEW
│   │   │   │   ├── factory.ts     # per-agent provider routing
│   │   │   │   └── types.ts
│   │   │   ├── mcp/
│   │   │   │   ├── types.ts
│   │   │   │   ├── registry.ts
│   │   │   │   └── loaders/
│   │   │   │       ├── polymarket.ts # built-in
│   │   │   │       ├── kalshi.ts     # stub for v0.2
│   │   │   │       └── external.ts   # stdio/HTTP MCP client
│   │   │   ├── feeds/
│   │   │   │   ├── polymarket.ts  # Gamma + CLOB + Data clients
│   │   │   │   └── http.ts        # shared fetch helper
│   │   │   └── types.ts           # MarketMeta, EventMeta, Outcome, Citation, Brief
│   │   ├── tests/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── skill/                     # Claude Code skill bundle
│       ├── pm-research/
│       │   └── SKILL.md
│       ├── README.md
│       └── package.json
│
├── scripts/
│   ├── prewarm-cache.mjs
│   ├── smoke-providers.mjs
│   ├── record-demo.mjs            # generate static demo brief JSONs
│   └── verify-design.mjs          # Playwright visual regression vs bundle
│
├── docs/
│   ├── architecture.md
│   ├── adding-a-venue.md
│   ├── adding-an-mcp.md
│   ├── api.md
│   ├── design-system.md
│   ├── voice.md                   # copy guidelines
│   ├── superpowers/
│   │   └── specs/
│   │       └── 2026-04-29-pm-copilot-oss-design.md  # this doc, copied at repo init
│   └── …
│
└── design-bundle/                 # snapshot of claude-design input (reference only)
    ├── colors_and_type.css
    ├── research-desk/
    └── README.md
```

**Why monorepo:** `packages/core` is the agent kernel + provider factory + MCP registry — publishable separately so anyone can build their own UI on top. `apps/web` and `apps/server` are deploy units. `packages/skill` ships as a Claude Code skill bundle that calls into a running `apps/server`.

**Tooling:** pnpm workspaces (lighter than npm for monorepos), Vite + React 19, TypeScript strict, ESLint + Prettier with Husky + lint-staged pre-commit hook, GitHub Actions CI.

---

## 3 · Setup flow

The most important UX in the product. Without LLM auth, nothing runs.

### 3.1 Two paths

**Path A — Auto-detect Claude Code (zero-touch).** On boot, server runs `claude --version`. If exit-0, sets `PROVIDER=anthropic-cc`, uses subprocess auth. User sees nothing — lands directly on the empty state. Most CT users hit this path.

**Path B — Bring your own key (guided picker).** First load with no provider configured shows the **provider picker as the empty state** (not the research desk). Cards for Anthropic / OpenAI / Gemini / Perplexity with one-line value props + cost-per-brief estimates.

Click a provider →
1. Deep-link to that provider's API key console opens in new tab
2. Inline guide tells the user exactly what to click ("Click 'Create Key', name it 'PM Copilot', copy")
3. Single paste field with auto-test (server validates with provider via `/api/auth/test`)
4. Stored in IndexedDB encrypted with Web Crypto AES-GCM (key derived per-install from session secret)
5. Test passes → "you're set" CTA → proceeds to empty state

Total time picker → first brief: **< 60 seconds.**

### 3.2 Layered enhancements (Tier 2, optional)

After Tier 1 setup, user sees **two optional cards** in Settings → Enhancements:

- **Perplexity Sonar** — unlocks Perplexity-grounded News agent (replaces primary's web search). ~$0.005/brief.
- **xAI Grok** — unlocks NEW Sentiment agent with X-native KOL takes. **Required for Sentiment agent to run** (otherwise its panel tab is greyed). ~$0.01/brief.

Each is a separate guided paste flow, same pattern as Tier 1. Skippable.

### 3.3 Per-agent provider routing

| Agent | Prefers | Falls back to |
|---|---|---|
| Market | Primary (mostly deterministic) | — |
| Holders | Primary | — |
| **News** | Perplexity if configured | Primary's web search |
| **Sentiment** (NEW) | xAI / Grok required | Disabled (panel tab greyed) |
| Thesis | Primary | — |
| Synthesis | Primary (sonnet-tier) | — |
| Ask (chat) | Primary (sonnet-tier) | — |

Routing happens server-side via `packages/core/providers/factory.ts`. Frontend has no awareness; just receives the brief stream and renders panels as agents complete.

### 3.4 Sign-in-with-Google (deferred to v0.2)

Cross-device sync of favorites/watchlist/wallet. Not LLM auth. Standard Google OAuth, server creates user row keyed on Google ID. Optional. Skipped in v0.1.

---

## 4 · Speed & smoothness commitments

| Action | Target | Technique |
|---|---|---|
| Click market → brief streams | < 200ms | URL-as-state, no client blocking I/O |
| Cached brief replay | < 600ms total | Disk snapshot, SSE 30ms event stagger |
| Fresh brief, first content | < 2s | Specialists fan out parallel; market header instant |
| Fresh brief, full | 45-90s | Bound by LLM + Polymarket APIs |
| Provider switch | 0 UI flicker | Server-side swap |
| Citation pill click → flash | < 50ms | DOM event + rAF CSS animation |
| Sidebar collapse/expand | < 100ms | CSS transform, no React state |
| Search-as-you-type | < 80ms | Client-side filter, 100ms debounce, virtualized |
| Position fetch (cached) | < 400ms | Server cache 60s, IndexedDB fallback |
| Live orderbook tick | < 100ms | WebSocket → direct DOM, no React re-render |

**Four enabling techniques:**

1. **URL is the source of truth.** `/m/{outcomeMarketId}` deep-links to a market. Refresh resumes where you left off.
2. **Server pre-warms popular markets on a 5-min cron.** First 100 events × all outcomes pre-cached. Most clicks hit cache.
3. **SSE everywhere.** Briefs, positions, ask responses all stream. UI never blank waiting for full payloads.
4. **Optimistic everything.** Sidebar collapse, watchlist add/remove, market selection apply locally first; sync to server in background; failures show toast + revert.

---

## 5 · Information architecture

### 5.1 Workbench layout

```
┌─────────────┬────────────────────────────────────────┬──────────────┐
│ EVENT RAIL  │ MARKET HEADER ── sticky                │ CONTEXT RAIL │
│ 320px       │ title · YES 38¢ · NO 62¢ · 12d · $5.8M │ 280px        │
│ collapsible │ resolution criteria → click-expand     │ collapsible  │
│ Cmd+[       │                                        │ Cmd+]        │
│             ├────────────────────┬───────────────────┤              │
│ search      │ BOOK               │ HOLDERS           │ [tabs]       │
│ + filter    │ live orderbook     │ top-20 wallets    │ Positions │  │
│             │ top-5 bid/ask      │ yes/no split      │ Watchlist │  │
│ events list │ depth ±5¢          │ concentration     │ Recent      │
│ each event  │ slippage curve     │ smart-money lights│              │
│ + outcomes  │                    │                   │ wallet input │
│ as nested   ├────────────────────┼───────────────────┤              │
│ rows        │ NEWS [tabs]        │ THESIS            │ tab content  │
│             │ Catalysts          │ causal sub-claim  │              │
│ multi-      │ Sentiment (xai)    │ tree              │              │
│ outcome     │ Resolution         │ kill-thesis pass  │ ─────────    │
│ stays       │                    │                   │ AGENT DOTS   │
│ grouped     ├────────────────────┴───────────────────┤ pinned       │
│             │ POSITION CONTEXT STRIP (if applicable) │ ●●●●●○●      │
│             ├────────────────────────────────────────┤ 7 specialists│
│             │ VERDICT BAND — descriptive only        │              │
│             │ Implied Yield + key metrics            │              │
│             ├────────────────────────────────────────┤              │
│             │ CHAT — sticky, 1-line collapsed        │              │
└─────────────┴────────────────────────────────────────┴──────────────┘
```

### 5.2 Routes

| URL | Renders | Notes |
|---|---|---|
| `/` | Empty state OR last-viewed market | First-time → empty + 4 sample markets |
| `/m/{outcomeMarketId}` | Research desk on that outcome | Primary deep-link |
| `/event/{eventId}` | Event picker (multi-outcome events) | User picks an outcome |
| `/compare/{a}-{b}` | Compare mode, two markets side-by-side | Cmd+D |
| `/settings` | Settings modal over current state | Modal route |
| `/setup` | Setup flow (provider picker) | Forced if no provider configured |

Browser back/forward work correctly. URL is source of truth.

### 5.3 Right rail tabs (the user's personal context layer)

**Positions tab:**
- Wallet input at top (handle or 0x address); server resolves either via Polymarket profile API
- Summary row: "N open · $total · last refresh Xs ago"
- Position cards: event title / side · size · entry / current · unrealised P&L · days-to-resolution
- Sort: by absolute P&L desc (default), by time-to-resolution asc, by size desc, by recency
- Click a position → loads `/m/{outcomeMarketId}` with **Position Context Strip** rendered above Verdict band
- Empty states distinct: no wallet entered / wallet but no positions / Polymarket API error

**Watchlist tab:**
- "Watching N markets" header + Cmd+B prompt to add current
- Cards: event title / outcome label / current price / ∆ since added (color-coded)
- Add via star icon on event cards (hover-revealed), Cmd+B, or right-click menu
- Resolved markets show "resolved YES → 100¢" with would-be-P&L; user clears manually
- Sort: ∆ since added (default) or recency added

**Recent tab:**
- Last 8 markets visited, auto-tracked, FIFO eviction
- Same card shape minus ∆
- Click to load

**Agent status (always pinned at rail bottom):**
- 7 dots: market / holders / news / sentiment / thesis / synthesis / reporter
- States: pending / running / done / error
- Hover for elapsed ms

### 5.4 Position context strip (when loaded market matches a wallet position)

```
┌─ YOUR POSITION ─────────────────────────────────────┐
│ YES · 1,500 sh @ 28¢ entry · 12 days ago            │
│ unrealised: +$1,500 (+35.7%) · resolves in 14d       │
│ entry-to-now exit slippage: 2.1¢ vs current book    │
└──────────────────────────────────────────────────────┘
```

- Auto-detected on brief load via marketId match against fetched positions
- Strictly descriptive — no exit/add calls
- "Exit slippage" line uses live orderbook to estimate cost of exiting now
- Click to expand position history (entries/exits if Polymarket exposes)

### 5.5 Persistence model

| Data | Storage | TTL | Sync |
|---|---|---|---|
| Wallet (handle + 0x) | localStorage | none | Google v0.2 |
| Positions (raw) | server cache, per-wallet | 60s | — |
| Watchlist | localStorage | none | Google v0.2 |
| Recent | localStorage | none, FIFO 8 | Google v0.2 |
| Sidebar collapse | localStorage | none | per-device |
| Provider keys | IndexedDB (AES-GCM) | none | NEVER synced |
| Cached briefs | server disk snapshot | 10 min | — |

---

## 6 · States

### 6.1 Empty (no market loaded)

Hero (lowercase) + paste-Polymarket-URL input + recent grid (4 cards). First-time-user fallback: 4 hand-picked sample markets when localStorage is empty. Tip footer: "Cmd+K to search · Cmd+[ to collapse left rail."

### 6.2 Loading (brief running)

Layered, never blank:
1. **0-200ms:** Market header renders from cached event metadata. Skeletons in panels. URL changes.
2. **1-3s:** First specialist completes → fills its panel. Other panels skeleton + agent dot pulsing.
3. **45-90s:** Synthesis lands → Verdict band fills. Top-right toast: "brief complete · 47s · 7 specialists." Auto-dismiss after 2s.

Loading toast (top-right): `[⠼] researching · 23s · 4/7 done`. Click to expand per-agent timing.

### 6.3 Error (per-panel, never per-page)

If one agent fails, only its panel shows error with inline recovery (`[retry]` + `[switch to primary's web search]`). Others keep streaming.

Server-level errors:
- Polymarket Gamma down → market header from cache + banner: "polymarket data is stale"
- Provider 401 → top toast: "your anthropic key looks expired · [open settings]"
- All providers fail → fall back to last-cached + banner: "all providers unreachable"

### 6.4 Mobile fallback

Single column, vertical stack. No rails. Tap-and-scroll. Hamburger drawer for nav (markets / watchlist / positions / settings). View-only — no compare mode, no tweaks panel. Setup IS mobile-friendly so users can configure on phone before desktop session.

### 6.5 Per-device persisted UI state

Last-viewed market · sidebar collapse · right rail tab selection · position sort order · tweaks panel visibility · theme · density. All localStorage.

---

## 7 · API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | service + provider + feeds |
| GET | `/api/events?category=&limit=&mode=` | event list (event-centric, outcomes nested) |
| GET | `/api/markets-list?category=&limit=` | legacy flat list, back-compat |
| GET | `/api/brief?marketId=` | SSE stream of agent events ending in `brief:complete` |
| POST | `/api/ask` | SSE stream of `ask:*` events; body `{market, question}` |
| GET | `/api/event-stream?marketId=` | SSE replay of cached events for a market |
| GET | `/api/profile/{handle}` | resolve Polymarket username → 0x wallet |
| GET | `/api/positions?wallet=` | proxied Polymarket Data API; per-wallet 60s cache |
| POST | `/api/auth/test` | validate provider key with one round-trip |
| GET | `/api/watchlist?googleId=` | sync mode only, v0.2 |
| POST | `/api/watchlist` | sync mode only, v0.2 |
| POST | `/api/admin/flush` | clear all caches (admin token gated) |

Polymarket endpoints proxied (CORS):
- Profile: `polymarket.com/api/profiles/{handle}`
- Positions: `data-api.polymarket.com/positions?user=&limit=100`
- Gamma + CLOB: existing pm-copilot client carries over

---

## 8 · Production readiness

### 8.1 Repo hygiene
README, LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY, CHANGELOG (semver via changesets), ROADMAP, ISSUE_TEMPLATE, PULL_REQUEST_TEMPLATE, CODEOWNERS, dependabot.yml.

### 8.2 CI/CD
- `ci.yml` — typecheck → lint → tests → build, blocks PR merge
- `secrets-scan.yml` — gitleaks
- `release.yml` — manual trigger; publish core to npm + skill bundle to GitHub Releases
- `deploy-demo.yml` — push to main re-records demo briefs and redeploys to Vercel

### 8.3 Code quality
TypeScript strict everywhere; zero `any` in `packages/core`. ESLint with `@typescript-eslint/strict` + `react-hooks` + `jsx-a11y`. Prettier. Husky + lint-staged pre-commit.

### 8.4 Test coverage
- Vitest, 70%+ coverage on `packages/core`
- Tests: supervisor fan-out, citation-ID allowlist, fallback claim shape, provider factory routing, MCP registry loader, cache TTL, position fetch path
- Playwright: 3-test E2E smoke (load home → click market → see brief stream → click pill → flash)
- Visual regression: Playwright snapshots vs design bundle for 9 priority states; > 0.5% diff fails CI

### 8.5 Security
- API keys in IndexedDB (AES-GCM, Web Crypto, per-install session secret); never sent to our server except as proxy header
- Server-side: keys redacted from logs (`pino-noir`)
- HTTPS-only for hosted; HSTS 1yr; CSP `default-src 'self'`
- gitleaks in CI
- npm audit in CI; high-severity blocks merge
- Lockfile committed (`pnpm-lock.yaml`)

### 8.6 Performance budgets
- Initial JS bundle gzipped < 180KB
- Lighthouse Performance > 90, Accessibility > 95
- FCP < 1.2s, CLS = 0
- Brief cache hit P95 < 600ms
- Fresh brief first content P95 < 2.5s

### 8.7 Accessibility (WCAG 2.1 AA)
- Keyboard nav for everything; focus indicators (cyan ring 2px) visible in dark theme
- `aria-label` on icon-only buttons; `aria-live="polite"` on streaming brief panels
- Color contrast text-on-bg ≥ 7:1 (AAA where feasible)
- `prefers-reduced-motion`: citation flash collapses to 1-frame highlight
- Cmd+/ opens visible keyboard cheat sheet

### 8.8 Distribution channels
- Demo: `demo.pm-copilot.dev` (Vercel, static)
- GitHub repo: `github.com/{owner}/pm-copilot`
- Claude skill: GitHub Releases `.zip` + `@pm-copilot/skill` on npm
- Docker image: `ghcr.io/{owner}/pm-copilot:0.1.0`
- One-click deploy: Vercel + Render + Codespaces buttons in README

### 8.9 Documentation
`architecture.md`, `adding-a-venue.md`, `adding-an-mcp.md`, `api.md`, `design-system.md`, `voice.md`. All committed at v0.1.0.

### 8.10 Observability
Structured logging via `pino`, per-request request-id. Optional Sentry (commented in `.env.example`). `/api/admin/metrics` endpoint shows cache stats / agent latencies / error rates (admin token gated). NO phoning-home telemetry.

### 8.11 Community
GitHub Discussions enabled (`Q&A`, `Show and tell`, `Ideas`). `good first issue` + `help wanted` labels seeded with 5-10 items. README badge: "Show HN: pm-copilot."

### 8.12 Deferred to v0.2+
Google sign-in for cross-device sync · backtesting harness · calibration tracking (Brier scores) · Telegram/Discord webhook · browser extension overlay · Solana PM coverage · Kalshi adapter (real, not stub) · Hyperliquid Predict adapter.

Tracked in `ROADMAP.md` with quarter targets.

---

## 9 · User flows

### 9.1 Setup (first-time)
1. Land on `/` → no provider configured → forced redirect to `/setup`
2. Setup screen: Path A (Claude Code auto-detect, zero-touch) OR Path B (provider picker)
3. Path B: pick provider → opens that provider's console deep-link → user creates key, pastes → live test → saved to IndexedDB encrypted
4. Optional Tier 2: prompt to add Perplexity (News) and xAI (Sentiment) — both skippable
5. Redirect to `/`

### 9.2 First market (after setup)
1. Empty state with paste-URL + recent grid + 4 sample markets
2. User clicks a sample → URL → `/m/{marketId}`
3. Brief streams: market header instant → first agent panel < 2s → full brief 45-90s
4. Citation pills clickable from the moment they appear
5. Bottom-rail toast: "tip — paste your wallet to see your positions"

### 9.3 Returning trader (wallet configured)
1. Land on `/` → right rail Positions tab pre-populated (server cache)
2. Click a position → `/m/{positionMarketId}` → brief renders instantly (cache hit)
3. Position Context Strip auto-renders above Verdict band
4. User reads evidence, decides next step, exits to Polymarket native to execute

### 9.4 Watchlist (no wallet, tracks markets)
1. Hover event in left rail → star icon → adds to watchlist
2. Right rail Watchlist tab shows it with ∆ since added
3. Returns next day; deltas red/green vs last-viewed price
4. Resolved markets read-only with would-be-P&L

### 9.5 Power user (keyboard-first)
1. ⌘K → command palette → type "fed cuts" → enter
2. ⌘D → compare mode opens with next watchlist market in right pane
3. ⌘1 → zooms book panel to fill workbench
4. Citation pill click → another panel's row flashes
5. ⌘P → pins chat answer to verdict band

---

## 10 · Visual / design tokens (locked, from claude-design bundle)

```
/* color */
--bg:             #0A0B10
--surface:        #12141C
--panel:          #1A1D28
--border:         #262A38
--border-strong:  #3A3F52
--text:           #E6E8EE
--text-muted:     #8892A6
--accent:         #0A66FF   /* design tool's choice; was purple in v0 */
--accent-hover:   #0047CC
--citation:       #22D3EE   /* signature */
--success:        #10B981   /* YES */
--danger:         #EF4444   /* NO */
--warning:        #F59E0B

/* type */
--font-prose:  'IBM Plex Sans', system-ui, sans-serif
--font-mono:   'IBM Plex Mono', ui-monospace, monospace
--fs-base:     14px
--fs-price:    24px

/* shape */
--radius:      4px         /* squared terminal feel */
--border-w:    1px

/* layout */
--rail-left:   320px
--rail-right:  280px
--header-h:    48px

/* motion */
--t-fast:      80ms
--t-flash:     800ms        /* the citation flash */
```

Citation flash keyframe + agent pulse keyframe are reused verbatim from `colors_and_type.css` in the bundle.

---

## 11 · Implementation phases (with beta cut)

The original 10-day plan ships v0.1.0-public-ready. For private beta we cut polish — see Section 16 for the diff. Beta target: **~6 working days**.

| Phase | Scope (full) | Full | Beta | Notes |
|---|---|---|---|---|
| 1 · Repo init | monorepo scaffold, CI, lint/format, dependabot, license, README + CONTRIBUTING + CoC + SECURITY | 0.5d | 0.25d | Beta: skip CONTRIBUTING / CoC / SECURITY / issue templates |
| 2 · Backend port | Carry over from `pm-copilot/`: agents, providers, MCP registry, Polymarket client, supervisor, briefStore, server routes | 1d | 1d | Must work end-to-end |
| 3 · UI rebuild | LeftRail, MarketHeader, EvidenceGrid (2×2 + News tabs), VerdictBand, Chat, RightRail (3 tabs), CommandPalette, States | 2-3d | 1.5d | Beta: drop Compare mode + Mobile fallback; RightRail = Positions + Watchlist only (no Recent tab) |
| 4 · Setup flow | Setup screen, provider picker (4-way), key paste + live test, IndexedDB encrypted storage | 1d | 0.5d | Beta: Anthropic + Claude Code auto-detect only in UI picker; OpenAI/Gemini/Perplexity wired via env-var only |
| 5 · Positions + watchlist | `/api/positions`, `/api/profile`, position context strip, watchlist localStorage + Cmd+B | 1d | 1d | Must work — user explicitly asked for this |
| 6 · Sentiment agent (NEW) | xAI provider, sentiment.ts agent, News panel Sentiment tab | 1d | 1d | The differentiator vs every other PM tool |
| 7 · States polish | Loading layers, per-panel errors, mobile fallback, URL routing, browser back | 1d | 0.5d | Beta: empty + loading + per-panel error only; defer mobile + browser-back niceties |
| 8 · Demo build | record-demo script, static demo Vite config, demo.pm-copilot.dev deploy | 0.5d | **0d** | DROP for beta |
| 9 · Tests | Vitest unit + Playwright E2E + Lighthouse + a11y audit | 1d | 0.25d | Beta: smoke test only (boot → click → see brief) |
| 10 · Production readiness | docs, contributor templates, security policy, deploy buttons, Docker image | 1d | 0.25d | Beta: LICENSE + minimal README + hosted Vercel deploy |
| **TOTAL** | | **~10d** | **~6d** | 4 days saved by beta cut |

---

## 12 · Verification plan (end-to-end)

After implementation, before merging to `main` for v0.1.0:

1. **Functional:** Click any market → brief streams in < 2s first content, < 90s full. Click citation pill → flash. Position strip renders for any wallet's position. ⌘K palette works. ⌘D compare opens. ⌘1-4 panel zoom works. URL deep-link survives refresh.
2. **Setup:** New install with no provider → forced to `/setup`. BYOK flow completes in < 60s. Bad key → live test fails, clear error message. Auto-detect Claude Code works on a machine with `claude` installed.
3. **Performance:** `pnpm run lighthouse` → all budgets pass. `pnpm run bundle-size` → < 180KB. Brief cache hit P95 < 600ms (measured against a hot cache of 50 markets).
4. **Tests:** `pnpm test` → all pass, ≥70% coverage on core. `pnpm e2e` → 3-test smoke green.
5. **Visual regression:** Playwright vs design bundle screenshots → ≤ 0.5% diff per state.
6. **Security:** `gitleaks` clean. `npm audit` no high-severity. CSP report-only mode shows no violations on demo deploy.
7. **Accessibility:** Keyboard-only navigation completes all flows. Screen reader (NVDA) announces brief streaming events. Color contrast ≥ 7:1 verified across all panels.
8. **Distribution:** Vercel one-click deploy works. Codespaces config boots cleanly. Docker image runs locally with one env var.

---

## 13 · Out of scope (explicit)

- Live order execution / wallet integration (read-only by design)
- Hosted SaaS with shared API budget (no free tier)
- Mobile-native apps (web-only; mobile fallback is view-only)
- Vector DB / long-term memory (every brief is fresh-fetch)
- Telemetry / analytics phoning home to the project owner
- Real-time price WebSocket on every panel (only the Book panel's live tick uses WS; other panels poll on event)
- Authentication for self-hosted instances (treat localhost as trusted; enterprise auth deferred)

---

## 14 · Self-review notes (post-write)

Reviewed for placeholders, contradictions, ambiguity, scope:

- **Placeholders:** None remaining. All "TBD" / "TODO" resolved.
- **Internal consistency:** Section 3 (setup) + Section 9.1 (setup flow) reference the same `/setup` route + Path A/B model. Section 5.3 (right rail tabs) + Section 9.3 (returning trader) reference the same Position Context Strip. Visual tokens in Section 10 match the bundle's `colors_and_type.css`.
- **Scope:** Single implementation plan target. ~10 working days. Decomposable into 10 phases. v0.2 deferred items explicit. Not too large for one spec.
- **Ambiguity:** Per-agent provider routing (Section 3.3) explicit per agent. Persistence (Section 5.5) explicit per data type. Position context strip behavior (Section 5.4) explicit ("descriptive only, no exit calls"). State transitions (Section 6) explicit per state.

Spec is ready for user review.

---

## 16 · Beta scope cut (v0.1.0-beta)

Approved 2026-04-29 to ship faster. Two release tracks:

- **v0.1.0-beta** — private, hand-picked users, hosted single instance, ~6 working days
- **v0.1.0-public** — open repo, demo site, deploy buttons, full polish, ~4 more days after beta lands

### 16.1 What ships in beta (must-have)

- Setup flow: **Anthropic Claude Code auto-detect + manual API key paste**. (OpenAI/Gemini/Perplexity wired under the hood as env-var providers; not exposed in setup picker UI.)
- Workbench layout: LeftRail + 2×2 EvidenceGrid + VerdictBand + Chat + RightRail (Positions + Watchlist tabs only — no Recent tab)
- Citation flash UX (the signature interaction)
- Position context strip above Verdict band (auto-renders when loaded market matches a wallet position)
- **Sentiment agent (xAI required)** — the differentiator vs every other PM tool in the corpus
- Polymarket Gamma + CLOB + Data integration (port from `pm-copilot/`)
- URL deep-link `/m/{outcomeMarketId}` (refresh resumes)
- Dark theme default
- BYOK encrypted IndexedDB storage
- Position fetch via username or wallet (Polymarket profile API resolves either)
- ⌘K command palette (cheap + high-value)
- Empty / loading / per-panel error states

### 16.2 What's cut from beta (lands in v0.1.0-public)

| Cut | Reason |
|---|---|
| Demo site (`demo.pm-copilot.dev` + record-demo script) | Beta users get the real product |
| One-click deploy buttons (Vercel / Render / Codespaces) | You provision access manually for beta |
| Docker image + ghcr.io publish | Same |
| Compare mode (⌘D + `/compare/{a}-{b}` route) | Cool but not core to research-desk job |
| Mobile fallback (drawer + single-column) | Desktop-first beta |
| Browser-back niceties | Refresh works, that's enough |
| Visual regression Playwright suite | Design is iterating — would just churn |
| Lighthouse CI gate | Spot-check manually |
| 70% test coverage on `packages/core` | Beta replaces with: smoke test + happy-path manual QA |
| Accessibility full WCAG audit | Basic keyboard nav only; full audit at public |
| GitHub Discussions + issue templates + CODEOWNERS | Private repo; users ping you direct |
| Skill bundle published to npm | Ship as `.zip` in repo for now |
| Recent tab in right rail | Positions + Watchlist is enough |
| Settings modal — MCP registry table UI | Just `mcp.config.json` file editing |
| 4-provider setup picker UI | Anthropic + Claude Code auto-detect only; rest via env var |

### 16.3 Beta distribution: hosted single instance

You deploy `apps/server` + `apps/web` to your own Vercel project. Beta users get a URL: `pm-copilot.{your-domain}`.

**They paste their OWN provider key in the browser.** Encrypted to IndexedDB. The server proxies LLM calls using that key from a request header — never logged, never persisted server-side. Cost to you: $0 LLM (their keys), Vercel free tier covers compute.

This means the auth model for beta is slightly different from self-host:
- Self-host (eventual): server reads key from env, also accepts request-header override
- Hosted beta: server requires request-header for every LLM-bound endpoint, returns 401 if missing

`apps/server/src/middleware/byokHeader.ts` handles this — extracts `x-anthropic-key` (or whichever provider) from request, populates request-scoped provider config, never persists.

### 16.4 Ramp-up path beta → public

Each cut item from §16.2 is a discrete PR shippable during beta-feedback weeks. By the time you flip the repo public, polish is in. Suggested order:

1. **Week 1 of beta**: Recent tab + 4-provider setup picker UI (low risk; addressable beta feedback)
2. **Week 2**: Compare mode + browser-back niceties
3. **Week 3**: Demo site + record-demo script (`demo.pm-copilot.dev` live)
4. **Week 4**: Docker image + one-click deploy buttons + skill on npm
5. **Week 5**: Mobile fallback + accessibility audit + Lighthouse CI
6. **Week 6**: Tests + GitHub Discussions + ISSUE_TEMPLATE seeded + flip repo to public

Public launch tweet drops at end of week 6, ~6 weeks after beta starts.

---

## 15 · References

- Claude Design bundle: snapshot at `design-bundle/` in target repo
- Existing pm-copilot: `C:/Users/ayush/Downloads/pm kols/pm-copilot/` (carry over backend; do not modify)
- PRD v2: `[[Kairos-PM-PRD-v2]]` (predecessor doc; superseded by this spec for the new repo)
- Voice guide: `[[PM-Voice-Guide]]` (used to constrain copy in the UI)
- Outreach targets: `[[Outreach-Targets]]` (KOL list seeds the Sentiment agent's curated source set)
- Architecture corpus: `[[architecture-corpus-summary]]` (15 architectural takeaways inform feature choice)
