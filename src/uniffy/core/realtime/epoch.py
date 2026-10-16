"""Bind a document to a live buffer epoch on the serving Valkey instance.

The snapshot row binds each epoch to the instance that issued its sequences, so a restarted or
restored Valkey can never reissue a sequence a client already holds a receipt for.
"""

import contextlib
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid4

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import (
    BufferUnavailable,
    RecoveryReason,
    RecoveryRequired,
    UpdateBuffer,
)
from uniffy.core.realtime.buffer_keys import (
    MAX_PENDING_DOCUMENT_RECORDS,
    BufferedUpdate,
    BufferHead,
    BufferScope,
)
from uniffy.core.realtime.metrics import REALTIME_BUFFER_EPOCH_RESETS_TOTAL
from uniffy.core.realtime.preflight import ensure_buffer_ready
from uniffy.core.realtime.publisher import publish_checkpoint_progress
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import load_snapshot, lock_document
from uniffy.infrastructure.valkey.binary import ValkeyIdentity, server_identity

logger = logger.bind(component="core.realtime.epoch")

_SETTLE_ATTEMPTS = 4

StageRecovered = Callable[
    [AsyncSession, RealtimeYjsSnapshot, tuple[BufferedUpdate, ...]], Awaitable[None]
]


def row_scope(row: RealtimeYjsSnapshot) -> BufferScope:
    if row.organization_id is None or row.generation is None or row.buffer_epoch is None:
        raise RecoveryRequired(RecoveryReason.UNINITIALIZED)
    return BufferScope(
        row.organization_id, row.content_type, row.content_id, row.generation, row.buffer_epoch
    )


async def ensure_epoch(
    buffer: UpdateBuffer,
    db: AsyncSession,
    key: DocKey,
    organization_id: UUID,
    *,
    stage_recovered: StageRecovered,
    reset: RecoveryReason | None = None,
) -> BufferHead:
    """Bind the document to a live epoch on the serving instance before any append.

    The caller holds the document lock in ``db`` and has seeded the row. A reset hands the
    provable surviving tail to ``stage_recovered``, commits the caller's transaction with a
    fresh epoch, then takes the lock again, so ``db`` still holds it on return. ``reset``
    forces a new epoch after the loader reported that condition under the same lock.
    """
    await ensure_buffer_ready()
    for _ in range(_SETTLE_ATTEMPTS):
        row = await load_snapshot(db, key)
        if row is None or row.generation is None:
            raise LookupError(f"{key[0].value}:{key[1]} has no seeded realtime checkpoint")
        if row.organization_id not in (None, organization_id):
            raise LookupError(f"{key[0].value}:{key[1]} belongs to another organization")
        try:
            head = await _settle(buffer, db, key, row, organization_id, stage_recovered, reset)
        except RecoveryRequired:
            # The serving instance changed during this call and was adopted; decide again.
            continue
        if head is not None:
            return head
        reset = None
    raise BufferUnavailable("realtime buffer epoch did not settle")


async def _identity(buffer: UpdateBuffer, bound_run_id: str | None) -> ValkeyIdentity:
    identity = server_identity()
    if identity is not None and identity.run_id == bound_run_id:
        return identity
    # Probe before deciding: a stale local record must not reset a healthy epoch.
    return await buffer.adopt_identity()


async def _health(
    buffer: UpdateBuffer, row: RealtimeYjsSnapshot, identity: ValkeyIdentity
) -> tuple[RecoveryReason | None, int]:
    if row.buffer_epoch is None or row.organization_id is None:
        return RecoveryReason.UNINITIALIZED, 0
    if row.valkey_run_id != identity.run_id:
        return RecoveryReason.IDENTITY_CHANGED, 0
    head_seq = await buffer.control_head(row_scope(row))
    if head_seq is None:
        return RecoveryReason.MISSING_CONTROL, 0
    if head_seq < row.checkpoint_seq:
        return RecoveryReason.STALE_TAIL, 0
    return None, head_seq


