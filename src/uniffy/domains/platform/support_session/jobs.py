"""Expire active or pending support sessions after their deadline."""

from __future__ import annotations

from typing import Any

from loguru import logger

from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session
from uniffy.domains.platform.support_session.operations import (
    SupportSessionOperations,
)

logger = logger.bind(component="platform.support_session.jobs")

_LOCK_KEY = "support_session_expiry:lock"
EXPIRE_SUPPORT_SESSIONS_JOB_TIMEOUT_SECONDS = 300
_LOCK_TTL_SECONDS = EXPIRE_SUPPORT_SESSIONS_JOB_TIMEOUT_SECONDS + 30


async def _acquire_lock() -> str | None:
    client = _get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, _LOCK_KEY, _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning("support_session_expiry: SET NX failed")
        return None


async def _release_lock(token: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _LOCK_KEY, token)
    except Exception:
        logger.warning("support_session_expiry: DEL failed")


async def expire_support_sessions(ctx: dict[str, Any]) -> dict[str, Any]:
    """Sweep timed-out support sessions to EXPIRED."""
    del ctx
    lock_token = await _acquire_lock()
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held"}

    try:
        async with open_session() as session:
            flipped = await SupportSessionOperations(session).sweep_expired()
        return {"status": "success", "expired": flipped}
    except Exception as exc:
        logger.exception(f"support_session_expiry failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(lock_token)
