#!/bin/sh
# docker-entrypoint.sh — wires the persistent volume into the two
# locations the runtime expects state at:
#
#   /var/data/cache    →  CACHE_DIR for apps/server/src/persist.ts
#                         (snapshot.json read/written by the brief +
#                         ask cache layer)
#   /var/data/claude   →  /root/.claude (symlinked) for the anthropic-cc
#                         subprocess provider's OAuth state. Survives
#                         container restarts so `claude /login` is a
#                         one-time setup per environment.
#
# Railway mounts a single Volume at /var/data. We split it into the two
# subdirectories so both pieces of state share one volume cleanly.
#
# This script is idempotent: it can run on every container start.

set -eu

mkdir -p /var/data/cache /var/data/claude

# Symlink ~/.claude → /var/data/claude. If a stale symlink exists (or
# nothing exists), replace it. If a real directory somehow ended up at
# /root/.claude (shouldn't happen in production but keeps local-dev
# bind-mounts working), leave it alone.
if [ -L /root/.claude ] || [ ! -e /root/.claude ]; then
  rm -f /root/.claude
  ln -s /var/data/claude /root/.claude
fi

exec "$@"
