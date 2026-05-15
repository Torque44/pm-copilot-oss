# Pm-copilot

> Open-source grounded research desk for prediction-market traders.
> Multi-venue, multi-LLM, MCP-pluggable.

**Status:** v0.1.0-beta · live at [pmcopilot.wtf](https://pmcopilot.wtf) (Azure Container Apps) · BYOK by default

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

Requires Node 20+ and `pnpm` 9+ (`npm i -g pnpm`).

```bash
git clone https://github.com/Torque44/pm-copilot-oss
cd pm-copilot-oss
pnpm install
pnpm dev
```

Web at <http://localhost:5173>, server at <http://localhost:8787>.

The first time you load the web app, the **setup screen** appears with one
tile per provider. Pick **Use local Claude Code** (zero-config if `claude`
is on your PATH) or paste an Anthropic / OpenAI / Gemini / xAI / Perplexity
key. Keys live encrypted in IndexedDB only — never logged server-side, never
sent anywhere except as per-request `x-llm-key` headers.

You can skip the browser setup entirely and put keys in `.env` instead:

```bash
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
pnpm dev
```

### Running this with Claude Code or ChatGPT (cold-clone agent flow)

If you hand this repo to an LLM coding agent (Claude Code, Cursor, Codex,
Copilot CLI), the workflow is:

```bash
git clone https://github.com/Torque44/pm-copilot-oss
cd pm-copilot-oss
pnpm install
pnpm typecheck   # confirms the workspace compiles cleanly
pnpm dev         # boots web + server
```

That's the contract. No env files needed unless the agent wants to bake a
provider key in. The agent can talk to the running server at
<http://localhost:8787> (`/api/health/providers`, `/api/events`,
`/api/brief?marketId=…`, `/api/ask`). All endpoints return JSON;
`/api/brief` streams as NDJSON (one JSON envelope per line) so the
workbench can paint each agent's output as it lands.

## Deploy

