# Railway deployment — design

## Context

The `cf-azure-rewrite` branch (already on origin) lands the SSE-removal +
frontend rewrite needed to decouple the app into a Cloudflare-Pages
frontend and a containerised backend. The original target was Azure
Container Apps. While trying to deploy that, we hit Azure CLI install
friction (PATH refresh issue, system-level install policy denial).
Railway offers the same shape (managed container host with persistent
volumes + child_process support) with materially less setup overhead:
one CLI install, one `railway login`, GitHub integration auto-deploys
on push.

This spec covers the deploy-target swap from Azure to Railway. All of
Phases 0–3 of the cf-azure-rewrite plan stay as-is — the SSE removal,
the synchronous JSON `/api/brief` and `/api/ask`, the frontend hook
rewrites, the 99-test baseline. None of that is Azure-specific.

## What changes

### Files added

| Path | Purpose |
|---|---|
| `railway.toml` | Railway service config: build via Dockerfile, healthcheck path, restart policy, single-replica, volume mount path. ~15 lines. |
| `docs/RAILWAY_DEPLOY.md` | Runbook: CLI install, login, GitHub integration setup, volume attach, env vars, the one-time `claude /login`, smoke commands. |

### Files modified

| Path | Change |
|---|---|
| `apps/server/Dockerfile` | Add a tiny entrypoint script that creates `/var/data/cache` and `/var/data/claude` if missing, symlinks `/root/.claude → /var/data/claude` so the anthropic-cc auth state lives on the Railway Volume. The CMD then runs `pnpm -F @pm-copilot/server start` as before. |
| `apps/server/.dockerignore` | Add `infra/azure/` so any leftover files don't bloat the build context (in case someone forgets to remove). |

### Files deleted

| Path | Why |
|---|---|
| `infra/azure/main.bicep` | Bicep template no longer used. |
| `infra/azure/deploy.sh` | Azure deploy wrapper no longer used. |
| `infra/azure/README.md` | Stale. |
| `docs/AZURE_DEPLOY.md` | Replaced by `docs/RAILWAY_DEPLOY.md`. |

### Files untouched (deliberately)

- All 99 baseline tests (`packages/core/src/sources/registry.test.ts`, `apps/server/src/cache.test.ts`, `apps/server/src/persist.test.ts`, `packages/core/src/agents/ask.test.ts`, `apps/web/src/lib/routing.test.ts`, `apps/web/src/hooks/useAuth.test.ts`)
- All seven agents in `packages/core/src/agents/`
- All providers including `anthropic` (subprocess path keeps working)
- Persistence stores (`cache.ts`, `briefStore.ts`, `groundingStore.ts`, `persist.ts`) — they read `CACHE_DIR` from env, Railway sets it to `/var/data/cache`
- Both rewritten routes (`apps/server/src/routes/brief.ts`, `apps/server/src/routes/ask.ts`) — synchronous JSON, no SSE, host-agnostic
- Both rewritten hooks (`useBrief.ts`, `useAsk.ts`) — fetch + await, host-agnostic
- `apps/web/src/lib/client.ts` — `VITE_API_BASE` prefix logic works for any cross-origin backend

## Architecture

```
Browser ──> Cloudflare Pages (apps/web/dist, static)
        └─> Railway service (Node + Express in Docker, no SSE)
                 └─> Railway Volume mounted at /var/data
                      ├── /var/data/cache    →  apps/server/src/persist.ts (CACHE_DIR)
                      └── /var/data/claude   →  symlinked from /root/.claude
                                                (anthropic-cc session)
```

Two completely independent services. Browser does cross-origin requests
from the Cloudflare-Pages frontend to the Railway backend. CORS allowed
on Railway via `CORS_ORIGIN=https://pm-copilot.pages.dev`. BYOK keys
travel as headers; same as today.

**Single replica only.** `/root/.claude` is per-instance auth state. We
configure Railway with `numReplicas: 1` and `restartPolicyType: ON_FAILURE`.
Horizontal scaling would require swapping anthropic-cc subprocess for
API-key path, which we don't want to force.

## railway.toml shape

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "apps/server/Dockerfile"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
numReplicas = 1
```

Volume mount + env vars + GitHub branch tracking are configured in the
Railway dashboard (or via `railway variables set` from the CLI). The
TOML covers only what should live in source control.

## Dockerfile change (one block)

Insert before the existing `CMD`:

```dockerfile
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
```

Where `docker-entrypoint.sh` is:

```sh
#!/bin/sh
set -eu

# Railway mounts the persistent Volume at /var/data. We split it into
# two subdirectories so the cache + claude /login state share one
# volume without colliding.
mkdir -p /var/data/cache /var/data/claude

# Symlink ~/.claude → the persistent claude subdirectory so the
# anthropic-cc CLI's OAuth state survives container restarts.
# Idempotent: replaces a stale symlink, leaves a real .claude
# directory alone (shouldn't happen in production but keeps local
# dev sane).
if [ -L /root/.claude ] || [ ! -e /root/.claude ]; then
  rm -f /root/.claude
  ln -s /var/data/claude /root/.claude
fi

