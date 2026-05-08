#!/usr/bin/env bash
# infra/azure/deploy.sh — idempotent deploy of pm-copilot to Azure
# Container Apps with an Azure Files volume mounted at /var/data.
#
# Pre-reqs:
#   - `az login` already done (any subscription with Owner / Contributor)
#   - run from the repo root: `bash infra/azure/deploy.sh`
#
# What it provisions (all in one resource group, region = $LOCATION):
#   1. Resource group                pm-copilot
#   2. Storage account + Files share storage holds the /var/data SMB share
#   3. Azure Container Registry      `az acr build` builds the image in-cloud
#   4. Container Apps Environment    + the storage registered as `azfiles`
#   5. Container App                 single replica, ingress on 8787,
#                                    /var/data mounted from Azure Files
#
# Re-running is safe: every step is create-or-update. Names that must be
# globally unique (storage account, ACR) are derived from a deterministic
# 6-char suffix of $RG so re-running picks the same names back up.
#
# After this script completes, finish with the one-time anthropic-cc OAuth:
#   az containerapp exec -n pm-copilot -g pm-copilot --command 'claude /login'
# (follow the printed URL, sign in to claude.ai, paste the code back). State
# lives on Azure Files at /var/data/claude → survives restarts and revisions.

set -euo pipefail

# ---------- Inputs (override via env) ----------
RG=${RG:-pm-copilot}
LOCATION=${LOCATION:-eastus}
APP=${APP:-pm-copilot}
ENV_NAME=${ENV_NAME:-pm-copilot-env}
SHARE=${SHARE:-cache}
IMAGE_TAG=${IMAGE_TAG:-v1}
CPU=${CPU:-1.0}
MEMORY=${MEMORY:-2.0Gi}

# Globally-unique names derived from RG so re-runs are stable.
SUFFIX=${SUFFIX:-$(printf '%s' "$RG" | shasum | cut -c1-6)}
ACR=${ACR:-pmcopilotacr${SUFFIX}}
STORAGE=${STORAGE:-pmcopilotst${SUFFIX}}

cd "$(dirname "$0")/../.."

echo "==> Resource group ($RG, $LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

echo "==> Storage account ($STORAGE)"
az storage account create \
  -n "$STORAGE" -g "$RG" -l "$LOCATION" \
  --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false -o none

STORAGE_KEY=$(az storage account keys list -g "$RG" -n "$STORAGE" \
  --query "[0].value" -o tsv)

echo "==> File share ($SHARE, 5 GiB quota)"
az storage share-rm create \
  --resource-group "$RG" \
  --storage-account "$STORAGE" \
  --name "$SHARE" \
  --quota 5 \
  --enabled-protocols SMB \
  -o none

echo "==> Azure Container Registry ($ACR)"
az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true -o none

ACR_LOGIN=$(az acr show -n "$ACR" --query loginServer -o tsv)
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query "passwords[0].value" -o tsv)

echo "==> Build image in ACR ($ACR_LOGIN/pm-copilot:$IMAGE_TAG)"
az acr build \
  --registry "$ACR" \
  --file apps/server/Dockerfile \
  --image "pm-copilot:$IMAGE_TAG" \
  --image "pm-copilot:latest" \
  .

# Pull the digest so the container app spec always references an
# immutable image. Without this, re-running the script with the same
# tag would not roll a new revision (the spec hash would be unchanged).
IMAGE_DIGEST=$(az acr repository show \
  -n "$ACR" --image "pm-copilot:$IMAGE_TAG" \
  --query digest -o tsv)
IMAGE_REF="$ACR_LOGIN/pm-copilot@$IMAGE_DIGEST"
echo "    digest: $IMAGE_DIGEST"

echo "==> Container Apps Environment ($ENV_NAME)"
if ! az containerapp env show -n "$ENV_NAME" -g "$RG" -o none 2>/dev/null; then
  az containerapp env create \
    -n "$ENV_NAME" -g "$RG" -l "$LOCATION" \
    --logs-destination none \
    -o none
fi

echo "==> Register Azure Files share with environment (azfiles)"
az containerapp env storage set \
  -n "$ENV_NAME" -g "$RG" \
  --storage-name azfiles \
  --azure-file-account-name "$STORAGE" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$SHARE" \
  --access-mode ReadWrite \
  -o none

ENV_ID=$(az containerapp env show -n "$ENV_NAME" -g "$RG" --query id -o tsv)

