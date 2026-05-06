#!/usr/bin/env bash
set -euo pipefail

cd /app

# PNPM_FILTER controls which workspace gets installed (and its transitive
# workspace deps). Trailing "..." includes deps. Set per service in compose.
# Defaults to the full workspace if unset.
FILTER="${PNPM_FILTER:-}"

# Per-workspace marker so multiple node containers can share the same
# bind-mounted /app without trampling each other's install state.
MARKER_NAME="${PNPM_FILTER:-all}"
SYNC_MARKER="/app/node_modules/.pnpm-synced-${MARKER_NAME//\//_}"
LOCK_HASH=""

if [[ -f pnpm-lock.yaml ]]; then
    LOCK_HASH=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
fi

if [[ ! -f "$SYNC_MARKER" ]] || [[ "$(cat "$SYNC_MARKER" 2>/dev/null)" != "$LOCK_HASH" ]]; then
    if [[ -n "$FILTER" ]]; then
        echo "[entrypoint] pnpm install --filter ${FILTER}"
        pnpm install --frozen-lockfile --prefer-offline --filter "$FILTER"
    else
        echo "[entrypoint] pnpm install (full workspace)"
        pnpm install --frozen-lockfile --prefer-offline
    fi
    echo "$LOCK_HASH" > "$SYNC_MARKER"
else
    echo "[entrypoint] pnpm install skipped (lockfile unchanged)"
fi

exec "$@"
