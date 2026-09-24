#!/usr/bin/env bash
set -euo pipefail

cd /app

# When started as root with HOST_UID set (manage.py exports it on every
# invocation), fix volume ownership and re-exec as the host user so writes
# to the bind mount stay host-owned. /app itself is never chowned - it is
# the host checkout.
if [[ "$(id -u)" == "0" && -n "${HOST_UID:-}" ]]; then
    HOST_GID="${HOST_GID:-$HOST_UID}"
    for d in /pnpm-store /app/node_modules /app/src/ui/node_modules \
        /app/src/mobile/node_modules /app/src/landing/node_modules \
        /app/src/proto/gen/typescript/node_modules /app/src/e2e/node_modules; do
        if [[ -e "$d" && "$(stat -c %u "$d")" != "$HOST_UID" ]]; then
            chown -R "$HOST_UID:$HOST_GID" "$d"
        fi
    done
    export HOME=/tmp/home
    mkdir -p "$HOME" && chown "$HOST_UID:$HOST_GID" "$HOME"
    if command -v setpriv >/dev/null 2>&1; then
        exec setpriv --reuid="$HOST_UID" --regid="$HOST_GID" --clear-groups "$0" "$@"
    fi
    echo "[entrypoint] setpriv missing - running as root; mounted writes will be root-owned" >&2
fi

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
    # `--config.strict-dep-builds=false` keeps ignored native build scripts
    # (canvas, esbuild) as a warning instead of a hard CI failure - we don't
    # need them in the dev container.
    # CI=true only for the install (non-interactive pnpm); container-wide it
    # would make Metro/Expo disable watch mode and kill hot reload.
    PNPM_ARGS=(--frozen-lockfile --prefer-offline --config.strict-dep-builds=false --config.confirm-modules-purge=false)
    if [[ -n "$FILTER" ]]; then
        echo "[entrypoint] pnpm install --filter ${FILTER}"
        CI=true pnpm install "${PNPM_ARGS[@]}" --filter "$FILTER"
    else
        echo "[entrypoint] pnpm install (full workspace)"
        CI=true pnpm install "${PNPM_ARGS[@]}"
    fi
    echo "$LOCK_HASH" > "$SYNC_MARKER"
else
    echo "[entrypoint] pnpm install skipped (lockfile unchanged)"
fi

exec "$@"
