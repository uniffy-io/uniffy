"""Rotating buffer maintenance: repair what lost jobs, lost due entries or failed cleanup left."""

import contextlib
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from loguru import logger
from sqlalchemy import Row, select, tuple_

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    LAYOUT_VERSION,
    BufferScope,
    buffer_keys,
    parse_record,
)
from uniffy.core.realtime.checkpoint import (
    CheckpointStatus,
    buffer_client,
    buffer_errors,
    checkpoint_document,
    clean_checkpoint,
    stream_match,
    stream_scopes,
)
from uniffy.core.realtime.dispatch import back_off, claim_key, valkey_now
from uniffy.core.realtime.metrics import (
    REALTIME_BUFFER_MAINTENANCE_CYCLE_SECONDS,
    REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL,
)
from uniffy.core.realtime.preflight import ensure_buffer_ready
from uniffy.core.realtime.state import DocKey
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import server_identity

logger = logger.bind(component="core.realtime.maintenance")

MAINTENANCE_SCAN_CALLS = 20
MAINTENANCE_STREAMS = 1000
# Each pass recounts one bucket's pending totals; the bucket advances once per period.
REPAIR_ROTATION_MS = 60_000
_SCAN_COUNT = 1000


class MaintenanceAction(StrEnum):
    SKIPPED = "skipped"
    KEPT = "kept"
    CLEANED = "cleaned"
    RESCHEDULED = "rescheduled"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class MaintenanceReport:
    streams: int
    cycle_complete: bool
    actions: dict[MaintenanceAction | CheckpointStatus, int]


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
                    (scope.content_type, scope.content_id) for scope in scopes
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


async def _maintain_scope(
    buffer: UpdateBuffer, scope: BufferScope, row: Row | None, observed: list[Any], run_id: str
) -> MaintenanceAction | CheckpointStatus:
    claimed, (head, _), due_score, first = observed
    if claimed:
        return MaintenanceAction.SKIPPED
    if (
        row is None
        or (row.organization_id, row.generation, row.buffer_epoch, row.valkey_run_id)
        != (scope.organization_id, scope.generation, scope.epoch, run_id)
        or head is None
        or int(head) < row.checkpoint_seq
    ):
        # Gone documents, replaced epochs and lost instances all settle through one pass.
        result = await checkpoint_document(buffer, scope)
        if result.status is CheckpointStatus.POISONED:
            await back_off(buffer, scope)
        return result.status
    action = MaintenanceAction.KEPT
    record = parse_record(*first[0]) if first else None
    if record is not None and record.seq <= row.checkpoint_seq:
        trimmed = await clean_checkpoint(buffer, scope)
        if trimmed is not None and trimmed.removed_records:
            REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL.labels(event="cleaned").inc(trimmed.removed_records)
            action = MaintenanceAction.CLEANED
    if int(head) > row.checkpoint_seq and due_score is None:
        await _reschedule(buffer, scope)
        action = MaintenanceAction.RESCHEDULED
    return action


async def _maintain(
    buffer: UpdateBuffer, scopes: Sequence[BufferScope]
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
            pipe.hmget(keys.control, ["head", "first_ms"])
            pipe.zscore(keys.due, scope.member)
            pipe.xrange(keys.stream, count=1)
        replies = await pipe.execute()
    actions: dict[MaintenanceAction | CheckpointStatus, int] = {}
    for index, scope in enumerate(scopes):
        row = facts.get((scope.content_type, scope.content_id))
        try:
            action = await _maintain_scope(
                buffer, scope, row, replies[index * 4 : index * 4 + 4], identity.run_id
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
    """Walk a rotating slice of buffer streams and repair what scheduling or cleanup lost."""
    await ensure_buffer_ready()
    client = buffer_client()
    state_key = f"{buffer.namespace}rtbuf:v{LAYOUT_VERSION}:maintenance"
    found: set[bytes] = set()
    async with buffer_errors():
        now = now_ms if now_ms is not None else await valkey_now(client)
        cursor_raw, started_raw = await client.hmget(state_key, ["cursor", "started_ms"])
        cursor, started = int(cursor_raw or 0), int(started_raw or now)
        for _ in range(scan_calls):
            cursor, page = await client.scan(
                cursor, match=stream_match(buffer.namespace), count=_SCAN_COUNT
            )
            found.update(page)
            if cursor == 0 or len(found) >= MAINTENANCE_STREAMS:
                break
        if cursor == 0:
            await client.delete(state_key)
            REALTIME_BUFFER_MAINTENANCE_CYCLE_SECONDS.set((now - started) / 1000)
        else:
            await client.hset(state_key, mapping={"cursor": cursor, "started_ms": started})
    scopes = stream_scopes(found, buffer.namespace)
    actions = await _maintain(buffer, scopes) if scopes else {}
    # Counters drift when a stream disappears outside a trim; no other path recounts them.
    with contextlib.suppress(BufferUnavailable, RecoveryRequired):
        await buffer.repair_accounting(now // REPAIR_ROTATION_MS % BUCKET_COUNT)
    return MaintenanceReport(len(scopes), cursor == 0, actions)