async def _settle(
    buffer: UpdateBuffer,
    db: AsyncSession,
    key: DocKey,
    row: RealtimeYjsSnapshot,
    organization_id: UUID,
    stage_recovered: StageRecovered,
    reset: RecoveryReason | None,
) -> BufferHead | None:
    identity = await _identity(buffer, row.valkey_run_id)
    reason, head_seq = (reset, 0) if reset is not None else await _health(buffer, row, identity)
    if reason is None:
        return BufferHead(
            row_scope(row), head_seq, row.checkpoint_seq, row.revision, identity.run_id
        )
    await _reset(buffer, db, row, organization_id, identity, reason, stage_recovered)
    await lock_document(db, key, organization_id)
    return None


async def surviving_prefix(
    buffer: UpdateBuffer, row: RealtimeYjsSnapshot
) -> tuple[tuple[BufferedUpdate, ...], int]:
    """The provable contiguous tail of the row's epoch and the sequence its retirement covers."""
    previous = row_scope(row)
    head_seq = await buffer.control_head(previous)
    recovered: tuple[BufferedUpdate, ...] = ()
    if head_seq is None or head_seq > row.checkpoint_seq:
        recovered, _ = await buffer.read_prefix(
            previous, row.checkpoint_seq, head_seq, MAX_PENDING_DOCUMENT_RECORDS
        )
    return recovered, recovered[-1].seq if recovered else row.checkpoint_seq


async def start_epoch(
    buffer: UpdateBuffer,
    row: RealtimeYjsSnapshot,
    organization_id: UUID,
    identity: ValkeyIdentity,
) -> BufferScope:
    """Bind the staged row to a fresh epoch at the revision it is about to commit.

    The control record exists before the commit releases the document lock, so a caller queued
    on that lock finds a healthy epoch instead of replacing it again.
    """
    if row.generation is None:
        raise LookupError(f"{row.content_type.value}:{row.content_id} has no Yjs generation")
    fresh = BufferScope(
        organization_id, row.content_type, row.content_id, row.generation, str(uuid4())
    )
    await buffer.initialize(fresh, row.revision)
    row.organization_id = organization_id
    row.buffer_epoch = fresh.epoch
    row.valkey_run_id = identity.run_id
    row.checkpoint_seq = 0
    return fresh


async def _reset(
    buffer: UpdateBuffer,
    db: AsyncSession,
    row: RealtimeYjsSnapshot,
    organization_id: UUID,
    identity: ValkeyIdentity,
    reason: RecoveryReason,
    stage_recovered: StageRecovered,
) -> None:
    previous = None if row.buffer_epoch is None else row_scope(row)
    recovered: tuple[BufferedUpdate, ...] = ()
    retire_through = row.checkpoint_seq
    if previous is not None:
        recovered, retire_through = await surviving_prefix(buffer, row)
    if recovered:
        await stage_recovered(db, row, recovered)
    fresh = await start_epoch(buffer, row, organization_id, identity)
    try:
        db.add(row)
        await db.commit()
    except BaseException:
        # Nothing references the uncommitted epoch, so its control record goes with it.
        with contextlib.suppress(BufferUnavailable, RecoveryRequired):
            await buffer.retire(fresh, 0)
        raise
    buffer.forget((row.content_type, row.content_id))
    REALTIME_BUFFER_EPOCH_RESETS_TOTAL.labels(reason=reason.value).inc()
    logger.info(
        "Realtime buffer epoch reset ({reason}): recovered {count} pending updates",
        reason=reason.value,
        count=len(recovered),
    )
    await _announce(fresh, row.revision)
    if previous is not None:
        try:
            await buffer.retire(previous, retire_through)
        except BufferUnavailable, RecoveryRequired:
            logger.opt(exception=True).warning("Retired buffer epoch keys left for maintenance")


async def _announce(scope: BufferScope, revision: int) -> None:
    """Replicas on the retired epoch reload into the fresh one; resync repairs a lost message."""
    try:
        await publish_checkpoint_progress(
            scope.content_type,
            scope.content_id,
            generation=scope.generation,
            epoch=scope.epoch,
            covered_sequence=0,
            checkpoint_revision=revision,
        )
    except Exception:
        logger.opt(exception=True).warning("Fresh buffer epoch was not announced")
