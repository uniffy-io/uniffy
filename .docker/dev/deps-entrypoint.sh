#!/usr/bin/env bash
set -euo pipefail

cd /app

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
