# Azure deployment — runbook

The pm-copilot service deploys to **Azure Container Apps** as a single
Node container running the Express server (which serves both `/api/*`
AND the React bundle from the same origin). Cache and Claude Code OAuth
state live on an Azure Files share mounted at `/var/data` so they
survive restarts and revisions.

## Architecture (one-line summary)

```
Browser ──HTTPS──▶ Container App (single replica)
                       │
                       ├── /var/data  ← Azure Files SMB share
                       │     ├── /var/data/cache   (persist.ts snapshot)
                       │     └── /var/data/claude  (anthropic-cc OAuth state,
                       │                            symlinked from /root/.claude)
                       └── image pulled from Azure Container Registry
```

Single replica is mandatory. The anthropic-cc subprocess provider keeps
Claude Code OAuth state in `~/.claude`, which is per-instance state — we
cannot horizontally scale without breaking it.

## Resources

| Resource | Name | SKU |
|---|---|---|
| Resource group | `pm-copilot` | — |
| Storage account | `pmcopilotst<6-char-suffix>` | Standard_LRS |
| File share | `cache` (5 GiB quota) | SMB |
| Container Registry | `pmcopilotacr<6-char-suffix>` | Basic |
| Container Apps Environment | `pm-copilot-env` | Consumption |
| Container App | `pm-copilot` | 0.25 vCPU / 0.5 GiB, replicas pinned 1→1 |

The 6-char suffix is a deterministic hash of the resource group name, so
re-running the deploy script picks the same names back up — it doesn't
create duplicates.

## Pre-requisites

- `az` CLI logged in: `az login`
- A subscription with Owner / Contributor (the script doesn't touch RBAC)
- These resource providers registered on the subscription (one-off):
  ```bash
  az provider register -n Microsoft.App
  az provider register -n Microsoft.ContainerRegistry
  az provider register -n Microsoft.Storage
  az provider register -n Microsoft.OperationalInsights
  ```

## First deploy

From the repo root:

```bash
bash infra/azure/deploy.sh
```

The script is idempotent — re-run it any time to roll a new image or
fix drift. Total runtime ~5–8 min on first run (most of it is `az acr
build` compiling the Docker image), ~2–3 min on subsequent runs.

When it finishes it prints the public URL, e.g.:

```
App URL: https://pm-copilot.<random>.eastus.azurecontainerapps.io
```

## Authentication options (all optional)

The deploy works **out of the box with BYOK** — visitors paste their
own provider keys (Anthropic / OpenAI / Gemini / xAI / Perplexity) into
the setup tile in their browser, encrypted to their IndexedDB, and
the server never persists them. **No server-side login needed.**

You only need to set something up server-side if you specifically
want to subsidize visitors without their own keys — which on a public
URL means sharing your account's rate limits with the entire internet.
Usually not what you want.

### Option A — single-tenant Anthropic API key (paid, predictable)

Bake an Anthropic API key in as a Container Apps secret. Every visitor
hits Anthropic via your key. You eat the cost; users skip the BYOK
step.

```bash
az containerapp secret set -n pm-copilot -g pm-copilot \
  --secrets anthropic-api-key=<your-key>
az containerapp update -n pm-copilot -g pm-copilot \
  --set-env-vars ANTHROPIC_API_KEY=secretref:anthropic-api-key
```

### Option B — `anthropic-cc` subprocess (free Claude Code)

Bundle your personal Claude.ai account's OAuth state on the container.
The "Use local Claude Code" tile in the setup screen routes through
this. **Your rate limits are shared across every visitor** — only
sensible if traffic is low and trusted. Ritual:

```bash
az containerapp exec -n pm-copilot -g pm-copilot --command bash
# inside the container:
claude
# follow the printed URL in a browser, sign in, paste the verification
# code back into the same terminal at the prompt, then /quit + exit.
```

State persists at `/var/data/claude/.credentials.json` and survives
restarts and revision rollouts. Token expires periodically — re-run
the same flow when it does.

### Option C — pure BYOK (default; no setup)

Do nothing. Tell visitors to paste their own provider key in the
setup tile when they first load the app. This is the default config
and what the deploy ships with.

## Verify the deploy

```bash
FQDN=$(az containerapp show -n pm-copilot -g pm-copilot \
  --query properties.configuration.ingress.fqdn -o tsv)

# 1. Health check
curl https://$FQDN/api/health

# 2. Provider liveness
curl https://$FQDN/api/health/providers

# 3. End-to-end brief (runs the supervisor)
curl "https://$FQDN/api/brief?marketId=<known-id>" | head -c 500

# 4. Cache hit on second call within 1 hour (BRIEF_CACHE_TTL_MS=3600000)
curl "https://$FQDN/api/brief?marketId=<known-id>" | head -c 500

# 5. Tail container logs
az containerapp logs show -n pm-copilot -g pm-copilot --follow
```

## Operating notes

- **Single replica, no scale-to-zero.** `minReplicas=maxReplicas=1`.
  This keeps the cache + anthropic-cc OAuth state warm and on the
  same instance forever.
- **Persistent cache.** `CACHE_DIR=/var/data/cache` is on the Azure
  Files share. `apps/server/src/persist.ts` writes `snapshot.json`
  there and rehydrates on boot — survives restarts even when no users
  hit the service.
- **Brief cache TTL.** Set to 1h (`BRIEF_CACHE_TTL_MS=3600000`). Bump
  via env var on the container app if you want it longer.
- **CORS.** `CORS_ORIGIN=*` because api + web share the same origin.
  No need to override unless you split web onto a separate host.
- **Registry password.** Stored as a Container Apps secret
  (`registry-password`) — never echoed back from `az` once set.

## Redeploys

Same script, same command:

```bash
bash infra/azure/deploy.sh
```

For a one-off image rebuild without touching infra:

```bash
az acr build --registry pmcopilotacr<suffix> \
  --file apps/server/Dockerfile \
  --image pm-copilot:latest .

az containerapp update -n pm-copilot -g pm-copilot \
  --image pmcopilotacr<suffix>.azurecr.io/pm-copilot:latest
```

## Rollback

Container Apps tracks revisions. List and pin the previous one:

```bash
az containerapp revision list -n pm-copilot -g pm-copilot \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" -o table

az containerapp revision activate -n pm-copilot -g pm-copilot \
  --revision <previous-revision-name>
```

## Cost ballpark (low traffic)

| Component | Monthly |
|---|---|
| ACR Basic | ~$5 |
| Storage account + 5 GiB Files | ~$0.30 |
| Container Apps (single 0.25 vCPU / 0.5 GiB always-on replica) | $0–15 (free monthly grant covers most low-traffic deploys) |
| Egress | minimal at low traffic |
| **Total** | **~$5–20/mo** |

## Tear down

```bash
az group delete -n pm-copilot --yes --no-wait
```

This removes everything: container app, environment, ACR, storage,
file share, all of it.
