"""ARQ task: persist a Yjs snapshot + run domain-side render.

Idempotent: ``(content_type, content_id)`` UPSERTs and
``adapter.render_and_persist`` must be no-op for the same YDoc state.
"""

import base64
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pycrdt
from loguru import logger
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.types import ContentType
from uniffy.db.session import open_session

# Adapter registration is an import side effect. The worker process
# runs a different import graph than the backend, so import here to
# force registration when the task module loads.
from uniffy.domains.notes import realtime_adapter as _notes_realtime_adapter  # noqa: F401
from uniffy.observability.metrics import (
    REALTIME_SNAPSHOT_DROPPED_TOTAL,
    REALTIME_SNAPSHOT_TASK_DURATION,
)

LOGGER_COMPONENT = "realtime.snapshot_task"


async def save_realtime_snapshot(
    ctx: dict[str, Any],
    content_type_str: str,
    content_id_str: str,
    organization_id_str: str,
    update_b64: str,
    state_vector_b64: str,
) -> dict[str, Any]:
    """Persist a snapshot blob and trigger the domain-side render."""
    del ctx

    content_type = ContentType(content_type_str)
    content_id = UUID(content_id_str)
    organization_id = UUID(organization_id_str)
    update_bytes = base64.b64decode(update_b64)
    state_vector = base64.b64decode(state_vector_b64)
    started = time.perf_counter()

    ydoc = pycrdt.Doc()
    ydoc.apply_update(update_bytes)

    now = datetime.now(UTC)

    async with open_session() as session:
        stmt = (
            pg_insert(RealtimeYjsSnapshot)
            .values(
                content_type=content_type,
                content_id=content_id,
                state_vector=state_vector,
                updates=update_bytes,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=["content_type", "content_id"],
                set_={
                    "state_vector": state_vector,
                    "updates": update_bytes,
                    "updated_at": now,
                },
            )
        )
        await session.execute(stmt)
        await session.commit()

        try:
            adapter = get_realtime_adapter(content_type)
        except LookupError:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type.value, reason="adapter_missing"
            ).inc()
            REALTIME_SNAPSHOT_TASK_DURATION.labels(
                content_type=content_type.value
            ).observe(time.perf_counter() - started)
            logger.warning(
                f"no adapter registered for {content_type.value}; "
                "snapshot persisted but domain render skipped",
                component=LOGGER_COMPONENT,
            )
            return {"status": "snapshot_only", "content_id": content_id_str}

        try:
            await adapter.render_and_persist(session, ydoc, content_id, organization_id)
            await session.commit()
        except Exception:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type.value, reason="adapter_error"
            ).inc()
            raise
        finally:
            REALTIME_SNAPSHOT_TASK_DURATION.labels(
                content_type=content_type.value
            ).observe(time.perf_counter() - started)

    return {"status": "ok", "content_id": content_id_str}
