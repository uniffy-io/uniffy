"""Provision audit partitions ahead of month boundaries."""

from __future__ import annotations

from typing import Any

from loguru import logger

from uniffy.core.audit.partitions import ensure_audit_partitions
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client

logger = logger.bind(component="audit.jobs.jobs")

_LOCK_KEY = "audit_partitions:lock"
PROVISION_AUDIT_PARTITIONS_JOB_TIMEOUT_SECONDS = 300
_LOCK_TTL_SECONDS = PROVISION_AUDIT_PARTITIONS_JOB_TIMEOUT_SECONDS + 30


async def _acquire_lock() -> str | None:
    client = get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(client, _LOCK_KEY, _LOCK_TTL_SECONDS)
    except Exception:
        logger.warning("audit_partitions: SET NX failed")
        return None


async def _release_lock(token: str) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(client, _LOCK_KEY, token)
    except Exception:
        logger.warning("audit_partitions: DEL failed")


async def provision_audit_partitions(ctx: dict[str, Any]) -> dict[str, Any]:
    """Create the audit partitions for the coming months that do not exist yet."""
    del ctx
    lock_token = await _acquire_lock()
    if lock_token is None:
        return {"status": "skipped", "reason": "lock_held"}

    try:
        async with open_session() as session:
            created = await ensure_audit_partitions(session)
            await session.commit()
        if created:
            logger.info(f"Created audit partitions: {', '.join(created)}")
        return {"status": "success", "created": created}
    except Exception as exc:
        logger.exception(f"audit_partitions failed: {exc}")
        return {"status": "error", "error": str(exc)[:500]}
    finally:
        await _release_lock(lock_token)
