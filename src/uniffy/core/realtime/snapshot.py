"""Debounced snapshot writer; ``schedule`` arms a 5s timer, ``flush`` runs synchronously."""

import asyncio
import base64
import contextlib
import hashlib
import time
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from loguru import logger

from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.realtime.adapter import (
    RealtimeRenderConflict,
    get_realtime_adapter,
)
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.metrics import (
    REALTIME_SNAPSHOT_DROPPED_TOTAL,
    REALTIME_SNAPSHOT_DURATION,
)
from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.realtime.storage import decode_snapshot, load_snapshot, lock_document
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session

DEBOUNCE_SECONDS = 5.0
# Continuous edits re-arm the debounce forever; cap how long a doc may stay unflushed.
SNAPSHOT_MAX_DELAY = 30.0

LOGGER_COMPONENT = "realtime.snapshot"


class SnapshotOutcome(StrEnum):
    RENDERED = "rendered"
    SNAPSHOT_ONLY = "snapshot_only"
    TARGET_MISSING = "target_missing"
    SUPERSEDED = "superseded"


async def persist_snapshot(
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
    update_bytes: bytes,
    state_vector: bytes,
    *,
    actor_id: UUID | None = None,
    encoded_at: datetime | None = None,
) -> SnapshotOutcome:
    # Queued payloads are projection hints. Only committed state may replace a domain column.
    async with open_session() as db:
        key = (content_type, content_id)
        await lock_document(db, key, organization_id)
        snapshot = await load_snapshot(db, key)
        if snapshot is None or snapshot.organization_id != organization_id:
            return SnapshotOutcome.SUPERSEDED
        if snapshot.rendered_revision >= snapshot.revision:
            return SnapshotOutcome.RENDERED
        adapter = get_realtime_adapter(content_type)
        after_commit = await adapter.stage_render(
            db,
            decode_snapshot(snapshot),
            content_id,
            organization_id,
            actor_id=snapshot.actor_id,
        )
        if after_commit is None:
            await db.delete(snapshot)
            await db.commit()
            return SnapshotOutcome.TARGET_MISSING
        snapshot.rendered_revision = snapshot.revision
        await db.commit()
        await after_commit()
        return SnapshotOutcome.RENDERED


class SnapshotWriter:
    """Per-key debounce + enqueue orchestrator."""

    def __init__(
        self,
        debounce_seconds: float = DEBOUNCE_SECONDS,
        max_delay_seconds: float = SNAPSHOT_MAX_DELAY,
    ) -> None:
        self._debounce_seconds = debounce_seconds
        self._max_delay_seconds = max_delay_seconds
        self._tasks: dict[DocKey, asyncio.Task[None]] = {}
        self._first_scheduled: dict[DocKey, float] = {}
        self._lock = asyncio.Lock()

    async def schedule(self, session: YDocSession) -> None:
        """(Re)arm the debounce for ``session.key``; an overdue pending window flushes instead."""
        now = time.monotonic()
        flush_overdue = False
        async with self._lock:
            existing = self._tasks.get(session.key)
            if existing is not None and not existing.done():
                first = self._first_scheduled.get(session.key, now)
                if now - first >= self._max_delay_seconds:
                    flush_overdue = True
                else:
                    existing.cancel()
            if not flush_overdue:
                self._first_scheduled.setdefault(session.key, now)
                self._tasks[session.key] = asyncio.create_task(self._debounce_then_flush(session))
        if flush_overdue:
            await self.flush(session)

    async def flush(self, session: YDocSession, *, force: bool = False) -> None:
        """Encode current state; enqueue the ARQ task, or persist in-process when ``force``."""
        content_type, content_id = session.key
        content_type_label = content_type.value
        started = time.perf_counter()
        async with self._lock:
            task = self._tasks.pop(session.key, None)
            # The debounce task calls flush on itself; self-cancel would abort
            # the flush at its next suspension point and drop the snapshot.
            if task is not None and task is not asyncio.current_task() and not task.done():
                task.cancel()
            self._first_scheduled.pop(session.key, None)

        async with session.lock:
            update_bytes = session.ydoc.get_update()
            state_vector = session.ydoc.get_state()
            # Taken under the lock so it orders this payload against every other flush.
            encoded_at = datetime.now(UTC)

        if not update_bytes:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="ydoc_empty"
            ).inc()
            return

        actor_id = session.last_editor_id
        if force:
            # Eviction must not depend on queue availability; write in-process.
            try:
                await persist_snapshot(
                    content_type,
                    content_id,
                    session.organization_id,
                    update_bytes,
                    state_vector,
                    actor_id=actor_id,
                    encoded_at=encoded_at,
                )
                return
            except RealtimeRenderConflict:
                # No retry loop here; the worker owns it, so hand the render over.
                logger.warning(
                    f"eviction render contended for {content_type_label}:{content_id}; queueing",
                    component=LOGGER_COMPONENT,
                )

        # Dedup keyed on the payload hash, not just ``(content_type, content_id)``.
        # ARQ caches completed-job results for ``WORKER_KEEP_RESULT`` seconds; a
        # static id would silently drop every subsequent enqueue for that window
        # and freeze persistence.
        content_hash = hashlib.sha256(update_bytes).hexdigest()[:16]
        enqueue_result = await enqueue_job_reconnecting(
            SAVE_REALTIME_SNAPSHOT,
            content_type.value,
            str(content_id),
            str(session.organization_id),
            base64.b64encode(update_bytes).decode("ascii"),
            base64.b64encode(state_vector).decode("ascii"),
            str(actor_id) if actor_id is not None else "",
            encoded_at.isoformat(),
            _job_id=f"snapshot:{content_type_label}:{content_id}:{content_hash}",
        )
        if enqueue_result.outcome is JobEnqueueOutcome.UNAVAILABLE:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="queue_unavailable"
            ).inc()
            logger.warning(
                f"core queue unavailable, dropping snapshot for {content_type_label}:{content_id}",
                component=LOGGER_COMPONENT,
            )
            return
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
            self._first_scheduled.pop(key, None)
            task = self._tasks.pop(key, None)
            if task is not None and not task.done():
                task.cancel()
                with contextlib.suppress(BaseException):
                    await task


snapshot_writer = SnapshotWriter()
