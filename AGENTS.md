# AGENTS.md — handoff for AI coding agents

This file is for any AI coding agent (Codex, Claude Code, Cursor, Copilot CLI,
Cline) picking up this repo cold. Read this first; it answers everything you'd
otherwise have to grep for.

## What this is

`pm-copilot-oss` is a citation-grounded research desk for prediction market
traders. Paste a Polymarket URL or pick from the events rail, and seven agents
fan out in parallel (orderbook depth, top holders, news with curated sources,
X sentiment via vetted handles, resolved-market comparables, causal thesis
tree, synthesis) to produce a brief where every claim cites the upstream
evidence row that produced it. Click any `[news-3]` style pill in the answer
to flash the source row in the rail. Read-only — no order placement.

The point of difference vs other "AI on prediction markets" tools is the
**citation-id allowlist**: the synthesis and ask agents can only cite IDs that
already exist in upstream agent output. The model literally cannot fabricate a
source. This is enforced in code (`packages/core/src/agents/synthesis.ts`,
`packages/core/src/agents/ask.ts`), not just by prompt.

Live deploy: <https://pm-copilot.onrender.com> (or whatever Render named the
service). Free tier — spins down after 15 min idle, ~30s cold-start.

## Stack

- **Monorepo**: pnpm 9 workspaces. Three packages.
- **`apps/web`** — React 19 + Vite 6 + TypeScript strict. Renders the
  workbench (left rail / evidence grid / chat / right rail), reads SSE from
  the server, persists chat history per-market in localStorage, encrypts BYOK
  keys in IndexedDB via Web Crypto AES-GCM.
- **`apps/server`** — Express 4 + SSE. Long-lived streaming connections for
  `/api/brief` and `/api/ask`. In production it also serves the React bundle
  from `apps/web/dist` so api + web share the origin (no CORS).
- **`packages/core`** — Agent kernel. Provider abstraction
  (Anthropic / OpenAI / Google / Perplexity / xAI / Claude-Code subprocess /
  stub), MCP feed registry (Polymarket Gamma + CLOB + Data), source allowlist
  registry, all 8 agents, citation utilities. Pure TS, no UI deps.
- **Node 20+, pnpm 9+**. Engines pinned in `package.json`.

## Run / build / deploy

```bash
pnpm install
pnpm dev          # web on :5173, api on :8787 (Vite proxies /api → :8787)
pnpm typecheck    # strict TS across all workspaces — must stay green
pnpm build        # production bundles
```

Deploy is one-click on Render via `render.yaml` (push to `main` triggers
auto-redeploy). Production server runs via `tsx` directly from source, no
emit step. Cache lives on a 1GB persistent disk at `/var/data/cache`.

## Architecture invariants — DO NOT BREAK

These are load-bearing. If your change crosses any of them, stop and ask the
human first.

1. **Citation-id allowlist.** Every agent emits structured `claims[]` with a
   `citations[]` array. Each citation id must exist in the upstream evidence
   that produced it (`book-1a`, `whale-3`, `news-7`, `kol-2`, `comp-4`,
   `price-history`). The synthesis + ask post-processing filter out any id
   the model invented (`packages/core/src/agents/synthesis.ts:142`, ask.ts
   citation registry). Don't bypass this for "convenience".
2. **Source curation.** Wikipedia, Wikimedia, Wiktionary, Reddit, Medium,
   Substack, Forbes contributors, and other user-editable or low-trust
   domains are hard-banned at `packages/core/src/sources/registry.ts`
   (`DENYLIST_DOMAINS` + `isDenylisted()`). Each market sub-category has
   its own allowlist of vetted sources for news/sentiment.
