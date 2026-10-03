#!/usr/bin/env bash
set -euo pipefail

cd /app

if [[ "$(id -u)" == "0" && -n "${DEPS_USER:-}" ]]; then
    HOST_UID="$(id -u "$DEPS_USER")"
    HOST_GID="$(id -g "$DEPS_USER")"
fi

# When started as root with HOST_UID set (manage.py exports it on every
# invocation), fix volume ownership and re-exec as the host user so writes
# to the bind mount stay host-owned. /app itself is never chowned - it is
# the host checkout.
if [[ "$(id -u)" == "0" && -n "${HOST_UID:-}" ]]; then
    HOST_GID="${HOST_GID:-$HOST_UID}"
    for d in /pnpm-store /uv-cache /go-cache /app/.venv /app/node_modules \
        /app/src/ui/node_modules /app/src/mobile/node_modules \
        /app/src/landing/node_modules /app/src/proto/gen/typescript/node_modules \
        /app/src/e2e/node_modules; do
        if [[ -e "$d" && "$(stat -c %u:%g "$d")" != "$HOST_UID:$HOST_GID" ]]; then
            chown -R "$HOST_UID:$HOST_GID" "$d"
        fi
    done
    export HOME="${DEPS_HOME:-/tmp/home}"
    mkdir -p "$HOME"
    if [[ "$(stat -c %u:%g "$HOME")" != "$HOST_UID:$HOST_GID" ]]; then
        chown -R "$HOST_UID:$HOST_GID" "$HOME"
    fi
    if command -v setpriv >/dev/null 2>&1; then
        exec setpriv --reuid="$HOST_UID" --regid="$HOST_GID" --clear-groups "$0" "$@"
    fi
    echo "[deps-manager] setpriv missing - running as root; mounted writes will be root-owned" >&2
fi

# Both toolchains sync from their lockfiles before the command runs, each
# guarded by a hash marker inside its named volume so unchanged lockfiles
# skip the install.

UV_MARKER=/app/.venv/.uv-synced-from
UV_HASH=""
if [[ -f pyproject.toml ]]; then
    UV_HASH=$(sha256sum pyproject.toml uv.lock 2>/dev/null | sha256sum | cut -d' ' -f1)
fi
if [[ ! -f "$UV_MARKER" ]] || [[ "$(cat "$UV_MARKER" 2>/dev/null)" != "$UV_HASH" ]]; then
    echo "[deps-manager] uv sync (lockfile changed or first run)"
    uv sync --frozen
    echo "$UV_HASH" > "$UV_MARKER"
else
    echo "[deps-manager] uv sync skipped (lockfile unchanged)"
fi

PNPM_MARKER=/app/node_modules/.pnpm-synced-deps-manager
LOCK_HASH=""
if [[ -f pnpm-lock.yaml ]]; then
    LOCK_HASH=$(sha256sum pnpm-lock.yaml | cut -d' ' -f1)
fi
if [[ ! -f "$PNPM_MARKER" ]] || [[ "$(cat "$PNPM_MARKER" 2>/dev/null)" != "$LOCK_HASH" ]]; then
    echo "[deps-manager] pnpm install (full workspace)"
    pnpm install --frozen-lockfile --prefer-offline --config.strict-dep-builds=false --config.confirm-modules-purge=false
    echo "$LOCK_HASH" > "$PNPM_MARKER"
else
    echo "[deps-manager] pnpm install skipped (lockfile unchanged)"
fi

exec "$@"
