"""Rotating buffer maintenance: repair lost scheduling and cleanup, reclaim what nothing needs."""

import contextlib
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from loguru import logger
from sqlalchemy import Row, select, tuple_, update

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    LAYOUT_VERSION,
    BufferedUpdate,
    BufferScope,
    KeyKind,
    buffer_keys,
    key_pattern,
    parse_record,
    scopes_of_keys,
)
from uniffy.core.realtime.checkpoint import (
    CheckpointStatus,
    buffer_client,
    buffer_errors,
    checkpoint_document,
    clean_checkpoint,
)
from uniffy.core.realtime.dispatch import back_off, claim_key, valkey_now
from uniffy.core.realtime.metrics import (
    REALTIME_BUFFER_MAINTENANCE_CYCLE_SECONDS,
    REALTIME_BUFFER_RECLAIMED_TOTAL,
    REALTIME_BUFFER_RETIRED_RECORDS_DROPPED_TOTAL,
    REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL,
)
from uniffy.core.realtime.preflight import ensure_buffer_ready
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import lock_document
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import server_identity

logger = logger.bind(component="core.realtime.maintenance")

MAINTENANCE_SCAN_CALLS = 20
MAINTENANCE_DOCUMENTS = 1000
# Each pass recounts one bucket's pending totals; the bucket advances once per period.
REPAIR_ROTATION_MS = 60_000
# A checkpointed epoch without an append for this long gives up its keys. The next live read
# starts a fresh epoch, so the interval trades idle key memory against one epoch start.
IDLE_RECLAIM_MS = 60 * 60 * 1000
# Records a retired epoch kept past a gap stay this long for investigation, then go and are counted.
RETIRED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
_SCAN_COUNT = 1000
_DOCUMENT_KEYS = (KeyKind.STREAM, KeyKind.CONTROL)
_RETIRED_STATUSES = (CheckpointStatus.STALE, CheckpointStatus.OBSOLETE)


class MaintenanceAction(StrEnum):
    SKIPPED = "skipped"
    KEPT = "kept"
    CLEANED = "cleaned"
    RESCHEDULED = "rescheduled"
    RECLAIMED = "reclaimed"
    DROPPED = "dropped"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class MaintenanceReport:
    documents: int
    cycle_complete: bool
    actions: dict[MaintenanceAction | CheckpointStatus, int]


@dataclass(frozen=True, slots=True)
class _Observed:
    """One document's keys as read without the lock; decisions that delete recheck under it."""

    claimed: bool
    head: int | None
    # Zero when the control records no append time.
    last_ms: int
    due: bool
    oldest: BufferedUpdate | None
    # Acceptance time of the newest record; ``None`` without records, zero when unreadable.
    newest_ms: int | None

    @classmethod
    def of(cls, replies: Sequence[Any]) -> _Observed:
        claimed, (head, last_ms), due_score, oldest, newest = replies
        newest_ms = None
        if newest:
            record = parse_record(*newest[0])
            newest_ms = 0 if record is None else record.accepted_at_ms
        return cls(
            claimed=bool(claimed),
            head=int(head) if head is not None and head.isdigit() else None,
            last_ms=int(last_ms) if last_ms is not None and last_ms.isdigit() else 0,
            due=due_score is not None,
            oldest=parse_record(*oldest[0]) if oldest else None,
            newest_ms=newest_ms,
        )


def _key(scope: BufferScope) -> DocKey:
    return scope.content_type, scope.content_id


async def _row_facts(scopes: Sequence[BufferScope]) -> dict[DocKey, Row]:
    async with open_session() as db:
        rows = await db.execute(
            select(
                RealtimeYjsSnapshot.content_type,
                RealtimeYjsSnapshot.content_id,
                RealtimeYjsSnapshot.organization_id,
                RealtimeYjsSnapshot.generation,
                RealtimeYjsSnapshot.buffer_epoch,
                RealtimeYjsSnapshot.valkey_run_id,
                RealtimeYjsSnapshot.checkpoint_seq,
            ).where(
                tuple_(RealtimeYjsSnapshot.content_type, RealtimeYjsSnapshot.content_id).in_([
                    _key(scope) for scope in scopes
                ])
            )
        )
    return {(row.content_type, row.content_id): row for row in rows}


