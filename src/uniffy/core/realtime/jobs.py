"""Persist realtime snapshots through registered content adapters."""

import base64
import time
from typing import Any
from uuid import UUID

from uniffy.core.realtime.metrics import REALTIME_SNAPSHOT_TASK_DURATION
from uniffy.core.realtime.snapshot import persist_snapshot
from uniffy.core.types import ContentType


async def save_realtime_snapshot(
    ctx: dict[str, Any],
    content_type_str: str,
    content_id_str: str,
    organization_id_str: str,
    update_b64: str,
    state_vector_b64: str,
) -> dict[str, Any]:
    del ctx

    content_type = ContentType(content_type_str)
    started = time.perf_counter()

    try:
        rendered = await persist_snapshot(
            content_type,
            UUID(content_id_str),
            UUID(organization_id_str),
            base64.b64decode(update_b64),
            base64.b64decode(state_vector_b64),
        )
    finally:
        REALTIME_SNAPSHOT_TASK_DURATION.labels(content_type=content_type.value).observe(
            time.perf_counter() - started
        )

    if not rendered:
        return {"status": "snapshot_only", "content_id": content_id_str}
    return {"status": "ok", "content_id": content_id_str}
