"""Realtime jobs: buffered checkpoints, their scheduling, and projection persistence."""

import asyncio
import base64
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.orm import load_only

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import RealtimeRenderConflict
from uniffy.core.realtime.buffer import BufferUnavailable, UpdateBuffer
from uniffy.core.realtime.dispatch import dispatch_due, run_checkpoint_job
from uniffy.core.realtime.maintenance import maintain_buffer
from uniffy.core.realtime.metrics import (
    REALTIME_BACKLOG_DEPTH,
    REALTIME_PROJECTION_OUTCOMES,
    REALTIME_SNAPSHOT_TASK_DURATION,
)
from uniffy.core.realtime.snapshot import persist_snapshot
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session
from uniffy.vendor.arq import Retry

logger = logger.bind(component="core.realtime.jobs")

RECOVERY_BATCH_SIZE = 100
CHECKPOINT_JOB_TIMEOUT_SECONDS = 120
DISPATCH_JOB_TIMEOUT_SECONDS = 30
MAINTENANCE_JOB_TIMEOUT_SECONDS = 120
CHECKPOINT_CONCURRENCY = 2
CHECKPOINT_SLOTS = asyncio.Semaphore(CHECKPOINT_CONCURRENCY)
_BUSY_DEFER_SECONDS = 1

_dispatch_skipping = False


async def checkpoint_realtime_document(
    ctx: dict[str, Any], member: str, claim: str
) -> dict[str, Any]:
    # Waiting for a slot would hold one of the fleet's shared job slots; requeue without a try.
    if CHECKPOINT_SLOTS.locked():
        raise Retry(defer=_BUSY_DEFER_SECONDS, count_attempt=False)
    async with CHECKPOINT_SLOTS:
        result = await run_checkpoint_job(UpdateBuffer(), member, claim)
    return {"status": result.status.value, "covered": result.covered}


async def dispatch_realtime_checkpoints(ctx: dict[str, Any]) -> dict[str, int]:
    global _dispatch_skipping

    try:
        report = await dispatch_due(UpdateBuffer())
    except BufferUnavailable:
        # The dispatcher ticks every second; one line per outage is enough.
        if not _dispatch_skipping:
            logger.opt(exception=True).warning(
                "Realtime checkpoint dispatch skips while Valkey is down"
            )
        _dispatch_skipping = True
        return {"enqueued": 0}
    if _dispatch_skipping:
        logger.info("Realtime checkpoint dispatch resumed")
    _dispatch_skipping = False
    return {"due": report.due, "early": report.early, "enqueued": report.enqueued}


async def maintain_realtime_buffer(ctx: dict[str, Any]) -> dict[str, int]:
    try:
        report = await maintain_buffer(UpdateBuffer())
    except BufferUnavailable:
        logger.warning("Realtime buffer maintenance skipped: Valkey is unavailable")
        return {"streams": 0}
    return {"streams": report.streams} | {
        action.value: count for action, count in report.actions.items()
    }


async def recover_realtime_projections(ctx: dict[str, Any]) -> None:
    async with open_session() as db:
        depth = await db.scalar(
            select(func.count())
            .select_from(RealtimeYjsSnapshot)
            .where(
                or_(
                    RealtimeYjsSnapshot.revision > RealtimeYjsSnapshot.rendered_revision,
                    RealtimeYjsSnapshot.effects_pending.is_(True),
                )
            )
        )
        REALTIME_BACKLOG_DEPTH.labels(kind="projection").set(depth or 0)
        pending = (
            (
                await db.execute(
                    select(RealtimeYjsSnapshot)
                    .where(
                        or_(
                            RealtimeYjsSnapshot.revision > RealtimeYjsSnapshot.rendered_revision,
                            RealtimeYjsSnapshot.effects_pending.is_(True),
                        ),
                        RealtimeYjsSnapshot.organization_id.is_not(None),
                    )
                    .options(
                        load_only(
                            RealtimeYjsSnapshot.organization_id,
                            RealtimeYjsSnapshot.updated_at,
                        )
                    )
                    .order_by(RealtimeYjsSnapshot.updated_at)
                    .limit(RECOVERY_BATCH_SIZE)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        # Rotate attempts before rendering so failed or trashed rows cannot starve later work.
        attempted_at = datetime.now(UTC)
        for snapshot in pending:
            snapshot.updated_at = attempted_at
        await db.commit()
    for snapshot in pending:
        if snapshot.organization_id is None:
            continue
        try:
            outcome = await persist_snapshot(
                snapshot.content_type, snapshot.content_id, snapshot.organization_id, b"", b""
            )
            REALTIME_PROJECTION_OUTCOMES.labels(outcome=outcome.value).inc()
        except Exception:
            REALTIME_PROJECTION_OUTCOMES.labels(outcome="failed").inc()
            logger.exception(
                "Realtime projection recovery failed", content_id=str(snapshot.content_id)
            )


async def save_realtime_snapshot(
    ctx: dict[str, Any],
    content_type_str: str,
    content_id_str: str,
    organization_id_str: str,
    update_b64: str,
    state_vector_b64: str,
    actor_id_str: str = "",
    encoded_at_iso: str = "",
) -> dict[str, Any]:
    content_type = ContentType(content_type_str)
    started = time.perf_counter()

    try:
        outcome = await persist_snapshot(
            content_type,
            UUID(content_id_str),
            UUID(organization_id_str),
            base64.b64decode(update_b64),
            base64.b64decode(state_vector_b64),
            actor_id=UUID(actor_id_str) if actor_id_str else None,
            encoded_at=datetime.fromisoformat(encoded_at_iso) if encoded_at_iso else None,
        )
    except RealtimeRenderConflict as exc:
        # Seconds, not the usual tens: the loser of a version race only needs the
        # competing metadata write to land, and the column should not lag the doc.
        raise Retry(defer=ctx.get("job_try", 1)) from exc
    finally:
        REALTIME_SNAPSHOT_TASK_DURATION.labels(content_type=content_type.value).observe(
            time.perf_counter() - started
        )

    REALTIME_PROJECTION_OUTCOMES.labels(outcome=outcome.value).inc()
    return {"status": outcome.value, "content_id": content_id_str}
