"""Daily cron: keep ``audit_events`` monthly partitions provisioned ahead of now.

Without this the table runs out of partitions at a month boundary and every
audited operation starts failing on the INSERT. Idempotent via
``SET NX audit_partitions:lock`` and via the create-if-missing check itself.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from uniffy.core.audit.partitions import ensure_audit_partitions
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db.session import open_session

logger = logger.bind(component="tasks.audit_partitions")

_LOCK_KEY = "audit_partitions:lock"
_LOCK_TTL_SECONDS = 300


async def _acquire_lock() -> bool:
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(await client.set(_LOCK_KEY, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except Exception:
        logger.warning("audit_partitions: SET NX failed")
        return False


async def _release_lock() -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY)
    except Exception:
        logger.warning("audit_partitions: DEL failed")


async def provision_audit_partitions(ctx: dict[str, Any]) -> dict[str, Any]:
    """Create the audit partitions for the coming months that do not exist yet."""
    del ctx
    if not await _acquire_lock():
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
        await _release_lock()
