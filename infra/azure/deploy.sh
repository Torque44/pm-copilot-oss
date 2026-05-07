#!/usr/bin/env bash
# infra/azure/deploy.sh — one-shot deploy of the pm-copilot backend to
# Azure Container Apps. Builds the Docker image from apps/server/Dockerfile,
# pushes it to ACR, then applies the Bicep template.
#
# Prerequisites:
#   - az CLI logged in (`az login`) with rights to the target subscription
#   - A resource group already created (or change RESOURCE_GROUP below)
#   - An Azure Container Registry (or change REGISTRY below)
#
# Env vars (override at invocation time):
#   RESOURCE_GROUP   default pm-copilot
#   LOCATION         default eastus
#   REGISTRY         default pmcopilot.azurecr.io
#   IMAGE_TAG        default latest
#   CORS_ORIGIN      default https://pm-copilot.pages.dev
#   BRIEF_CACHE_TTL_MS  default 900000
#
# After deploy, run the one-time `claude /login`:
#   az containerapp exec --name pm-copilot-api --resource-group <rg> -- /bin/sh
#   # inside the container:
#   claude /login
#   # follow the OAuth link printed; state persists in /root/.claude on the
#   # Azure Files mount and survives container restarts.

set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-pm-copilot}"
LOCATION="${LOCATION:-eastus}"
REGISTRY="${REGISTRY:-pmcopilot.azurecr.io}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
CORS_ORIGIN="${CORS_ORIGIN:-https://pm-copilot.pages.dev}"
BRIEF_CACHE_TTL_MS="${BRIEF_CACHE_TTL_MS:-900000}"

IMAGE="${REGISTRY}/pm-copilot-api:${IMAGE_TAG}"

echo "[deploy] image: ${IMAGE}"
echo "[deploy] cors origin: ${CORS_ORIGIN}"
echo "[deploy] brief TTL: ${BRIEF_CACHE_TTL_MS}ms"

# Build + push from the repo root so the build context covers the whole
# pnpm workspace. The Dockerfile lives at apps/server/Dockerfile but the
# context needs to be the repo root for the workspace install to resolve.
echo "[deploy] building image..."
docker build -f apps/server/Dockerfile -t "${IMAGE}" .

echo "[deploy] pushing to ${REGISTRY}..."
docker push "${IMAGE}"

# Apply the Bicep template. Provider keys are read from env vars if set;
# otherwise the deployment uses anthropic-cc subprocess auth (set up via
# `claude /login` after deploy).
echo "[deploy] applying bicep template..."
az deployment group create \
  --resource-group "${RESOURCE_GROUP}" \
  --template-file infra/azure/main.bicep \
  --parameters \
    image="${IMAGE}" \
    location="${LOCATION}" \
    corsOrigin="${CORS_ORIGIN}" \
    briefCacheTtlMs="${BRIEF_CACHE_TTL_MS}" \
    anthropicApiKey="${ANTHROPIC_API_KEY:-}" \
    openaiApiKey="${OPENAI_API_KEY:-}" \
    perplexityApiKey="${PERPLEXITY_API_KEY:-}" \
    xaiApiKey="${XAI_API_KEY:-}"

# Show the resulting URL.
APP_URL=$(az deployment group show \
  --resource-group "${RESOURCE_GROUP}" \
  --name main \
  --query 'properties.outputs.appUrl.value' \
  --output tsv)

echo ""
echo "[deploy] done."
echo "[deploy] api: ${APP_URL}"
echo ""
echo "[deploy] next steps:"
echo "  1. set CORS_ORIGIN on the Cloudflare Pages frontend to ${APP_URL}"
echo "  2. (one-time) seed claude /login if you want anthropic-cc:"
echo "     az containerapp exec --name pm-copilot-api --resource-group ${RESOURCE_GROUP} -- /bin/sh"
echo "     # inside: claude /login"
