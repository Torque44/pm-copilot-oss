# pm-copilot backend container — runs the Express HTTP server with the
# Claude Code CLI installed for the anthropic-cc subprocess provider.
#
# Built once and pushed to the Azure Container Apps registry; deploy via
# infra/azure/deploy.sh. The image runs as `node` (uid 1000) by default;
# the volume mounts (CACHE_DIR + ~/.claude) are written as that user.
#
# IMPORTANT — anthropic-cc auth lifecycle:
#   The first time this container deploys, the operator runs `claude /login`
#   inside it (`az containerapp exec ...`) to seed the OAuth state into
#   /root/.claude (mounted from Azure Files). State persists across
#   restarts and revision rollouts. See docs/AZURE_DEPLOY.md.

FROM node:20-slim

WORKDIR /app

# Tools the runtime needs:
#   - corepack: shipped with Node 20, enables pnpm without a global install
#   - the Claude Code CLI: invoked as `claude -p "..."` by the
#     anthropic-cc provider in packages/core/src/providers/anthropic.ts
RUN corepack enable && \
    npm install -g @anthropic-ai/claude-code

# Copy the workspace manifests first so Docker can cache the deps layer.
# Each subsequent code change only re-runs the COPY of source + install
# of any new deps, not the whole dependency graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/

RUN pnpm install --frozen-lockfile

# Now bring in the actual source.
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/
COPY packages/core/ packages/core/

# Build the React bundle so apps/server serves it from the same origin.
# VITE_API_BASE is intentionally unset — the web client falls back to
# relative `/api/...` paths, which point at this same container.
#
# We invoke `vite build` directly instead of `pnpm -F @pm-copilot/web
# build` (which is `tsc -b && vite build`). The TS pre-check step blows
# up on type drift between vite@5 (pulled transitively by vitest) and
# vite@6 (pinned by the web app) — a workspace-deps quirk that doesn't
# affect the actual bundle. Type-checking runs in CI separately; the
# prod image only needs the artifact.
RUN pnpm -F @pm-copilot/web exec vite build

# Defaults. The runtime host (Render / Railway / Azure / etc.) overrides
# PORT via its own env. CACHE_DIR points at the persistent volume mount;
# persist.ts writes snapshot.json there so it survives restarts.
ENV CACHE_DIR=/var/data/cache
ENV NODE_ENV=production
ENV PORT=8787

# Entrypoint script wires the persistent volume into the two locations
# the runtime needs (CACHE_DIR + /root/.claude). Idempotent — runs on
# every container start. See apps/server/docker-entrypoint.sh.
COPY apps/server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# The image listens on PORT (8787 by default). The host platform
# (Railway / Container Apps / etc.) maps this to its public ingress.
EXPOSE 8787

# Run via tsx — same entry the existing `pnpm start` script uses on Render.
# tsx + typescript are runtime deps in apps/server/package.json so they
# survive the production install.
CMD ["pnpm", "-F", "@pm-copilot/server", "start"]
