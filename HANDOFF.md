# pm-copilot-oss · v0.1.0-beta · handoff

This repo was scaffolded 2026-04-29. The structure is in place; some port work
remains before the first `pnpm dev` boots cleanly. This doc lists every
remaining task in execution order.

Spec: `docs/specs/2026-04-29-pm-copilot-oss-design.md`

---

## What's already done

- ✅ Monorepo: `apps/web/`, `apps/server/`, `packages/core/`, `packages/skill/`
- ✅ Configs: pnpm workspace, TS strict base, ESLint + Prettier, .gitignore, .editorconfig, .env.example, mcp.config.example.json
- ✅ License: MIT
- ✅ README: minimal beta-shipped version
- ✅ GitHub Actions CI workflow at `.github/workflows/ci.yml`
- ✅ Design bundle copied to `design-bundle/` (UI source of truth)
- ✅ Spec doc copied to `docs/specs/`
- ✅ packages/core ported from `C:/Users/ayush/Downloads/pm kols/pm-copilot/`:
  - 8 agents (market, holders, news, supervisor, synthesis, ask, match, types)
  - 6 providers (anthropic, openai, google, perplexity, types, index)
  - mcp registry + 3 loaders (polymarket, kalshi-stub, external)
  - feeds: polymarket (Gamma+CLOB+Data), http helper, football
- ✅ NEW agents in packages/core/src/agents/:
  - `sentiment.ts` — xAI/Grok-driven KOL sentiment with `[kol·N]` citations
  - `thesis.ts` — causal sub-claim tree + kill-thesis pass
- ✅ NEW providers in packages/core/src/providers/:
  - `xai.ts` — Grok via OpenAI-compatible API at api.x.ai/v1
  - `byok.ts` — per-request agent routing from BYOK headers
- ✅ apps/server new routes:
  - `positions.ts` — GET `/api/positions?wallet=...` (proxies Polymarket Data API; 60s cache)
  - `profile.ts` — GET `/api/profile/:handle` (resolves Polymarket username → wallet)
  - `auth-test.ts` — POST `/api/auth/test` (validates a provider key with one round-trip)
  - `middleware/byokHeader.ts` — extracts BYOK headers, attaches to req
  - `index.ts` — bootstrap (with placeholders for the ported routes)
- ✅ apps/web Vite scaffold:
  - `index.html`, `main.tsx`, `App.tsx` (status-checking stub)
  - `vite.config.ts` with `/api` proxy → :8787
  - `styles/tokens.css` + `styles/global.css` copied verbatim from design bundle
  - `public/logo-mark.svg` + `logo-wordmark.svg`
- ✅ Initial scripts directory exists (`scripts/`)

## What's left, in order

### Task A — finish backend port (~3 hr)

These files exist in `C:/Users/ayush/Downloads/pm kols/pm-copilot/server/` and must be copied into `apps/server/src/` then have their imports adjusted.

1. **Copy server modules.** Run from a Bash shell:
   ```bash
   SRC="C:/Users/ayush/Downloads/pm kols/pm-copilot/server"
   DST="C:/Users/ayush/Downloads/pm-copilot-oss/apps/server/src"
   cp "$SRC"/{cache,briefStore,eventBus,groundingStore,persist}.ts "$DST/"
   cp "$SRC/routes"/{brief,ask,events,markets}.ts "$DST/routes/"
   ```

2. **Fix imports in copied files.** Search for `'../../agents/'` → replace with `'@pm-copilot/core/agents/'`. Search for `'../../lib/poly'` → replace with `'@pm-copilot/core/feeds/polymarket'`. Search for `'../../lib/sse'` → replace with `'@pm-copilot/core/sse'`.

3. **Wire ported routes in `apps/server/src/index.ts`.** Uncomment the `// import { briefHandler } …` block and the corresponding `app.get('/api/brief', briefHandler)` block. Same for the persistence boot section.

4. **Run `pnpm typecheck` from repo root.** Fix every error one-by-one. Common patterns:
   - `Cannot find module '../lib/llm'` → core deleted llm.ts shim; replace with `import { getProvider } from '../providers/index'`
   - `Cannot find name '...'` in agents → likely cross-references to `feeds/polymarket` (was `lib/poly`)
   - Provider files reference `process.env` — leave as-is; node types are present.