exec "$@"
```

## Env vars on Railway

| Var | Value | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Standard Node convention |
| `PORT` | injected by Railway | We don't set this; Railway provides it |
| `CACHE_DIR` | `/var/data/cache` | persist.ts writes snapshot.json here |
| `BRIEF_CACHE_TTL_MS` | `900000` | 15-minute brief cache (per the user's earlier choice) |
| `CORS_ORIGIN` | Cloudflare Pages URL | After Pages is deployed, set to e.g. `https://pm-copilot.pages.dev` |
| `ANTHROPIC_API_KEY` | optional | If set, takes precedence over anthropic-cc subprocess. Useful for warm scaling later. |
| `OPENAI_API_KEY` | optional | BYOK fallback |
| `XAI_API_KEY` | optional | xAI live search |
| `PERPLEXITY_API_KEY` | optional | News agent enrichment |

## Deploy steps (the actual sequence)

### Phase A — user-driven (browser logins)

```powershell
npm install -g @railway/cli
railway login                       # opens browser
cd C:\Users\ayush\Downloads\pm-copilot-oss
.\node_modules\.bin\wrangler.cmd login    # opens browser
```

### Phase B — agent-driven (write code, push branch)

1. Apply the file changes listed above (add `railway.toml`, modify
   `Dockerfile`, delete `infra/azure/`, replace `AZURE_DEPLOY.md` with
   `RAILWAY_DEPLOY.md`)
2. Run `pnpm test --run` to confirm the 99 baseline tests still pass
3. Run `pnpm -F @pm-copilot/web build` to confirm the frontend still
   builds clean
4. Commit + push the cf-azure-rewrite branch

### Phase C — deploy (mixed)

5. **Agent:** `railway init` from the repo root, name the project
   `pm-copilot`, link to the GitHub repo, configure tracked branch as
   `cf-azure-rewrite` (we'll re-point at `main` after merge)
6. **Agent:** `railway volume add --mount-path /var/data --size 5` (or
   via dashboard if CLI flags differ)
7. **Agent:** `railway variables set CACHE_DIR=/var/data/cache
   BRIEF_CACHE_TTL_MS=900000 NODE_ENV=production`
8. **Agent:** Trigger first deploy (push the branch will auto-build, OR
   `railway up` to push manually). Capture the public URL Railway prints.
9. **Agent:** `wrangler pages project create pm-copilot --production-branch=main`
   to make the project. Note: `VITE_API_BASE` must be set BEFORE building
   because Vite inlines it at build time. Set it via the CF Pages
   dashboard (Settings → Environment variables → Production:
   `VITE_API_BASE=<railway-url>`) before running the deploy.
10. **Agent:** Build + deploy frontend: `VITE_API_BASE=<railway-url>
    pnpm -F @pm-copilot/web build && wrangler pages deploy
    apps/web/dist --project-name=pm-copilot --branch=cf-azure-rewrite`
    (preview deploy first; `--branch=main` for production after merge)
11. **Agent:** Set `CORS_ORIGIN` on Railway to the CF Pages URL via
    `railway variables set CORS_ORIGIN=<cf-pages-url>`
12. **User:** `railway run --service pm-copilot-api -- claude /login`
    (interactive, ~30s)
13. **Agent:** Smoke test
    - `curl <railway-url>/api/health`
    - `curl <railway-url>/api/brief?marketId=<known-id>` (verify
      `complete: true`)
    - Browser walkthrough of the CF Pages URL: landing → wallet →
      twitter → desk → load market → ask question

## Verification

A successful deploy means:

1. `pnpm test --run` reports 6 files / 99 tests passing on the
   cf-azure-rewrite branch (locally and in any CI we wire later)
2. `/api/health` on the Railway URL returns 200
3. `/api/brief?marketId=<id>` on the Railway URL returns 200 with
   `complete: true` and an `events` array (>20 entries)
4. A second `/api/brief` for the same market within 15 minutes returns
   `complete: true` AND a `cache.ageMs` field — proves the volume-mounted
   cache survives across requests
5. Browser walkthrough on the CF Pages URL produces visually identical
   output to the Render production site (orderbook, holders, brief
   sections, chat answer with all 6 sections)
6. With BYOK Anthropic key cleared, a brief still loads — proves the
   anthropic-cc subprocess path works inside the Railway container

## Risks + open questions

1. **Single-replica constraint.** anthropic-cc OAuth state is per-instance
   so we can't horizontally scale without dropping the subprocess path.
   Acceptable for launch traffic.
2. **Volume size.** 5 GB is plenty (current cache footprint is ~5 MB).
   No risk of growth without a feature change.
3. **Railway request timeout.** Default is 5 minutes; our `/api/brief`
   spends 30–60s. Comfortable headroom.
4. **Cost regression vs Render free tier.** Render was $0/mo (with cold
   start spin-down). Railway Hobby is $5/mo flat. Acceptable trade-off
   for the fixed-IP always-on container we need for anthropic-cc.
5. **claude /login auth lifecycle.** OAuth state expires periodically.
   Re-run via `railway run -- claude /login` when it does (yearly-ish).
   Documented in `RAILWAY_DEPLOY.md`.
6. **Render fallback retention.** Keep `render.yaml` and the Render
   service alive for one week after the cf-azure-rewrite branch merges
   to main. After clean operation, decommission and delete `render.yaml`.

## Branch strategy

Stay on `cf-azure-rewrite` branch. The branch name is now slightly
misleading (we're not deploying to Azure) but renaming the branch
mid-flight risks losing the GitHub PR link continuity. The PR
description will note the pivot. After merge, the branch name
disappears anyway.
