# Railway deployment — runbook

The pm-copilot backend deploys to **Railway** as a single Node container
running the Express server. Frontend lives separately on **Cloudflare
Pages**. This doc covers the backend half + the wire-up to the frontend.

## Architecture (one-line summary)

```
Browser ──> Cloudflare Pages (static apps/web/dist)
        └─> Railway service (Dockerfile-built Node container)
                 └─> Railway Volume at /var/data
                      ├── /var/data/cache    (persist.ts snapshot.json)
                      └── /var/data/claude   (anthropic-cc OAuth state, symlinked from /root/.claude)
```

Single replica. Always-on (no scale-to-zero — `/root/.claude` is per-
instance auth state, so we can't horizontally scale without dropping
the anthropic-cc subprocess path).

## Prerequisites

- Railway account (sign up at <https://railway.app>)
- Cloudflare account
- Node 20+ locally (for the wrangler CLI)
- `npm install -g @railway/cli` — Railway CLI

## One-time setup

### 1. Login to both clouds

```powershell
railway login                     # opens browser
.\node_modules\.bin\wrangler.cmd login    # opens browser (run from repo root)
```

### 2. Create the Railway project + link to GitHub

```powershell
cd C:\Users\ayush\Downloads\pm-copilot-oss
railway init
# Pick: "Empty project", name it `pm-copilot`
# After init: link the GitHub repo (Railway dashboard → Project Settings →
# Source Repo → connect Torque44/pm-copilot-oss → branch: cf-azure-rewrite
# (re-point to main after the cf-azure-rewrite PR merges)
```

### 3. Attach a 5 GB Volume

Via dashboard (easier first time):
- Open the project → service → Settings → Volumes
- Add a Volume mounted at `/var/data` with size 5 GB

Or via CLI (if available in your Railway CLI version):
```powershell
railway volume add --mount-path /var/data --size 5
```

### 4. Set environment variables

```powershell
railway variables set CACHE_DIR=/var/data/cache
railway variables set BRIEF_CACHE_TTL_MS=900000
railway variables set NODE_ENV=production
# CORS_ORIGIN is set AFTER Cloudflare Pages exists (step 7 below)

# Optional BYOK provider keys — anthropic-cc subprocess covers Anthropic
# without a key, but bake one in if you'd rather skip the claude /login step:
# railway variables set ANTHROPIC_API_KEY=<key>
# railway variables set OPENAI_API_KEY=<key>
# railway variables set XAI_API_KEY=<key>
# railway variables set PERPLEXITY_API_KEY=<key>
```

### 5. First deploy

```powershell
# Push the cf-azure-rewrite branch — GitHub integration triggers a build
git push origin cf-azure-rewrite

# Or deploy from local without pushing:
railway up
```

Railway builds from `apps/server/Dockerfile`, runs the entrypoint
(`apps/server/docker-entrypoint.sh`), starts the Express server. First
build takes ~3–5 minutes. The dashboard shows logs live.

### 6. Capture the Railway URL

```powershell
railway domain               # prints the public URL, e.g.
                             # pm-copilot-production.up.railway.app
```

Or read it from the dashboard: Service → Settings → Networking → Public Domain.

### 7. Set up the Cloudflare Pages frontend

```powershell
.\node_modules\.bin\wrangler.cmd pages project create pm-copilot --production-branch=main

# VITE_API_BASE is INLINED at build time by Vite — set it BEFORE building.
# Easiest: in the CF Pages dashboard, Settings → Environment variables →
# Production: VITE_API_BASE=https://<railway-url>
# Then rebuild + redeploy:

$env:VITE_API_BASE = "https://<railway-url>"
pnpm -F @pm-copilot/web build
.\node_modules\.bin\wrangler.cmd pages deploy apps/web/dist `
  --project-name=pm-copilot `
  --branch=cf-azure-rewrite

# (after merge to main, drop --branch and the deploy goes to production)
```

### 8. Wire CORS_ORIGIN back to Railway

```powershell
railway variables set CORS_ORIGIN=https://<cf-pages-url>
# Railway auto-redeploys when env vars change.
```

### 9. One-time `claude /login` for anthropic-cc

If you didn't bake `ANTHROPIC_API_KEY` into env vars, the anthropic
provider falls through to the subprocess path (`claude -p`). That CLI
needs to be authenticated once per environment. State lives on the
mounted volume at `/var/data/claude` (symlinked from `/root/.claude`),
so this is a one-shot per deployment.

```powershell
railway run --service pm-copilot-api -- claude /login
# Follow the OAuth link. State writes to /root/.claude → /var/data/claude
# on the persistent volume.
```

If the auth token later expires (yearly-ish), re-run the same command.

## Verify the deploy

```bash
# 1. Health check
curl https://<railway-url>/api/health

# 2. Provider liveness
curl https://<railway-url>/api/health/providers

# 3. End-to-end brief — runs the supervisor
curl "https://<railway-url>/api/brief?marketId=<known-id>" | jq .complete

# 4. Cache hit on second call within 15 minutes
curl "https://<railway-url>/api/brief?marketId=<known-id>" | jq .cache

# 5. Tail container logs
railway logs --tail
```

A clean deploy means:
- `/api/health` returns 200
- First `/api/brief` call returns `complete: true` with a 30+-event array
- Second call within 15 min returns `cache: { source: "memory", ageMs: ... }`
- Browser walkthrough on the CF Pages URL produces visually identical
  output to the old Render production site

## Cost

- **Railway Hobby** plan — $5/mo flat, includes $5 of compute + bandwidth
  credit. For our load (low traffic, single replica), actual usage is
  well under $5/mo, so total = $5/mo.
- **Volume** — billed separately at ~$0.05/GB/month. 5 GB ≈ $0.25/mo.
- **Cloudflare Pages** — free tier covers our scale.
- **Total: ~$5.25/mo**

## Operating notes

- **No cold start.** Railway keeps single-replica services warm; users
  always hit a running container.
- **15-minute brief cache.** `BRIEF_CACHE_TTL_MS=900000` env var. After
  15 min, the next brief request runs the supervisor fresh; cached
  briefs in that window are served instantly (no LLM cost).
- **Cache directory.** `CACHE_DIR=/var/data/cache` is the env var the
  Dockerfile + Railway both set. `apps/server/src/persist.ts` reads it.
- **anthropic-cc auth lifecycle.** OAuth state in `/var/data/claude`
  survives restarts and redeploys (volume is persistent). Token
  expires periodically — re-run `claude /login` via `railway run`.
- **Logs.** `railway logs --tail` from CLI, or the Railway dashboard.
  Server-side prints include `[brief] cache MISS|HIT|BYPASSED <id>`
  lines per request, useful for sanity-checking cache behavior.
- **Redeploys.** Push to the linked branch and Railway auto-builds. No
  manual step. CI integration optional (Railway runs the build itself).

## Rollback

If a Railway deploy regresses production:
- Roll back via the dashboard: Deployments → pick a healthy older
  deployment → Redeploy
- Or `railway redeploy <deployment-id>` from CLI

The Render service stays alive for one week after merging
`cf-azure-rewrite` to `main` as a fallback. After clean operation,
decommission Render and delete `render.yaml`.