The production deploy at [pmcopilot.wtf](https://pmcopilot.wtf) runs on
**Azure Container Apps**. The api and the React bundle are served from
the same origin (no CORS, no two-host split). End-to-end auto-deploys
from `main` via GitHub Actions OIDC + Azure Container Registry cloud
build — see [`.github/workflows/azure-deploy.yml`](.github/workflows/azure-deploy.yml)
and [`docs/AZURE_DEPLOY.md`](docs/AZURE_DEPLOY.md) for the workflow shape
and one-time setup (federated identity, ACR, container app, health
probe).

By default the deploy is BYOK — users paste their own provider keys in
the browser setup tile and they live encrypted in IndexedDB (non-
extractable AES-GCM master key, see [Privacy & safety](#privacy--safety)).
To run as a single-tenant self-host with shared keys, set the relevant
`*_API_KEY` env vars on the container app revision (Azure portal or
`az containerapp update --set-env-vars`).

### Render (alternative)

`render.yaml` ships an equivalent single-service blueprint:

1. Sign up at <https://render.com>, connect GitHub, **New +** → **Blueprint**.
2. Render reads `render.yaml` and gives you `https://pm-copilot.onrender.com`.

Free tier spins down after 15 minutes idle (~20–30s cold start);
Starter at $7/mo keeps it warm.

**Other platforms.** Fly.io, Railway, or a plain VPS work too —
anywhere Node 20+ runs and `PORT` + `CACHE_DIR` env vars are respected.
Build: `pnpm install && pnpm -r build`. Start: `pnpm -F @pm-copilot/server start`.

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
- **Exa-backed news fallback** — when the news provider has no native web
  search (OpenAI, Anthropic via API, Gemini), the news agent fans out
  through Exa AI for real catalysts instead of hallucinating from training
  data; results pass the same denylist + per-category allowlist as the
  Perplexity / xAI live-search path
- **Non-extractable BYOK vault** — v2 storage uses a Web Crypto AES-GCM
  key with `extractable: false` held in IndexedDB; XSS can encrypt/decrypt
  during an active session but cannot exfiltrate the raw key bytes.
  One-shot migration from the v1 PBKDF2 seed runs automatically on first
  access
- **Abuse rate limits** — per-IP sliding-window caps on `/api/ask` (30/h),
  `/api/brief` (30/h), and `/api/auth/test` (10/min) keep the public demo
  from getting drained; `/api/admin/flush` is gated behind `ADMIN_TOKEN`
- **Unverified-source flagging** — news items synthesized from a model's
  training data (no live URL) are tagged `unverified` in the panel so
  traders never mistake a hallucinated catalyst for a real one

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
┌─────────────┐  NDJSON  ┌─────────────┐
│  apps/web   │◄─────────│ apps/server │
│  React 19   │   POST   │  Express    │
└─────────────┘─────────►└─────────────┘
                              │
                              ▼
                       packages/core
                       ┌──────────────────────────────────────────┐
                       │ supervisor                               │
                       │                                          │
                       │ wave 1 (parallel specialists):           │
                       │   ├ market        ◄ Polymarket CLOB      │
                       │   ├ holders       ◄ Polymarket Data API  │
                       │   ├ news          ◄ Perplexity / xAI     │
                       │   │                 live_search, OR Exa  │
                       │   │                 search → provider    │
                       │   ├ comparables   ◄ Polymarket Gamma     │
                       │   │                 (resolved markets)   │
                       │   └ sentiment     ◄ xAI live_search      │
                       │                     (optional)           │
                       │                                          │
                       │ wave 2 (parallel, after wave 1):         │
                       │   ├ thesis        ◄ reasoning-tier LLM   │
                       │   └ synthesis     ◄ citation-ID allowlist│
                       └──────────────────────────────────────────┘
```

Cache is on-disk JSON snapshots; restarts rehydrate instantly. NDJSON
streams each agent's output as soon as it lands so the workbench paints
incrementally. The wave-2 split shaved ~5s off cold-load wall-clock by
running thesis and synthesis concurrently rather than sequentially.

## Repo layout

```
pm-copilot-oss/
├── apps/
│   ├── web/                  # React 19 + Vite + TypeScript strict
│   └── server/               # Express + NDJSON streaming + per-request BYOK middleware
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
├── docs/
│   ├── specs/                # design docs
│   ├── superpowers/          # session specs + implementation plans
│   │   ├── specs/
│   │   └── plans/
│   ├── AZURE_DEPLOY.md       # Azure Container Apps deploy walkthrough
│   └── HANDOFF.md            # original v1 task list (historical)
└── .github/workflows/        # CI + azure-deploy + cf-cache-purge
```

## Common dev tasks

```bash
pnpm dev          # boots web (5173) + server (8787) with HMR
pnpm typecheck    # strict TS across all 3 packages
pnpm lint         # eslint (flat config)
pnpm format       # prettier --write
pnpm test         # vitest run
pnpm smoke        # api smoke test (boots server, hits health + brief)
pnpm build        # production bundles

# inspect the brief stream for a market id (NDJSON — one envelope per line)
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

- **Hosted deploy at `pmcopilot.wtf`** stores the pasted wallet address
  (optional), optional X handle, structured usage events (visits, brief
  requests, market views), and the text of questions asked to the chat
  agent (90-day retention, 4,000-char cap). **No agent responses, no IPs,
  no provider keys are stored.** Full disclosure in
  [`docs/PRIVACY.md`](docs/PRIVACY.md). This applies only to the hosted
  deploy — local installs (`pnpm dev`) collect nothing.
- BYOK keys never touch disk. They live encrypted in IndexedDB and travel
  only as per-request HTTP headers.
- The agent pipeline is read-only — no order submission, no fund movement.
- Wikipedia and other user-editable sources are blocked from citation by
  default (see `sources/registry.ts`); items from non-allowlisted but
  non-banned domains are flagged `unverified` in the UI.

## Status vs the v1 plan

The original `docs/HANDOFF.md` defined 11 tasks (A–K) for the first beta. As of
this commit:

- Tasks A–F (backend port, providers, supervisor, UI rebuild, hooks, lib) — **done**
- Tasks G–H (setup flow, positions wiring) — **done**
- Task I (sentiment tab UI) — **done + extended** (vetted handle list per category)
- Task J (smoke test) — **done** (scripted via `pnpm smoke` and gated in CI)
- Task K (hosted public deploy) — **done** via Azure Container Apps
  (auto-deploy from `main` via GitHub OIDC + ACR; live at
  [pmcopilot.wtf](https://pmcopilot.wtf))

Beyond the original plan, this build adds: source-curation registry,
resolved-market comparables with synonym-aware matching, multi-outcome
tabs, Polymarket-native tag navigation, drag-resizable workbench split,
provider-health probe with subprocess-tolerance, tile-grid setup screen,
Exa-backed news fallback, v2 non-extractable BYOK vault, per-IP abuse
rate limits, prompt-injection sanitizer on market titles, and a
training-data `unverified` flag in the news panel.

## License

MIT. See [LICENSE](./LICENSE).

## Credits

Built by [@0xayushya](https://x.com/0xayushya). Issues and PRs welcome.
