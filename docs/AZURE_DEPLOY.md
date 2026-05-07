# Azure Container Apps deploy — runbook

The pm-copilot backend deploys to **Azure Container Apps**, a managed
serverless container service. Frontend lives on **Cloudflare Pages**
separately. This doc covers the backend half.

## Architecture summary

- One Container App, one replica, scale-to-zero
- Single Linux container running the existing Node + Express server
  (no SSE — the `cf-azure-rewrite` dropped streaming in favour of a
  synchronous JSON `/api/brief` and `/api/ask`)
- Azure Files share mounted at:
  - `/var/data/cache` — `apps/server/src/persist.ts` writes
    `snapshot.json` here so the cache survives restarts
  - `/root/.claude` — anthropic-cc subprocess auth state lives here
- `claude` CLI installed in the Docker image so `claude -p` works for
  the anthropic-cc provider

## Prerequisites

- `az` CLI ≥ 2.60 (`az login` against the target subscription)
- Docker CLI
- An Azure Container Registry (ACR), or change `REGISTRY` env var to a
  public registry like ghcr.io
- A resource group (the deploy script uses `pm-copilot` by default)

## Initial setup

```bash
# Once: create the resource group + ACR if you don't have them yet
az group create --name pm-copilot --location eastus
az acr create --resource-group pm-copilot --name pmcopilot --sku Basic
az acr login --name pmcopilot

# Once: install the containerapp extension
az extension add --name containerapp
az provider register --namespace Microsoft.App
```

## Deploy

```bash
# From the repo root, on the cf-azure-rewrite branch
./infra/azure/deploy.sh
```

What that script does:

1. `docker build -f apps/server/Dockerfile -t pmcopilot.azurecr.io/pm-copilot-api:latest .`
2. `docker push` to ACR
3. `az deployment group create` against `infra/azure/main.bicep` — provisions storage, file share, log workspace, Container Apps Environment, the app itself
4. Prints the public URL

Override env vars to hit a preview environment:

```bash
RESOURCE_GROUP=pm-copilot-preview \
  IMAGE_TAG=preview \
  CORS_ORIGIN=https://pm-copilot-preview.pages.dev \
  ./infra/azure/deploy.sh
```

## One-time `claude /login` for anthropic-cc

The `claude` CLI inside the container needs to be authenticated once
per environment. State persists in `/root/.claude` on the Azure Files
mount, so you only do this once per deployment.

```bash
az containerapp exec \
  --name pm-copilot-api \
  --resource-group pm-copilot \
  -- /bin/sh

# Inside the container shell:
claude /login
# Follow the OAuth link printed by the CLI. State writes to /root/.claude
# which is the mounted Azure Files volume; survives container restarts
# and revision rollouts.

exit
```

If the auth token expires later, re-run the same `claude /login` step.
Once a year-ish under typical use.

## Setting BYOK provider keys (alternative to anthropic-cc)

If you'd rather not deal with the subprocess auth, set provider keys as
Container App secrets:

```bash
az containerapp secret set \
  --name pm-copilot-api \
  --resource-group pm-copilot \
  --secrets \
    anthropic-api-key=<key> \
    openai-api-key=<key>

# Then attach them as env vars (re-run deploy.sh which does this via Bicep)
ANTHROPIC_API_KEY=<key> ./infra/azure/deploy.sh
```

When `ANTHROPIC_API_KEY` is set, the anthropic provider uses the API
path and skips the subprocess. You can still leave the `claude` CLI
installed in the image — it's a no-op when the API key path takes over.

## Verify the deploy

```bash
# 1. Health check
curl https://pm-copilot-api.<region>.azurecontainerapps.io/api/health

# 2. Provider liveness
curl https://pm-copilot-api.<region>.azurecontainerapps.io/api/health/providers

# 3. Brief one specific market — runs the supervisor end-to-end
curl "https://pm-copilot-api.<region>.azurecontainerapps.io/api/brief?marketId=<id>" | jq .complete

# 4. Tail the container logs while traffic flows
az containerapp logs show \
  --name pm-copilot-api \
  --resource-group pm-copilot \
  --follow
```

A successful deploy means:

- `/api/health` returns 200 with `{"ok":true,...}`
- `/api/brief?marketId=<id>` returns 200 with `complete: true`, an
  `events` array of 30+ entries, and (on second call) a `cache.ageMs`
  field
- The Container App logs show one `[brief] cache MISS` (first call) +
  one `[brief] cache HIT` (second call within 15 minutes)

## Operating notes

- **Scale-to-zero cold start.** First request after 15 min idle takes
  3–8 seconds for the container to wake up. Set `minReplicas=1` in
  `infra/azure/main.bicep` (~$10/mo) to eliminate. Production-ish
  traffic keeps it warm naturally.
- **15-minute brief cache.** `BRIEF_CACHE_TTL_MS=900000` is set in the
  Bicep template. Override at deploy time via env var. After 15 min
  the next brief request runs the supervisor fresh; orderbook prices
  in the cached brief stay reasonably current.
- **Cache directory.** `CACHE_DIR=/var/data/cache` is hard-coded in
  the Dockerfile + reinforced via env. The mount is part of the
  container template; deleting the file share would lose all cached
  briefs but doesn't affect uptime (cold cache rebuilds on next
  request).
- **anthropic-cc auth lifecycle.** Token persists in `/root/.claude`
  across container restarts because the mount is persistent. Token
  expiry triggers a `claude /login` redo via `az containerapp exec`
  — same one-shot flow as initial setup. Set up a calendar nudge.