async def _reschedule(buffer: UpdateBuffer, scope: BufferScope) -> None:
    """Restore the due entry from the original first pending time, so the window never slides."""
    client = buffer_client()
    keys = buffer_keys(scope, buffer.namespace)
    async with buffer_errors():
        first_ms = await client.hget(keys.control, "first_ms") or await valkey_now(client)
        async with client.pipeline(transaction=True) as pipe:
            pipe.hsetnx(keys.control, "first_ms", int(first_ms))
            pipe.zadd(keys.due, {scope.member: int(first_ms) + DUE_DELAY_MS}, nx=True)
            await pipe.execute()


async def _reclaim_idle(
    buffer: UpdateBuffer, scope: BufferScope, run_id: str, idle_before_ms: int
) -> bool:
    """Free an idle epoch's keys and unbind its row, so the next attach starts a fresh epoch."""
    bound = (
        RealtimeYjsSnapshot.content_type == scope.content_type,
        RealtimeYjsSnapshot.content_id == scope.content_id,
        RealtimeYjsSnapshot.organization_id == scope.organization_id,
        RealtimeYjsSnapshot.generation == scope.generation,
        RealtimeYjsSnapshot.buffer_epoch == scope.epoch,
        RealtimeYjsSnapshot.valkey_run_id == run_id,
    )
    async with open_session() as db:
        # Admission appends under this lock, so no edit can land between the check and the commit.
        await lock_document(db, _key(scope), scope.organization_id)
        watermark = await db.scalar(select(RealtimeYjsSnapshot.checkpoint_seq).where(*bound))
        if watermark is None or not await buffer.reclaim_idle(scope, watermark, idle_before_ms):
            return False
        # Should this commit fail, the row names an epoch without a control record, which the
        # next touch recovers as lost; the checkpoint already holds every accepted edit.
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(*bound)
            .values(buffer_epoch=None, valkey_run_id=None, checkpoint_seq=0)
        )
        await db.commit()
    buffer.forget(_key(scope))
    REALTIME_BUFFER_RECLAIMED_TOTAL.labels(kind="idle").inc()
    return True


async def _settle_unhealthy(
    buffer: UpdateBuffer, scope: BufferScope, seen: _Observed, now: int
) -> MaintenanceAction | CheckpointStatus:
    """Settle a scope that is not its row's healthy epoch; a retired one loses its aged records."""
    result = await checkpoint_document(buffer, scope)
    if result.status is CheckpointStatus.POISONED:
        await back_off(buffer, scope)
    if result.status not in _RETIRED_STATUSES:
        return result.status
    if seen.head is not None:
        REALTIME_BUFFER_RECLAIMED_TOTAL.labels(kind="orphan").inc()
    retained_before = now - RETIRED_RETENTION_MS
    if seen.newest_ms is None or seen.newest_ms >= retained_before:
        return result.status
    dropped = await buffer.drop_retired(scope, retained_before)
    if not dropped.records:
        return result.status
    REALTIME_BUFFER_RETIRED_RECORDS_DROPPED_TOTAL.inc(dropped.records)
    logger.warning(
        "Dropped {records} records a retired buffer epoch kept past the retention age",
        records=dropped.records,
        content_id=str(scope.content_id),
    )
    return MaintenanceAction.DROPPED