### Task B — provider factory adjustments (~30 min)

The `byok.ts` file calls `makeAnthropicProvider(key)`, `makeOpenAIProvider(key)`, etc. The original ported files likely export differently (probably a single `getProvider()` factory keyed off env var). Two options:

**Option 1 (recommended):** Add a `makeXxxProvider(apiKey?: string)` factory to each provider file alongside the existing exports. Each just constructs the same object the file already exports, but with the key bound from the argument.

**Option 2:** Refactor `byok.ts` to set env vars temporarily per request (NOT recommended — env-var mutation has subtle bugs in Node).

Go with Option 1. Pattern for `anthropic.ts`:
```ts
export function makeAnthropicProvider(apiKey?: string | null): LLMProvider {
  // existing factory body, but read `apiKey ?? process.env.ANTHROPIC_API_KEY`
  // instead of `process.env.ANTHROPIC_API_KEY` directly
  ...
}
```

Apply the same pattern to `openai.ts`, `google.ts`, `perplexity.ts`. Then `byok.ts` works as-is.

### Task C — supervisor extension for new agents (~1 hr)

The ported `packages/core/src/agents/supervisor.ts` only fans out market / holders / news / synthesis. Extend it to:

1. Run `runSentimentAgent` in parallel with the others IF `routing.sentiment` is non-null (xAI configured).
2. Run `runThesisAgent` AFTER the specialists complete, before synthesis. Pass it the merged citation set from upstream.
3. Pass the right `LLMProvider` to each agent based on `byokProvider()` routing — News uses `routing.news` (Perplexity if configured, else primary), everything else uses `routing.primary`.

The pattern: supervisor accepts an `AgentRouting` parameter (from `byokProvider(req.byok)`), passes it down. Each agent's signature becomes `runXxx(ctx, provider, input)`.

### Task D — UI rebuild (~6-8 hr)

This is the bulk of remaining work. Map design bundle JSX → TS React components.

For each component below: read the source from `design-bundle/research-desk/<File>.jsx`, port to `apps/web/src/components/<Component>/<Component>.tsx` with strict TypeScript types. Most are 50-150 lines.

In execution order:

1. **CitationPill** (`design-bundle/research-desk/EvidenceGrid.jsx` has the inline impl). 30 lines.
2. **MarketHeader** — `design-bundle/research-desk/MarketHeader.jsx`. 60 lines.
3. **LeftRail** + nested EventCard + OutcomeRow — `design-bundle/research-desk/LeftRail.jsx`. ~150 lines total.
4. **EvidenceGrid** + 4 panels (Book / Holders / News-with-tabs / Thesis) — `design-bundle/research-desk/EvidenceGrid.jsx`. 200 lines.
5. **VerdictBand** — `design-bundle/research-desk/VerdictBand.jsx`. 60 lines.
6. **Chat** (sticky bottom, collapsed-to-line). ~80 lines, derive from `index.html` App component's chat handling.
7. **RightRail** + PositionsTab + WatchlistTab + AgentDots — `design-bundle/research-desk/RightRail.jsx`. ~200 lines. **OMIT the Recent tab for beta.**
8. **CommandPalette** — `design-bundle/research-desk/CommandPalette.jsx`. 80 lines.
9. **States** (Empty, Loading, Error per panel) — `design-bundle/research-desk/States.jsx`. 130 lines. **OMIT Compare and Mobile for beta.**
10. **App.tsx** wiring — replace the scaffold stub with the real layout. Reference `design-bundle/research-desk/index.html` for the orchestration logic.

For each: keep the design's class names verbatim so `global.css` keeps working.

### Task E — hooks (~2 hr)

In `apps/web/src/hooks/`:

