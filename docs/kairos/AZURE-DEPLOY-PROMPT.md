# Azure deploy prompt — pmcopilot /v1 Kairos API

> Copy everything below the line into a fresh Claude Code session opened in the
> `pm-copilot-oss` repo root. It is self-contained — the session has no memory
> of how the API was built.

---

You are deploying the pmcopilot server to Azure Container Apps. A new external API surface (`/v1/*`, the "Kairos API") was just added to the codebase and needs to go live. Your job is to rebuild the container image, set the API-key env var as a secret, deploy, and verify.

## Context you need

**What the service is.** A single Node/Express container (`apps/server`) that serves both `/api/*` (internal app routes) and the React bundle from the same origin. It already runs on Azure Container Apps. Full runbook: `docs/AZURE_DEPLOY.md` — read it before doing anything.

**What's new.** A `/v1/*` REST API for the Kairos prediction-market terminal. 11 endpoints (health, market metadata, outcomes, holders, news, sentiment, thesis, comparables, resolution, ask, research). Spec: `docs/kairos/openapi.yaml`. Router: `apps/server/src/routes/kairos-v1.ts`. Auth middleware: `apps/server/src/middleware/kairosApiKey.ts`. It's already wired into `apps/server/src/index.ts` (mounted at `/v1` with rate limiting). **No code changes needed — it ships automatically the moment the image rebuilds.**

**Auth model.** Every `/v1` route except `/v1/health` requires an `X-Api-Key` header. Keys are read from the `KAIROS_API_KEYS` env var at boot. Format:

```
KAIROS_API_KEYS="<key1>:prod,<key2>:staging,<key3>:dev"
```

Each comma-separated entry is `<key>:<env_label>`. If the var is unset, `/v1/*` rejects every request with 401 (safe default).

## Architecture facts (from docs/AZURE_DEPLOY.md)

- Resource group: `pm-copilot`
- Container App: `pm-copilot`
- Registry: `pmcopilotacr<6-char-suffix>` (suffix is a deterministic hash of the RG name — `infra/azure/deploy.sh` recomputes it; don't guess it, read it from the script or `az acr list`)
- Single replica, no scale-to-zero (`minReplicas=maxReplicas=1`) — required because Claude Code OAuth state is per-instance
- Cache + OAuth state on an Azure Files share at `/var/data`
- The deploy script `infra/azure/deploy.sh` is idempotent

## Steps

### 1. Generate three API keys (do NOT hardcode them anywhere)

Generate locally, never commit:

```bash
for env in prod staging dev; do
  echo "kairos_${env}_$(openssl rand -hex 24)"
done
```

Save these three values somewhere secure (a password manager). You'll hand the dev key to Kairos for sandbox testing and the prod/staging keys when they go live. **Do not paste them into any committed file, this prompt, or chat logs.**

### 2. Set the keys as a Container Apps secret

```bash
# Build the KAIROS_API_KEYS value from the three keys you generated.
# Store the joined value as a secret (never as a plain env var — secrets
# are not echoed back by `az` and aren't visible in revision history).
az containerapp secret set -n pm-copilot -g pm-copilot \
  --secrets kairos-api-keys="<prodkey>:prod,<stagingkey>:staging,<devkey>:dev"

az containerapp update -n pm-copilot -g pm-copilot \
  --set-env-vars KAIROS_API_KEYS=secretref:kairos-api-keys
```

### 3. Rebuild + deploy the image

The simplest path — re-run the idempotent deploy script:

```bash
bash infra/azure/deploy.sh
```

Or, for a one-off image rebuild without touching infra (faster):

```bash
# Read the actual registry name first:
ACR=$(az acr list -g pm-copilot --query "[0].name" -o tsv)

az acr build --registry "$ACR" \
  --file apps/server/Dockerfile \
  --image pm-copilot:latest .

az containerapp update -n pm-copilot -g pm-copilot \
  --image "$ACR.azurecr.io/pm-copilot:latest"
```

### 4. Verify the /v1 surface

```bash
FQDN=$(az containerapp show -n pm-copilot -g pm-copilot \
  --query properties.configuration.ingress.fqdn -o tsv)

# Health — should return JSON, no key needed
curl "https://$FQDN/v1/health"

# Auth gate — should return 401 missing_api_key
curl -i "https://$FQDN/v1/markets/test" | head -5

# Authed market metadata — replace <devkey> + <marketId>
curl "https://$FQDN/v1/markets/<marketId>" \
  -H "X-Api-Key: <devkey>"

# Full research envelope (runs the supervisor — slow, ~15s first call)
curl "https://$FQDN/v1/research" -X POST \
  -H "X-Api-Key: <devkey>" \
  -H "Content-Type: application/json" \
  -d '{"market_id":"<marketId>"}' | head -c 800

# Tail logs to confirm boot + key load
az containerapp logs show -n pm-copilot -g pm-copilot --follow
```

On boot you should see no `[kairos] KAIROS_API_KEYS not set` warning. If you DO see it, the secret didn't wire correctly — re-check step 2.

### 5. (Optional) Custom domain for Kairos

The integration guide references `api.pmcopilot.wtf` / `dev.api.pmcopilot.wtf`. If those subdomains aren't bound yet:

```bash
az containerapp hostname add -n pm-copilot -g pm-copilot \
  --hostname api.pmcopilot.wtf
# then add the managed cert + the CNAME/TXT records at your DNS provider
# (Cloudflare) per the `az` output.
```

If you skip this, Kairos can hit the raw `*.azurecontainerapps.io` FQDN with the dev key — the integration guide's base URLs are aspirational, the FQDN works today.

## Guardrails

- **Never commit API keys.** They live only as Container Apps secrets + your password manager.
- **Single replica is mandatory** — do not set `minReplicas`/`maxReplicas` above 1.
- **Don't touch the `/api/*` routes or the web bundle serving** — the `/v1` work is additive.
- If `az acr build` fails on the TypeScript build step, run `pnpm typecheck` locally first — the image build runs `tsc` and a type error there fails the whole image.
- Rollback if needed: `az containerapp revision list` → `az containerapp revision activate --revision <previous>`.

## Done criteria

- [ ] `curl https://$FQDN/v1/health` returns `{"ok":true,...}`
- [ ] `/v1/markets/<id>` returns 401 without a key, 200 with the dev key
- [ ] No `KAIROS_API_KEYS not set` warning in boot logs
- [ ] Three keys saved securely, none committed to git
- [ ] Reply with the FQDN + confirmation so the keys can be handed to Kairos
