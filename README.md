# pm-copilot

> Open-source grounded research desk for prediction-market traders.
> Multi-venue, multi-LLM, MCP-pluggable.

**Status:** v0.1.0-beta · works locally · public-launch ramp in progress

---

## Why this exists

Existing PM terminals graft a generic "AI research" surface on top of orderbook
data, and the LLM hallucinates because nothing is grounded. Ask a chatbot about
a BTC contract and you might get the shareholders of YES Network the TV channel.

`pm-copilot` fixes that at the architecture layer:

1. **Parallel-fetch BEFORE the LLM** — orderbook, holders, news, X sentiment,
   and resolved-comparable markets come from real APIs in parallel.
2. **Citation-ID allowlist AFTER** — the synthesis agent can only cite IDs that
   actually exist in the upstream evidence; anything else is dropped.
3. **Clickable rail in the UI** — every claim links to the source row that
   produced it, and the rail lights up when you click a claim's `[news·3]`
   citation.

It's read-only. We don't place orders.

## Quickstart

Requires Node 20+ and `pnpm` 9+.

```bash
git clone https://github.com/<you>/pm-copilot-oss
cd pm-copilot-oss
pnpm install
cp .env.example .env

# Pick ONE auth path:
#   (a) leave ANTHROPIC_API_KEY blank and have Claude Code installed locally
#       (`claude /login` once); the server uses subprocess auth for free
#   (b) paste an Anthropic / OpenAI / Gemini / xAI key in .env
#   (c) skip .env entirely and paste a key in the browser setup screen
#       (encrypted to IndexedDB, never logged server-side)

pnpm dev
```

Web at http://localhost:5173, server at http://localhost:8787.

The first time you load the web app, the **setup screen** appears with one
tile per provider. Pick claude code or paste an API key — the key is stored
encrypted in your browser only.

## What works today

- **Multi-agent supervisor** — market / holders / news / thesis / comparables /
  sentiment / synthesis / ask, fanned out in parallel with per-agent
  provider routing
- **BYOK** end-to-end — keys live in IndexedDB (AES-GCM), travel only as
  per-request headers, never persisted server-side
- **Citation grounding** — `[news·N]`, `[whale·N]`, `[book·N]`, `[comp·N]`,
  `[kol·N]` chips link to the rail row that produced the claim
- **Source curation** — Wikipedia and other user-editable sources are
  hard-banned at the agent level; news/sentiment cites only from a vetted
  per-category allowlist (see `packages/core/src/sources/registry.ts`)
- **Resolved-market base rates** — comparables agent finds historical
  resolved markets with similar shape (synonym-aware: "peace deal" matches
  "ceasefire") and surfaces a Bayesian anchor
- **Multi-outcome support** — for events like 2028 Dem nominee, the market
  panel offers an outcomes tab with click-to-switch between candidates
- **Polymarket tag taxonomy** — left rail tabs use Polymarket's real
  tag_slugs (politics, crypto, sports, geopolitics, tech, iran, middle-east,
  elections, pop culture, economy)

## Provider matrix

| Provider | Tier | Used for |
|----------|------|----------|
| Anthropic (Claude Code or API key) | primary | reasoning, brief, ask |
| OpenAI | primary | reasoning, brief, ask |
| Google Gemini | primary | reasoning, brief, ask |
| xAI Grok | primary OR sentiment-only | reasoning + sentiment, or sentiment alone |
| Perplexity Sonar | secondary | news enrichment |

You can mix-and-match: Claude as primary, Perplexity for news, xAI for sentiment.

## Architecture

```
┌─────────────┐   SSE   ┌─────────────┐
│  apps/web   │◄────────│ apps/server │
│  React 19   │   POST  │  Express    │
└─────────────┘────────►└─────────────┘
                              │
                              ▼
                       packages/core
                       ┌─────────────────┐
                       │ supervisor      │ ── fans out 7 agents
                       │ ├ market        │   ◄ Polymarket CLOB
                       │ ├ holders       │   ◄ Polymarket Data API
                       │ ├ news          │   ◄ web search via primary provider
                       │ ├ comparables   │   ◄ Polymarket Gamma (resolved)
                       │ ├ sentiment     │   ◄ xAI / Grok
                       │ ├ thesis        │   ◄ reasoning-tier LLM
                       │ └ synthesis     │   ◄ citation-ID allowlist
                       └─────────────────┘
```

