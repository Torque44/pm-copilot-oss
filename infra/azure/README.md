# Azure deployment artifacts

This directory holds the Bicep template, deploy script, and runbook for
deploying the pm-copilot backend to Azure Container Apps. Frontend lives
on Cloudflare Pages (see `apps/web/wrangler.toml` and the root README).

Files (added during Phase 2 of the cf-azure-rewrite):

- `main.bicep` — Container App + Azure Files share + volume mounts + secrets
- `deploy.sh` — `az containerapp up` wrapper for a one-shot deploy
- `parameters.json` — environment-specific parameter values
- `dev.yml` — docker-compose for local "Azure-shaped" testing (Azurite + container)

See `docs/AZURE_DEPLOY.md` for the runbook including the one-time
`claude /login` setup for the anthropic-cc subprocess provider.