1. **useSSE.ts** — generic SSE subscription with reconnect-on-error. Pattern:
   ```ts
   export function useSSE<T>(url: string | null) {
     const [events, setEvents] = useState<T[]>([]);
     const [state, setState] = useState<'idle'|'open'|'closed'|'error'>('idle');
     useEffect(() => {
       if (!url) return;
       const es = new EventSource(url);
       es.onopen = () => setState('open');
       es.onmessage = (e) => setEvents(prev => [...prev, JSON.parse(e.data) as T]);
       es.onerror = () => setState('error');
       return () => { es.close(); setState('closed'); };
     }, [url]);
     return { events, state };
   }
   ```

2. **useBrief.ts** — wraps `useSSE` for `/api/brief?marketId=X`, shapes events into `{ market, agents, sections, brief }`. Reference `pm-copilot/src/hooks/useBrief.ts` for full impl.

3. **useEventsList.ts** — fetches `/api/events?category=X&limit=N&mode=contested`. ~30 lines.

4. **usePositions.ts** — fetches `/api/positions?wallet=X`, returns `{ positions, wallet, loading, error, refetch }`. 40 lines.

5. **useWatchlist.ts** — localStorage CRUD on a `Set<marketId>`, returns `{ list, add, remove, has }`. 50 lines.

6. **useProvider.ts** — IndexedDB get/set/clear of encrypted provider keys. Wrap `lib/cryptoStorage.ts`. 60 lines.

### Task F — lib/* (~2 hr)

In `apps/web/src/lib/`:

1. **client.ts** — `fetch` wrapper that auto-attaches BYOK headers from IndexedDB. ~80 lines.
2. **cryptoStorage.ts** — IndexedDB AES-GCM encryption. Browser Web Crypto API, derive key from `crypto.randomUUID()` saved to localStorage on first install. ~120 lines.
3. **citationFlash.ts** — port from `design-bundle/research-desk/scroll-rail.js` (the fade-edge + progress-rail + flash dispatcher). ~150 lines.
4. **routing.ts** — `useURLState` hook backed by `window.history.pushState`. Routes: `/`, `/m/:marketId`, `/setup`, `/settings`, `/event/:eventId`. ~80 lines.

### Task G — Setup flow (~3 hr)

In `apps/web/src/components/SetupFlow/`:

1. **SetupScreen.tsx** — renders the provider picker as the empty state when no key configured. Beta: 2 cards visible (Anthropic API key + Claude Code auto-detect). Other 3 providers (OpenAI/Gemini/Perplexity) deferred to public.
2. **ProviderPicker.tsx** — card per provider, click opens the deep-link in a new tab + reveals paste field.
3. **KeyTester.tsx** — paste field + auto-test button. Calls `/api/auth/test` with the key + provider. Shows live "✓ key works · sonnet 4.5 detected" or "✗ HTTP 401 · double-check key prefix".
4. **App.tsx routing** — if `useProvider()` returns no configured provider, force `/setup`. After success, redirect to `/`.

### Task H — positions wiring (~2 hr)

1. **PositionsTab.tsx** — wallet input at top, position cards below. Wallet input accepts username or 0x. On submit, call `/api/profile/:handle` to resolve, then `/api/positions?wallet=`.
2. **PositionStrip.tsx** — auto-renders above VerdictBand when `usePositions()` finds a match for the loaded marketId. Read-only, descriptive only.
3. **EventCard.tsx** — add a star icon, hover-revealed. Click toggles watchlist via `useWatchlist().add(eventOutcomeMarketId)`.
4. **Cmd+B keyboard handler** in App.tsx — adds currently-loaded market to watchlist.

### Task I — Sentiment tab UI (~1 hr)

In `EvidenceGrid/NewsPanel.tsx`:

1. Tab strip: `[catalysts] [sentiment] [resolution]`
2. Sentiment tab: greyed if `useProvider()` reports no xAI key. Otherwise renders `[kol·N]` citation cards from the brief stream's sentiment agent output.
3. Resolution tab: shows the UMA wording (currently a click-to-expand under MarketHeader; consolidate here).

### Task J — smoke test (~1 hr)

In `apps/server/scripts/smoke.ts`:

