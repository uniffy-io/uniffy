"""Debounced snapshot writer; ``schedule`` arms a 5s timer, ``flush`` runs synchronously."""

import asyncio
import base64
import contextlib
import hashlib
import time

from loguru import logger

from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.valkey.queue import get_queue_safe
from uniffy.observability.metrics import (
    REALTIME_SNAPSHOT_DROPPED_TOTAL,
    REALTIME_SNAPSHOT_DURATION,
)

DEBOUNCE_SECONDS = 5.0

LOGGER_COMPONENT = "realtime.snapshot"


class SnapshotWriter:
    """Per-key debounce + enqueue orchestrator."""

    def __init__(self, debounce_seconds: float = DEBOUNCE_SECONDS) -> None:
        self._debounce_seconds = debounce_seconds
        self._tasks: dict[DocKey, asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    async def schedule(self, session: YDocSession) -> None:
        """(Re)arm the debounce timer for ``session.key``."""
        async with self._lock:
            existing = self._tasks.get(session.key)
            if existing is not None and not existing.done():
                existing.cancel()
            self._tasks[session.key] = asyncio.create_task(
                self._debounce_then_flush(session)
            )

    async def flush(self, session: YDocSession, *, force: bool = False) -> None:
        """Encode current state and hand it to the ARQ task. The task is idempotent (UPSERT)."""
        del force
        content_type, content_id = session.key
        content_type_label = content_type.value
        started = time.perf_counter()
        async with self._lock:
            task = self._tasks.pop(session.key, None)
            if task is not None and not task.done():
                task.cancel()

        async with session.lock:
            update_bytes = session.ydoc.get_update()
            state_vector = session.ydoc.get_state()

        if not update_bytes:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="ydoc_empty"
            ).inc()
            return

        queue = await get_queue_safe("core")
        if queue is None:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="queue_unavailable"
            ).inc()
            logger.warning(
                f"core queue unavailable, dropping snapshot for "
                f"{content_type_label}:{content_id}",
                component=LOGGER_COMPONENT,
            )
            return

        # Dedup keyed on the payload hash, not just ``(content_type, content_id)``.
        # ARQ caches completed-job results for ``WORKER_KEEP_RESULT`` seconds; a
        # static id would silently drop every subsequent enqueue for that window
        # and freeze persistence.
        content_hash = hashlib.sha256(update_bytes).hexdigest()[:16]
        await queue.enqueue_job(
            "save_realtime_snapshot",
            content_type.value,
            str(content_id),
            str(session.organization_id),
            base64.b64encode(update_bytes).decode("ascii"),
            base64.b64encode(state_vector).decode("ascii"),
            _job_id=f"snapshot:{content_type_label}:{content_id}:{content_hash}",
        )
        REALTIME_SNAPSHOT_DURATION.labels(content_type=content_type_label).observe(
            time.perf_counter() - started
        )

    async def _debounce_then_flush(self, session: YDocSession) -> None:
        try:
            await asyncio.sleep(self._debounce_seconds)
        except asyncio.CancelledError:
            return
        try:
            await self.flush(session)
        except Exception as exc:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=session.key[0].value, reason="flush_error"
            ).inc()
            logger.exception(
                f"debounced snapshot flush failed: {exc}",
                component=LOGGER_COMPONENT,
            )

    async def cancel(self, key: DocKey) -> None:
        """Cancel any pending debounce timer (no flush)."""
        async with self._lock:
            task = self._tasks.pop(key, None)
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(BaseException):
                    await task


snapshot_writer = SnapshotWriter()
