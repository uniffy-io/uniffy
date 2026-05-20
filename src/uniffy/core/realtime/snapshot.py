"""Debounced snapshot writer for realtime Yjs sessions.

``schedule(session)`` (re)arms a 5s per-key timer; on fire, the YDoc
state is encoded and handed to the ``save_realtime_snapshot`` ARQ task
which writes ``realtime_yjs_snapshots`` and invokes
``adapter.render_and_persist`` on a worker. ``flush(session)`` runs
synchronously and is used on idle-eviction.
"""

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

# Short enough to feel "near-realtime" on tab reload, long enough to
# coalesce typing bursts into one job per doc.
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
        """Encode current state and hand it to the ARQ task.

        Cancels any pending debounce timer. ``force`` is informational;
        both paths run the same enqueue flow because the ARQ task is
        idempotent (UPSERT).
        """
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

        # Dedup is keyed by the update-bytes hash, not just
        # ``(content_type, content_id)``. ARQ stores completed-job
        # results for ``WORKER_KEEP_RESULT`` seconds; a static id would
        # silently drop every subsequent enqueue for that window,
        # freezing persistence. Hashing the payload keeps same-state
        # dedup while letting any new edit through.
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
        """Cancel any pending debounce timer for ``key`` (no flush)."""
        async with self._lock:
            task = self._tasks.pop(key, None)
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(BaseException):
                    await task


snapshot_writer = SnapshotWriter()
