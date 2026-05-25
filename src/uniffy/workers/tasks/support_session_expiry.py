"""ARQ cron: flip ACTIVE/PENDING support sessions past ``expires_at``.

Runs every 60 seconds. Picks rows where ``state IN (ACTIVE, PENDING)``
and ``expires_at <= now()`` and flips them to ``EXPIRED``, drops the
Valkey hot-cache entry, and writes an audit row.

Idempotent across the worker fleet via a Valkey ``SET NX`` lock; on
lock miss the second pod no-ops. ``sweep_expired`` is also internally
idempotent (the WHERE clause naturally excludes rows already in a
terminal state), so even a missed lock release is harmless.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.platform.support_session.operations import (
    SupportSessionOperations,
)

_LOCK_KEY = "support_session_expiry:lock"
_LOCK_TTL_SECONDS = 120


async def _acquire_lock() -> bool:
    """Try to acquire the expiry lock. Returns True on success."""
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(await client.set(_LOCK_KEY, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except Exception:
        logger.warning("support_session_expiry: SET NX failed")
        return False


async def _release_lock() -> None:
    """Release the expiry lock (best-effort)."""
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY)
    except Exception:
        logger.warning("support_session_expiry: DEL failed")


async def expire_support_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """Sweep timed-out support sessions to EXPIRED."""
    del ctx
    if not await _acquire_lock():
        return {"status": "skipped", "reason": "lock_held"}

    try:
        async with open_session() as session:
            flipped = await SupportSessionOperations(session).sweep_expired()
        return {"status": "success", "expired": flipped}
    except Exception as exc:
        logger.exception(f"support_session_expiry failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock()
