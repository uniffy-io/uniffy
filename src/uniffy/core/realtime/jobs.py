"""Persist realtime snapshots through registered content adapters."""

import base64
import time
from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import RealtimeRenderConflict
from uniffy.core.realtime.metrics import REALTIME_SNAPSHOT_TASK_DURATION
from uniffy.core.realtime.snapshot import persist_snapshot
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session
from uniffy.vendor.arq import Retry

logger = logger.bind(component="core.realtime.jobs")


async def recover_realtime_projections(ctx: dict[str, Any]) -> None:
    async with open_session() as db:
        pending = (
            (
                await db.execute(
                    select(RealtimeYjsSnapshot)
                    .where(
                        RealtimeYjsSnapshot.revision > RealtimeYjsSnapshot.rendered_revision,
                    )
                    .order_by(RealtimeYjsSnapshot.updated_at)
                    .limit(100)
                )
            )
            .scalars()
            .all()
        )
    for snapshot in pending:
        if snapshot.organization_id is None:
            continue
        try:
            await persist_snapshot(
                snapshot.content_type, snapshot.content_id, snapshot.organization_id, b"", b""
            )
        except Exception:
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

    return {"status": outcome.value, "content_id": content_id_str}