async def _maintain_scope(
    buffer: UpdateBuffer, scope: BufferScope, row: Row | None, seen: _Observed, run_id: str, now: int
) -> MaintenanceAction | CheckpointStatus:
    if seen.claimed:
        return MaintenanceAction.SKIPPED
    if (
        row is None
        or (row.organization_id, row.generation, row.buffer_epoch, row.valkey_run_id)
        != (scope.organization_id, scope.generation, scope.epoch, run_id)
        or seen.head is None
        or seen.head < row.checkpoint_seq
    ):
        # Gone documents, replaced epochs, orphan controls and lost instances settle in one pass.
        return await _settle_unhealthy(buffer, scope, seen, now)
    idle_before = now - IDLE_RECLAIM_MS
    if (
        seen.head == row.checkpoint_seq
        and not seen.due
        and seen.last_ms < idle_before
        and await _reclaim_idle(buffer, scope, run_id, idle_before)
    ):
        return MaintenanceAction.RECLAIMED
    action = MaintenanceAction.KEPT
    if seen.oldest is not None and seen.oldest.seq <= row.checkpoint_seq:
        trimmed = await clean_checkpoint(buffer, scope)
        if trimmed is not None and trimmed.removed_records:
            REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL.labels(event="cleaned").inc(trimmed.removed_records)
            action = MaintenanceAction.CLEANED
    if seen.head > row.checkpoint_seq and not seen.due:
        await _reschedule(buffer, scope)
        action = MaintenanceAction.RESCHEDULED
    return action


async def _maintain(
    buffer: UpdateBuffer, scopes: Sequence[BufferScope], now: int
) -> dict[MaintenanceAction | CheckpointStatus, int]:
    identity = server_identity()
    if identity is None:
        raise BufferUnavailable("Valkey binary client is not initialised")
    facts = await _row_facts(scopes)
    client = buffer_client()
    async with buffer_errors(), client.pipeline(transaction=False) as pipe:
        for scope in scopes:
            keys = buffer_keys(scope, buffer.namespace)
            pipe.exists(claim_key(scope, buffer.namespace))
            pipe.hmget(keys.control, ["head", "last_ms"])
            pipe.zscore(keys.due, scope.member)
            pipe.xrange(keys.stream, count=1)
            pipe.xrevrange(keys.stream, count=1)
        replies = await pipe.execute()
    actions: dict[MaintenanceAction | CheckpointStatus, int] = {}
    for index, scope in enumerate(scopes):
        seen = _Observed.of(replies[index * 5 : index * 5 + 5])
        try:
            action = await _maintain_scope(
                buffer, scope, facts.get(_key(scope)), seen, identity.run_id, now
            )
        except Exception:
            logger.opt(exception=True).warning("Buffer maintenance failed for one document")
            with contextlib.suppress(BufferUnavailable):
                await back_off(buffer, scope)
            action = MaintenanceAction.FAILED
        actions[action] = actions.get(action, 0) + 1
    return actions


async def maintain_buffer(
    buffer: UpdateBuffer, *, scan_calls: int = MAINTENANCE_SCAN_CALLS, now_ms: int | None = None
) -> MaintenanceReport:
    """Walk a rotating slice of buffered documents and repair or reclaim what they left behind."""
    await ensure_buffer_ready()
    client = buffer_client()
    state_key = f"{buffer.namespace}rtbuf:v{LAYOUT_VERSION}:maintenance"
    found: set[BufferScope] = set()
    async with buffer_errors():
        now = now_ms if now_ms is not None else await valkey_now(client)
        cursor_raw, started_raw = await client.hmget(state_key, ["cursor", "started_ms"])
        cursor, started = int(cursor_raw or 0), int(started_raw or now)
        for _ in range(scan_calls):
            cursor, page = await client.scan(
                cursor, match=key_pattern(None, buffer.namespace), count=_SCAN_COUNT
            )
            found.update(scopes_of_keys(page, _DOCUMENT_KEYS, buffer.namespace))
            if cursor == 0 or len(found) >= MAINTENANCE_DOCUMENTS:
                break
        if cursor == 0:
            await client.delete(state_key)
            REALTIME_BUFFER_MAINTENANCE_CYCLE_SECONDS.set((now - started) / 1000)
        else:
            await client.hset(state_key, mapping={"cursor": cursor, "started_ms": started})
    scopes = sorted(found, key=lambda scope: scope.member)
    actions = await _maintain(buffer, scopes, now) if scopes else {}
    # Counters drift when a stream disappears outside a trim; no other path recounts them.
    with contextlib.suppress(BufferUnavailable, RecoveryRequired):
        await buffer.repair_accounting(now // REPAIR_ROTATION_MS % BUCKET_COUNT)
    return MaintenanceReport(len(scopes), cursor == 0, actions)
