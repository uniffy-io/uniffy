#!/usr/bin/env bash
set -euo pipefail

cd /app

# When started as root with HOST_UID set (manage.py exports it on every
# invocation), fix volume ownership and re-exec as the host user so writes
# to the bind mount stay host-owned. /app itself is never chowned - it is
# the host checkout.
if [[ "$(id -u)" == "0" && -n "${HOST_UID:-}" ]]; then
    HOST_GID="${HOST_GID:-$HOST_UID}"
    for d in /uv-cache /app/.venv /app/.ruff_cache /app/.pytest_cache; do
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

SYNC_MARKER=/app/.venv/.uv-synced-from
PYPROJECT_HASH=""

if [[ -f pyproject.toml ]]; then
    PYPROJECT_HASH=$(sha256sum pyproject.toml uv.lock 2>/dev/null | sha256sum | cut -d' ' -f1)
fi

if [[ ! -f "$SYNC_MARKER" ]] || [[ "$(cat "$SYNC_MARKER" 2>/dev/null)" != "$PYPROJECT_HASH" ]]; then
    echo "[entrypoint] uv sync (lockfile changed or first run)"
    uv sync --frozen
    echo "$PYPROJECT_HASH" > "$SYNC_MARKER"
else
    echo "[entrypoint] uv sync skipped (lockfile unchanged)"
fi

exec "$@"
