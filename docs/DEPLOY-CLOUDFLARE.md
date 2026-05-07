# Deploying pm-copilot to Cloudflare

Short answer: **possible but non-trivial**. The frontend ports cleanly. The
backend doesn't run as-is on Cloudflare Workers because we use Express +
`tsx` + a filesystem cache + long-lived SSE connections. Three honest paths
below, ranked by effort.

## Yes, there is a backend you have to deploy

`apps/server/` is real Node code that has to run somewhere. The frontend
calls these endpoints over HTTP (and SSE):

- `GET /api/health/providers` — provider liveness
- `GET /api/events` — list of Polymarket events for the left rail
- `GET /api/event` — single event
- `GET /api/markets` — single market
- `GET /api/resolve` — Polymarket URL → marketId
- `GET /api/positions?wallet=…` — user positions
- `GET /api/brief?marketId=…` — **SSE** stream of agent fan-out
- `POST /api/ask` — **SSE** stream of chat answer
- `POST /api/auth/test` — BYOK key liveness check

All except the auth-test path are read-only and don't store user data
server-side, but they all need a Node-compatible runtime, an HTTPS
endpoint, and 60–150s timeout headroom for the SSE streams.

## Path A — Cloudflare Pages (frontend) + keep Render (backend)

**Effort: 30 minutes. Lowest risk.**

Move only the static `apps/web/dist` to Cloudflare Pages, keep the existing
Render service for the backend, and tell the frontend to call the Render
URL. Cloudflare gives you the cache + DDoS edge, Render runs the Node
server.

Steps:

1. Create a Pages project pointing at this repo.
2. Build command: `pnpm install --frozen-lockfile && pnpm -F @pm-copilot/web build`
3. Output dir: `apps/web/dist`
4. Add environment variable: `VITE_API_BASE=https://pm-copilot.onrender.com`
5. In `apps/web/src/lib/client.ts`, change relative `/api` paths to use
   `import.meta.env.VITE_API_BASE` when set (~10 lines of change).
6. Set CORS in the Render service env: `CORS_ORIGIN=https://your-pages-app.pages.dev`.

You lose the same-origin advantage and gain a CORS round-trip on every
request, but you get Cloudflare's edge cache + analytics on the static
side. **This is the pragmatic answer if you want "Cloudflare" without
rewriting the server.**

## Path B — Cloudflare Workers (frontend + backend) via nodejs_compat

**Effort: 1–2 days. Medium risk.**

Cloudflare Workers added a Node compatibility layer (`nodejs_compat` flag
in `wrangler.toml`) that makes a chunk of Node's stdlib available — `fs`,
`crypto`, `path`, etc. The Express ecosystem mostly works, *with caveats*.

Things that break or need rewrites:

- **`tsx` runtime** — Workers don't run TS directly. You'd need an esbuild
  or Vite step that emits JS. Server's tsconfig already has `noEmit: true`
  for fast dev; you'd add a build profile that emits.
- **Filesystem cache** — `apps/server/src/persist.ts` writes
  `.cache/snapshot.json` to disk. Workers don't have a writable filesystem.
  Replace with **Cloudflare KV** for the snapshot, or **R2** for larger
  blobs. This is the single biggest porting cost.
- **Long-lived SSE** — Workers cap CPU time at 30s on the free tier,
  10ms wall clock per request unless you upgrade. SSE for a 90s `/api/ask`
  needs the **Workers Paid plan** (or **Durable Objects** which support
  WebSocket-style long connections via `state.acceptWebSocket` —
  significant rewrite).
- **`process.env`** — works under nodejs_compat, but Workers prefer
  `env.<NAME>` passed to the fetch handler. Mostly cosmetic.

This path gives you the "everything on Cloudflare" story but you're
rewriting the cache layer + adapting to Workers' request model.

## Path C — Cloudflare Pages Functions (lite serverless)

**Effort: 1 day. Medium risk. Best for low-traffic deployments.**

Pages Functions are a thin Workers wrapper bound to a Pages project.
Each `apps/web/functions/api/*.ts` file becomes a route. Same runtime
constraints as Workers (no fs, no SSE without Durable Objects), but
they auto-deploy with the frontend on push.

Suitable for:
- The non-streaming endpoints (`/api/events`, `/api/resolve`,
  `/api/positions`, `/api/auth/test`) — these are short fetch-and-return.
- Behind a Cloudflare AI Gateway for the LLM calls (see below).

Not suitable for:
- `/api/brief` and `/api/ask` SSE streams. Move those to a Durable Object
  or stick with Render for those two routes.

## Cloudflare AI Gateway — what it actually is

[AI Gateway](https://developers.cloudflare.com/ai-gateway/) is a **proxy
in front of LLM providers**, not a deploy target. You point your
`fetch('https://api.anthropic.com/...')` at
`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic/...`
and Cloudflare gives you:

- **Caching** (per-prompt, configurable TTL) — could be huge for
  duplicate brief requests on the same market within a window.
- **Rate limiting** per consumer key.
- **Observability** (full prompt + response logs in their dashboard).
- **Fallback** to a different provider if the primary fails.
- **Cost tracking** broken out by provider.

Wiring it up means changing the BASE URLs in `packages/core/src/providers/{anthropic,openai,google,perplexity,xai}.ts` — about 6 lines per provider, gated on an env var so dev runs against the real APIs and prod runs through the gateway. That part is **15 minutes of work** regardless of whether the rest of the app is on Cloudflare or Render.

## Cloudflare's "Agents" framework — different thing

[Agents](https://developers.cloudflare.com/agents/) is Cloudflare's
Durable-Objects-based framework for stateful, long-running LLM agents
(2024–2025 release). Each agent is a JS class that runs as a Durable
Object with persistent state and WebSocket support. It's interesting
for *building agentic systems on top of Cloudflare's edge*, but it's
not a deploy target for an existing Node + Express + SSE app — porting
would mean rewriting the supervisor + each of the 7 agents into the
Agents class shape. Not recommended for this codebase right now.

## Recommendation

**For "go live on Cloudflare" today: Path A.** Cloudflare Pages for the
frontend, keep the backend on Render (the existing `render.yaml` already
works). Add Cloudflare AI Gateway in front of the LLM providers for
caching + observability — that gets you most of the operational win
without a 2-day rewrite.

**For "fully on Cloudflare later":** Path B with KV-based cache and a
Durable Object hosting the SSE endpoints. Plan for a focused 1–2 day
porting sprint and a paid Workers plan ($5/mo) for the long-running
streams.

## Files that need changes for Path A

```
apps/web/src/lib/client.ts          + VITE_API_BASE handling
apps/web/.env.example               + VITE_API_BASE=...
.cloudflare/                        + new wrangler/pages config
apps/server/                        no changes — still runs on Render
```

If you want me to wire Path A end-to-end (web on Pages, AI Gateway in
front of LLM calls), open an issue or ping me and I'll do it as a
separate commit.
