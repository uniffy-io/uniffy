#!/usr/bin/env bash
set -euo pipefail

cd /app

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