3. **BYOK end-to-end.** Keys live encrypted in IndexedDB (browser only),
   travel as per-request `x-llm-key` / `x-perplexity-key` / `x-xai-key`
   headers, get attached to provider calls via `byokHeader` middleware,
   and are never logged or persisted server-side. SSE endpoints (which
   can't send custom headers via EventSource) accept keys as query
   params instead — see `apps/web/src/lib/client.ts:buildBriefSSEUrl`.
4. **Read-only.** No order submission, no fund movement, no wallet
   signing flows. The Polymarket feeds are GET-only.
5. **Anti-hallucination at every agent boundary.** Sentiment runs through
   xAI Live Search restricted to vetted X handles; if live search fails,
   the agent emits a leading "live-search disabled, training data only"
   warning claim. Stub-tweet fallback also passes through
   `isAllowlistedHandle()`.

## Repo layout

```
apps/
  web/                React 19 + Vite. UI lives here.
    src/
      App.tsx         Top-level orchestration. Routes, keybinds, hooks.
      hooks/
        useBrief.ts   SSE reducer for /api/brief. Replayable.
        useAsk.ts     POST /api/ask + SSE. Chat history persisted per-market.
        useProvider.ts BYOK key store wrapper around cryptoStorage.
        useSSE.ts     Generic SSE hook with reconnect.
      components/     One folder per surface (LeftRail, RightRail, Chat,
                      EvidenceGrid, MarketHeader, SetupFlow, etc.).
      lib/
        client.ts     fetch wrapper that auto-attaches BYOK headers.
        cryptoStorage.ts AES-GCM wrap around IndexedDB for secrets.
        routing.ts    Route parser/builder. /m/:id, /setup, /event/:id.
      styles/         global.css (layout) + components.css (component-specific).
  server/             Express + SSE.
    src/
      index.ts        Bootstrap + routes + static-bundle serving in prod.
      middleware/byokHeader.ts  Reads BYOK headers/query, attaches to req.
      routes/         One file per endpoint.
      cache.ts + persist.ts     In-memory cache + disk snapshot.
      briefStore.ts   Per-market brief replay store (SSE event log).
packages/
  core/
    src/
      agents/         8 agents + supervisor + types.
      providers/      6 LLM providers + types + index. byok.ts routes
                      per-agent provider preferences.
      feeds/          polymarket.ts (Gamma + CLOB + Data), http.ts.
      sources/        registry.ts is the per-category source allowlist.
      mcp/            MCP feed registry + bundled loaders.
docs/
  specs/              Original design docs (historical).
  HANDOFF.md          v1 task list (mostly done; historical).
render.yaml           Deploy blueprint.
```

## Conventions

### Voice (UI copy + commit messages)

- Lowercase casual is fine for UI labels, monospace headers, button text
  (`market`, `holders`, `top 5 hold 78%`).
- **No em dashes.** Use commas, periods, colons, parens. The author of
  this repo dislikes em dashes specifically. (Yes, this is a real
  preference. Honor it.)
- Specific numbers beat adjectives. "Spread 1.0¢" not "tight spread".
- No motivational copy, no "we believe", no marketing voice. This is a
  trading desk, not a brand site.
- Commit messages: imperative summary line, body explains WHY not WHAT,
  end with the Co-Authored-By line if AI-assisted.

### Code

- TS strict everywhere. `tsc --noEmit` must stay green.
- Comments explain why a choice was made, not what the line does. The
  reader can read the code; they need the rationale.
- New files include a leading file-level comment (5-15 lines) explaining
  what the file is and why it exists. Look at any existing file for the
  shape.
- Prefer editing existing files over creating new ones. Don't add a new
  hook/component if there's a clean way to extend an existing one.
- No new dependencies without justification. The repo's dependency tree
  is intentionally small.
- React: hooks-only (no class components). Effects with proper cleanup.
  No useEffect hacks for derived state — use useMemo.
- CSS: prefer CSS variables in `tokens.css`; avoid inline styles unless
  the value is genuinely dynamic. Components-specific rules go in
  `components.css`, layout primitives in `global.css`.

### Don't

- Don't add em dashes.
- Don't add telemetry / analytics. The server logs request paths +
  elapsed times, never bodies or LLM content. Keep it that way.
- Don't bake provider keys into commits. BYOK is the default contract.
- Don't bypass the citation allowlist or the source denylist.
- Don't add long-form prose UI copy. Terse, factual, mono-friendly.

## What just shipped (recent commits)

- `aa47565` — ask agent salvages sectioned claims by regex when JSON
  parsing fails. The model can now break JSON syntax and the user
  still gets a structured answer.
- `fee2cde` — section-completeness enforcement. Every chat answer
  always renders all 6 sections (Numbers / Holders / Catalysts /
  Sentiment / Thesis YES / Thesis NO), with placeholder disclaimers
  when the model dropped any.
- `9c4eebe` — chat container switched from flex to grid layout so the
  history fills the chat box and short answers anchor to the input.
- `7d4f0a4` — chat layout fix + SYS prompt requires all 6 sections.
- `5626e96` — Render deploy config + same-origin production server.
- `35a7483` — sectioned chat answers shipped (Numbers / Holders /
  Catalysts / Sentiment / Thesis YES / Thesis NO with color-coded
  left bars, citation pills inline). Polymarket URL paste in search.
  Repo cleanup. README rewrite.
- `d342874` — fixed chat-history wipe-on-reload race (saved chat
  was being clobbered with `[]` on every page load).

## Open work / known issues

Pulled from a prior multi-agent audit. Most are SEV 3-4, none are
shipping blockers but each is a real bug.

### Reliability
- `useAsk.ts` has no AbortController. Cancel button is impossible and
  switching markets mid-stream writes the answer into the wrong
  localStorage entry. **High value, ~50 LOC.**
- `routes/brief.ts` and `routes/ask.ts` don't abort upstream agent
  fan-outs when the SSE client disconnects. Burns BYOK quota on dead
  requests. Wire `req.on('close')` → `AbortController.abort()`.
- xAI provider casts its name to `'perplexity'` for type compatibility
  (`packages/core/src/providers/xai.ts`); fix is to widen `ProviderName`
  to include `'xai'` and drop the cast. Cosmetic but mislabels logs.

### UX
- Routes `/event/:id` and `/settings` are declared in `routing.ts`
  but have no handler in App.tsx. Direct nav silently falls through
  to home. Add the branches or remove the variants.
- CommandPalette has no arrow-key navigation. Enter always picks
  `filtered[0]`. Wire `selectedIdx` state + ↑/↓.
- `usePositions` doesn't persist to localStorage; flashes empty on
  every reload until the network round-trip returns.

### Data correctness
- `packages/core/src/agents/holders.ts:97,127` — slice cap was bumped
  10 → 20 in the agent and loader. Verify the supervisor doesn't
  re-cap upstream of this.
- `useBrief.ts` — `holdersGroundingToRows()` drops `r.label`. Named
  Polymarket whales (e.g. "Theo4") render as `0xabcd…1234` instead of
  their label.

### OSS contributor friction
- No tests. Add at least a vitest harness with one citation-allowlist
  test for `synthesis.ts` so the central anti-hallucination contract
  has coverage.
- README and HANDOFF.md drift slightly. README claims things tests
  cover, but there are no tests yet.

## Philosophical notes

- The architecture diff vs other PM tools is "fan out → cite → synth"
  not "chat-with-LLM-and-pray". Every change should preserve that
  layering. If you find yourself making the synthesis or ask agent
  do its own search/fetch, stop — that work belongs in an upstream
  agent that emits citable evidence.
- The UI is information-dense by design. Don't add tooltips that
  duplicate visible data. Don't add pagination where users need
  scannability.
- The user is a trader making real-money decisions. Optimize for
  scan speed and fact density, not engagement.

## When you're done with a change

1. `pnpm typecheck` must pass across all three workspaces.
2. Commit with an imperative summary + body that explains WHY.
3. Push to `main` (Render auto-deploys).
4. If your change touches the citation allowlist, source denylist,
   or BYOK pipeline, flag it explicitly in the commit body so a
   reviewer can audit.
