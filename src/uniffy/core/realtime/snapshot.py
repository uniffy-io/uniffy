"""Debounced snapshot writer; ``schedule`` arms a 5s timer, ``flush`` runs synchronously."""

import asyncio
import base64
import contextlib
import hashlib
import time
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

import pycrdt
from loguru import logger
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.jobs import JobEnqueueOutcome, enqueue_job_reconnecting
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import (
    RealtimeRenderConflict,
    RealtimeRenderSuperseded,
    get_realtime_adapter,
)
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.metrics import (
    REALTIME_RENDER_CONFLICTS_TOTAL,
    REALTIME_SNAPSHOT_DROPPED_TOTAL,
    REALTIME_SNAPSHOT_DURATION,
    REALTIME_SNAPSHOT_SUPERSEDED_TOTAL,
)
from uniffy.core.realtime.state import DocKey, YDocSession
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


async def _delete_snapshot(
    session: AsyncSession,
    content_type: ContentType,
    content_id: UUID,
    *,
    not_newer_than: datetime | None = None,
) -> None:
    stmt = delete(RealtimeYjsSnapshot).where(
        RealtimeYjsSnapshot.content_type == content_type,
        RealtimeYjsSnapshot.content_id == content_id,
    )
    if not_newer_than is not None:
        stmt = stmt.where(RealtimeYjsSnapshot.updated_at <= not_newer_than)
    await session.execute(stmt)
    await session.commit()


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
    """UPSERT the snapshot row and run the domain render.

    ``encoded_at`` orders the pipeline. The row's ``updated_at`` is the encode time, so an
    older payload never overwrites a newer row, and when no row existed (first flush, or a
    plain write deleted it) the adapter refuses to render over a domain row that a plain
    write updated after the encode. Both skips count on
    ``uniffy_realtime_snapshot_superseded_total``.
    """
    ydoc = pycrdt.Doc()
    ydoc.apply_update(update_bytes)
    encoded_at = encoded_at or datetime.now(UTC)
    content_type_label = content_type.value

    async with open_session() as session:
        had_row = (
            await session.execute(
                select(RealtimeYjsSnapshot.updated_at).where(
                    RealtimeYjsSnapshot.content_type == content_type,
                    RealtimeYjsSnapshot.content_id == content_id,
                )
            )
        ).scalar_one_or_none() is not None
        stmt = (
            pg_insert(RealtimeYjsSnapshot)
            .values(
                content_type=content_type,
                content_id=content_id,
                state_vector=state_vector,
                updates=update_bytes,
                created_at=encoded_at,
                updated_at=encoded_at,
            )
            .on_conflict_do_update(
                index_elements=["content_type", "content_id"],
                set_={
                    "state_vector": state_vector,
                    "updates": update_bytes,
                    "updated_at": encoded_at,
                },
                where=RealtimeYjsSnapshot.updated_at <= encoded_at,
            )
        )
        result = await session.execute(stmt)
        await session.commit()
        if not result.rowcount:
            REALTIME_SNAPSHOT_SUPERSEDED_TOTAL.labels(
                content_type=content_type_label, reason="newer_snapshot"
            ).inc()
            logger.info(
                f"snapshot for {content_type_label}:{content_id} superseded by a newer snapshot",
                component=LOGGER_COMPONENT,
            )
            return SnapshotOutcome.SUPERSEDED

        try:
            adapter = get_realtime_adapter(content_type)
        except LookupError:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="adapter_missing"
            ).inc()
            logger.warning(
                f"no adapter registered for {content_type_label}; "
                "snapshot persisted but domain render skipped",
                component=LOGGER_COMPONENT,
            )
            return SnapshotOutcome.SNAPSHOT_ONLY

        try:
            target_exists = await adapter.render_and_persist(
                session,
                ydoc,
                content_id,
                organization_id,
                actor_id=actor_id,
                supersede_after=None if had_row else encoded_at,
            )
            if not target_exists:
                await _delete_snapshot(session, content_type, content_id)
                REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                    content_type=content_type_label,
                    reason="target_missing",
                ).inc()
                return SnapshotOutcome.TARGET_MISSING
            await session.commit()
        except RealtimeRenderSuperseded:
            # The row this job inserted describes a superseded doc; drop it so the next
            # cold open hydrates from the column the plain write produced.
            await _delete_snapshot(session, content_type, content_id, not_newer_than=encoded_at)
            REALTIME_SNAPSHOT_SUPERSEDED_TOTAL.labels(
                content_type=content_type_label, reason="plain_write"
            ).inc()
            logger.info(
                f"snapshot for {content_type_label}:{content_id} superseded by a plain write",
                component=LOGGER_COMPONENT,
            )
            return SnapshotOutcome.SUPERSEDED
        except RealtimeRenderConflict:
            # The row above is committed; only the domain render is deferred to a retry.
            REALTIME_RENDER_CONFLICTS_TOTAL.labels(content_type=content_type_label).inc()
            raise
        except Exception:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=content_type_label, reason="adapter_error"
            ).inc()
            raise

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