Cache is on-disk JSON snapshots; restarts rehydrate instantly. SSE streams
each agent's output as soon as it lands so the workbench paints
incrementally.

## Repo layout

```
pm-copilot-oss/
├── apps/
│   ├── web/                  # React 19 + Vite + TypeScript strict
│   └── server/               # Express + SSE + per-request BYOK middleware
├── packages/
│   ├── core/                 # Agent kernel, providers, MCP registry
│   │   └── src/
│   │       ├── agents/       # market, holders, news, sentiment, thesis,
│   │       │                 #   comparables, synthesis, ask, supervisor
│   │       ├── providers/    # anthropic, openai, google, perplexity, xai, byok
│   │       ├── feeds/        # polymarket (Gamma + CLOB + Data)
│   │       ├── sources/      # curated per-category source allowlists
│   │       └── mcp/          # MCP registry + bundled feed loaders
│   └── skill/                # Claude Code skill bundle
├── docs/specs/               # design docs
├── HANDOFF.md                # original v1 task list
└── README.md                 # you are here
```

## Common dev tasks

```bash
pnpm dev          # boots web (5173) + server (8787) with HMR
pnpm typecheck    # strict TS across all 3 packages
pnpm lint         # eslint + prettier
pnpm build        # production bundles

# inspect the brief stream for a market id
curl -N "http://localhost:8787/api/brief?marketId=<id>"

# probe provider health (cached for 90s)
curl http://localhost:8787/api/health/providers
```

## Adding a new provider

1. Create `packages/core/src/providers/<name>.ts` exposing `make<Name>Provider(apiKey?: string): LLMProvider`. Implement `complete()` and a `capabilities` flag map.
2. Register in `packages/core/src/providers/index.ts`.
3. Add the slot routing in `byok.ts` (which agents use this provider).
4. Add a tile in `apps/web/src/components/SetupFlow/ProviderPicker.tsx`.

## Adding a new MCP data feed

1. Implement `packages/core/src/mcp/loaders/<feed>.ts` returning a feed
   descriptor with the scopes you serve (`book` / `holders` / `news` /
   `kol`).
2. Add to the registry in `packages/core/src/mcp/registry.ts`.
3. Configure activation in `mcp.config.json`.

The supervisor will route the relevant agent at request time.

## Privacy & safety

- No telemetry. The server logs request paths and elapsed times, never
  request bodies or LLM content.
- BYOK keys never touch disk. They live encrypted in IndexedDB and travel
  only as per-request HTTP headers.
- The agent pipeline is read-only — no order submission, no fund movement.
- Wikipedia and other user-editable sources are blocked from citation by
  default (see `sources/registry.ts`); items from non-allowlisted but
  non-banned domains are flagged `unverified` in the UI.

## Status vs the v1 plan

The original `HANDOFF.md` defined 11 tasks (A–K) for the first beta. As of
this commit:

- Tasks A–F (backend port, providers, supervisor, UI rebuild, hooks, lib) — **done**
- Tasks G–H (setup flow, positions wiring) — **done**
- Task I (sentiment tab UI) — **done + extended** (vetted handle list)
- Task J (smoke test) — **partial** (manual integration test, no scripted CI yet)
- Task K (hosted Vercel deploy) — **not yet**

Beyond the original plan, this build adds: source-curation registry,
resolved-market comparables with synonym-aware matching, multi-outcome
tabs, Polymarket-native tag navigation, drag-resizable workbench split,
provider-health probe with subprocess-tolerance, and a tile-grid setup
screen.

## License

MIT. See [LICENSE](./LICENSE).

## Credits

Built by [@0xayushya](https://x.com/0xayushya). Issues and PRs welcome.