```ts
import { spawn } from 'node:child_process';
import http from 'node:http';

async function main() {
  const server = spawn('tsx', ['src/index.ts'], { env: { ...process.env, PROVIDER: 'stub', PORT: '8787' } });
  await new Promise((r) => setTimeout(r, 2000));
  const h = await fetch('http://localhost:8787/api/health').then((r) => r.json());
  if (!(h as { ok: boolean }).ok) throw new Error('health check failed');
  console.info('smoke: ok');
  server.kill();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

For real CI smoke, write a `stub` provider that returns canned text without hitting Anthropic. `packages/core/src/providers/stub.ts`. ~30 lines. Add to factory for `PROVIDER=stub`.

### Task K — hosted Vercel deploy (~30 min)

1. **Add `vercel.json` at repo root:**
   ```json
   {
     "buildCommand": "pnpm build",
     "outputDirectory": "apps/web/dist",
     "installCommand": "pnpm install",
     "framework": null,
     "rewrites": [
       { "source": "/api/:path*", "destination": "/api/:path*" }
     ]
   }
   ```

2. **Server-as-Vercel-functions:** since Vercel's free tier wants serverless functions, wrap `apps/server/src/index.ts` exports in `apps/server/api/[...path].ts`. Or deploy server separately to Render/Fly free tier and CORS-allow the Vercel origin. Recommended: **Render free tier for server, Vercel for web**, since SSE works better on a long-running Node process.

3. **Render config (`render.yaml`):**
   ```yaml
   services:
     - type: web
       name: pm-copilot-server
       env: node
       plan: free
       buildCommand: pnpm install && pnpm -F @pm-copilot/server build
       startCommand: pnpm -F @pm-copilot/server start
       envVars:
         - key: PORT
           value: 10000
         - key: CORS_ORIGIN
           value: https://pm-copilot.vercel.app
   ```

4. **Verify hosted instance** — open the Vercel URL, confirm `/api/health` reaches Render. End-to-end smoke: paste a key in setup, click a market, see brief stream.

---

## Time budget

| Task | Est | Notes |
|---|---|---|
| A · finish backend port | 3 hr | mostly mechanical copy + import-fix |
| B · provider factory adjustments | 0.5 hr | one pattern, 4 files |
| C · supervisor extension | 1 hr | thread routing parameter through |
| D · UI rebuild (10 components) | 6-8 hr | bulk of work; design bundle is the source of truth |
| E · hooks (6) | 2 hr | mostly small |
| F · lib/* (4) | 2 hr | crypto + routing + flash |
| G · setup flow | 3 hr | 4 components + routing gate |
| H · positions wiring | 2 hr | 3 components + 1 hotkey |
| I · sentiment tab | 1 hr | 1 component, mostly grey-state |
| J · smoke test | 1 hr | 1 script + 1 stub provider |
| K · hosted deploy | 0.5 hr | Vercel + Render config |
| **TOTAL** | **~22-24 hr** | ≈ 3 working days at full pace |

That's tighter than the spec's 6-day estimate, because the scaffold + core port + spec are already done. ~3 days of focused dev → first hosted beta URL.

## Cuts already locked in (per spec §16)

- No Compare mode (`/compare/{a}-{b}`)
- No Mobile fallback (drawer + single-column)
- No Recent tab in right rail
- No 4-provider setup picker UI (Anthropic only; rest via env-var)
- No demo site (`demo.pm-copilot.dev`)
- No Docker image / one-click deploy buttons
- No 70% test coverage; smoke test only
- No full WCAG audit; basic keyboard nav only
- No GitHub Discussions / issue templates / CODEOWNERS

These ship in the 6-week beta→public ramp per §16.4.

## Quick-start for tomorrow morning

```bash
cd C:/Users/ayush/Downloads/pm-copilot-oss
pnpm install
# Verify scaffold builds
pnpm typecheck    # will fail with import errors — see Task A
# Once Task A done:
pnpm dev          # boots web on :5173, server on :8787
# Open browser, verify the App.tsx scaffold shows "api connected"
# Then start Task B
```

Read the spec at `docs/specs/2026-04-29-pm-copilot-oss-design.md` if you need
the larger context. This handoff is the actionable list.
