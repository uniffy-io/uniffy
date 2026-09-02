"""Debounced snapshot writer; ``schedule`` arms a 5s timer, ``flush`` runs synchronously."""

import asyncio
import base64
import contextlib
import hashlib
import time
from datetime import UTC, datetime
from uuid import UUID

import pycrdt
from loguru import logger
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert

from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.metrics import (
    REALTIME_SNAPSHOT_DROPPED_TOTAL,
    REALTIME_SNAPSHOT_DURATION,
)
from uniffy.core.realtime.state import DocKey, YDocSession
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session

DEBOUNCE_SECONDS = 5.0
# Continuous edits re-arm the debounce forever; cap how long a doc may stay unflushed.
SNAPSHOT_MAX_DELAY = 30.0

LOGGER_COMPONENT = "realtime.snapshot"


async def persist_snapshot(
    content_type: ContentType,
    content_id: UUID,
    organization_id: UUID,
    update_bytes: bytes,
    state_vector: bytes,
) -> bool:
    """UPSERT the snapshot row and run the domain render; ``False`` when no adapter is registered."""
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
            logger.warning(
                f"no adapter registered for {content_type.value}; "
                "snapshot persisted but domain render skipped",
                component=LOGGER_COMPONENT,
            )
            return False

        try:
            target_exists = await adapter.render_and_persist(
                session,
                ydoc,
                content_id,
                organization_id,
            )
            if not target_exists:
                await session.execute(
                    delete(RealtimeYjsSnapshot).where(
                        RealtimeYjsSnapshot.content_type == content_type,
                        RealtimeYjsSnapshot.content_id == content_id,
                    )
                )
                await session.commit()
                REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                    content_type=content_type.value,
                    reason="target_missing",
                ).inc()
                return False
            await session.commit()
        except Exception:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type.value, reason="adapter_error"
            ).inc()
            raise

    return True


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

        if not update_bytes:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="ydoc_empty"
            ).inc()
            return

        if force:
            # Eviction must not depend on queue availability; write in-process.
            await persist_snapshot(
                content_type,
                content_id,
                session.organization_id,
                update_bytes,
                state_vector,
            )
            return

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