# Pull the existing openai-api-key secret if one is set on the container
# app. The operator sets this out-of-band (see docs/AZURE_DEPLOY.md).
# When present, we inline it into the YAML so the OPENAI_* env vars
# below can reference it without the manifest losing track of it across
# `--yaml` updates. When absent, we skip the OPENAI_* block entirely so
# the deploy doesn't fail with SecretRefNotFound.
OPENAI_API_KEY_VALUE=""
if az containerapp show -n "$APP" -g "$RG" -o none 2>/dev/null; then
  OPENAI_API_KEY_VALUE=$(az containerapp secret show \
    -n "$APP" -g "$RG" --secret-name openai-api-key \
    --query value -o tsv 2>/dev/null || echo "")
fi

if [ -n "$OPENAI_API_KEY_VALUE" ]; then
  OPENAI_SECRET_BLOCK=$(cat <<YAML2
      - name: openai-api-key
        value: "$OPENAI_API_KEY_VALUE"
YAML2
)
  OPENAI_ENV_BLOCK=$(cat <<YAML2
          - name: PROVIDER
            value: openai
          - name: OPENAI_API_KEY
            secretRef: openai-api-key
          - name: OPENAI_BASE_URL
            value: https://ayushya-co-pilot.openai.azure.com
          - name: OPENAI_API_VERSION
            value: "2025-04-01-preview"
          - name: OPENAI_REASONING_MODEL
            value: gpt-55
          - name: OPENAI_FAST_MODEL
            value: gpt-55
YAML2
)
  echo "    openai-api-key secret found — Azure OpenAI will be the server-side default"
else
  OPENAI_SECRET_BLOCK=""
  OPENAI_ENV_BLOCK=""
  echo "    openai-api-key secret NOT set — skipping Azure OpenAI env vars"
  echo "    (set with: az containerapp secret set -n $APP -g $RG --secrets openai-api-key=<key>)"
fi

echo "==> Generate container app manifest"
MANIFEST=$(mktemp -t pm-copilot.XXXXXX.yaml)
trap 'rm -f "$MANIFEST"' EXIT

cat > "$MANIFEST" <<YAML
location: $LOCATION
properties:
  managedEnvironmentId: $ENV_ID
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: true
      targetPort: 8787
      transport: auto
      allowInsecure: false
    registries:
      - server: $ACR_LOGIN
        username: $ACR_USER
        passwordSecretRef: registry-password
    secrets:
      - name: registry-password
        value: "$ACR_PASS"
$OPENAI_SECRET_BLOCK
  template:
    containers:
      - name: pm-copilot
        image: $IMAGE_REF
        resources:
          cpu: $CPU
          memory: $MEMORY
        env:
          - name: NODE_ENV
            value: production
          - name: PORT
            value: "8787"
          - name: CACHE_DIR
            value: /var/data/cache
          - name: BRIEF_CACHE_TTL_MS
            value: "3600000"
          - name: CORS_ORIGIN
            value: "*"
$OPENAI_ENV_BLOCK
        volumeMounts:
          - volumeName: data
            mountPath: /var/data
        probes:
          - type: Liveness
            httpGet:
              path: /api/health
              port: 8787
            initialDelaySeconds: 15
            periodSeconds: 30
          - type: Readiness
            httpGet:
              path: /api/health
              port: 8787
            initialDelaySeconds: 5
            periodSeconds: 10
    volumes:
      - name: data
        storageType: AzureFile
        storageName: azfiles
    scale:
      minReplicas: 1
      maxReplicas: 1
YAML

echo "==> Create or update Container App ($APP)"
if az containerapp show -n "$APP" -g "$RG" -o none 2>/dev/null; then
  # App exists — fast path: just bump the image by digest. Avoids
  # rewriting the full spec (which would require re-reading the
  # openai-api-key secret value to keep the manifest valid). The
  # secret + env vars + volume mount + scale config are already in
  # place from the original create, and Container Apps auto-rolls a
  # new revision when the image reference changes.
  az containerapp update -n "$APP" -g "$RG" \
    --image "$IMAGE_REF" -o none
else
  az containerapp create -n "$APP" -g "$RG" --yaml "$MANIFEST" -o none
fi

FQDN=$(az containerapp show -n "$APP" -g "$RG" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo
echo "----------------------------------------------------------------"
echo " Deploy OK"
echo "----------------------------------------------------------------"
echo " App URL:    https://$FQDN"
echo " Health:     https://$FQDN/api/health"
echo
echo " One-time anthropic-cc login (run once per environment):"
echo "   az containerapp exec -n $APP -g $RG --command 'claude /login'"
echo
echo " Tail logs:"
echo "   az containerapp logs show -n $APP -g $RG --follow"
echo "----------------------------------------------------------------"
