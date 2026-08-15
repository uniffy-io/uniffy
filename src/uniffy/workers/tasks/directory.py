"""ARQ task: run one identity-source directory sync.

Idempotent via a Valkey `SET NX` lock keyed `directory:sync:{source_id}` so a
double-enqueued Trigger cannot race two runs against the same source.
"""

from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import ValidationError
from uniffy.core.models.people.identity import IdentitySource
from uniffy.core.valkey.ops import _get_ops_client
from uniffy.db import open_session
from uniffy.domains.people.directory.reconcile import run_full_sync
from uniffy.domains.people.directory.registry import build_provider
from uniffy.vendor.arq import Retry

logger = logger.bind(component="tasks.directory")

_LOCK_TTL_SECONDS = 900
_LOCK_KEY_TEMPLATE = "directory:sync:{source_id}"


async def _acquire_lock(source_id: UUID) -> bool:
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(
            await client.set(
                _LOCK_KEY_TEMPLATE.format(source_id=source_id),
                "1",
                ex=_LOCK_TTL_SECONDS,
                nx=True,
            )
        )
    except Exception:
        logger.warning(f"sync_identity_source: lock SET NX failed for {source_id}")
        return False


async def _release_lock(source_id: UUID) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY_TEMPLATE.format(source_id=source_id))
    except Exception:
        logger.warning(f"sync_identity_source: lock DEL failed for {source_id}")


async def _mark_failed(source_id: UUID, error: str) -> None:
    try:
        async with open_session() as session:
            source = (
                await session.execute(select(IdentitySource).where(IdentitySource.id == source_id))
            ).scalar_one_or_none()
            if source is not None:
                source.last_sync_status = "failed"
                source.last_sync_error = error[:2000]
                await session.commit()
    except Exception:
        logger.exception(f"sync_identity_source: failed-status write lost for {source_id}")


async def sync_identity_source(ctx: dict[str, Any], source_id: str) -> dict[str, Any]:
    try:
        sid = UUID(source_id)
    except ValueError:
        logger.error(f"sync_identity_source: invalid source_id {source_id}")
        return {"status": "error", "error": "invalid_uuid"}

    if not await _acquire_lock(sid):
        return {"status": "skipped", "reason": "lock_held", "source_id": source_id}

    try:
        async with open_session() as session:
            source = (
                await session.execute(select(IdentitySource).where(IdentitySource.id == sid))
            ).scalar_one_or_none()
            if source is None:
                return {"status": "not_found", "source_id": source_id}
            if not source.is_active:
                return {"status": "skipped", "reason": "inactive", "source_id": source_id}

            provider = await build_provider(session, source)
            report = await run_full_sync(session, source, provider)
            return {"status": "complete", **report.as_dict()}
    except ValidationError as e:
        # Misconfiguration is permanent; retrying cannot fix it.
        await _mark_failed(sid, str(e))
        return {"status": "failed", "error": str(e)}
    except Exception as e:
        logger.exception(f"sync_identity_source failed for {source_id}")
        await _mark_failed(sid, str(e))
        raise Retry(defer=ctx["job_try"] * 10) from e
    finally:
        await _release_lock(sid)
