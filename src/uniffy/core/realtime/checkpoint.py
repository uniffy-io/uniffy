"""Checkpoint buffered realtime edits of one document into its PostgreSQL snapshot row.

Document locks order capture, commit and cleanup against every other snapshot writer, so an older
worker can never commit over newer state or trim beyond what PostgreSQL covers.
"""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from enum import StrEnum

import pycrdt
import valkey.asyncio as aioredis
from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from valkey.exceptions import ValkeyError

from uniffy.core.jobs import JobEnqueueOutcome, JobRef, enqueue_job_reconnecting
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import (
    BufferUnavailable,
    RecoveryReason,
    RecoveryRequired,
    UpdateBuffer,
)
from uniffy.core.realtime.buffer_keys import (
    LAYOUT_VERSION,
    MAX_PENDING_DOCUMENT_RECORDS,
    BufferedUpdate,
    BufferScope,
    TrimResult,
    buffer_keys,
    merge_tail,
    parse_member,
    scope_of_stream,
)
from uniffy.core.realtime.epoch import ensure_epoch
from uniffy.core.realtime.job_contracts import SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.metrics import (
    REALTIME_CHECKPOINT_AGE,
    REALTIME_CHECKPOINT_DURATION,
    REALTIME_CHECKPOINT_POISON_TOTAL,
    REALTIME_CHECKPOINT_RETRIES_TOTAL,
    REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL,
)
from uniffy.core.realtime.preflight import ensure_buffer_ready
from uniffy.core.realtime.publisher import publish_checkpoint_progress
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import compact_update, lock_document
from uniffy.core.realtime.wire import MAX_WIRE_INTEGER
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import (
    ValkeyIdentityChanged,
    get_binary_client,
    verify_server_identity,
)

logger = logger.bind(component="core.realtime.checkpoint")

_MIB = 1024 * 1024
CAPTURE_MAX_BYTES = 4 * _MIB
CAPTURE_MAX_RECORDS = 1024
_COMMIT_ATTEMPTS = 3
_DRAIN_PASSES = MAX_PENDING_DOCUMENT_RECORDS // CAPTURE_MAX_RECORDS + 1
_SCAN_COUNT = 1000
_VALKEY_FAILURES = (ValkeyError, OSError, TimeoutError)

type Enqueue = Callable[[JobRef, str, tuple[str, ...]], Awaitable[JobEnqueueOutcome]]


async def enqueue_core(ref: JobRef, job_id: str, args: tuple[str, ...]) -> JobEnqueueOutcome:
    return (await enqueue_job_reconnecting(ref, *args, _job_id=job_id)).outcome


class CheckpointStatus(StrEnum):
    COMMITTED = "committed"
    CLEAN = "clean"
    # The epoch was replaced; its provable prefix went into the checkpoint first.
    RESET = "reset"
    # The scope's epoch was replaced earlier; its records stay for investigation.
    STALE = "stale"
    # The document or this generation is gone.
    OBSOLETE = "obsolete"
    # A stored record cannot be read or merged; its bytes stay and the document backs off.
    POISONED = "poisoned"
    # Nothing durable changed; the next dispatch runs the pass again.
    DEFERRED = "deferred"


@dataclass(frozen=True, slots=True)
class CheckpointCapture:
    """A bounded contiguous pending prefix read under the document lock, with its base."""

    scope: BufferScope
    revision: int
    checkpoint_seq: int
    checkpoint: bytes
    updates: tuple[BufferedUpdate, ...]


@dataclass(frozen=True, slots=True)
class CheckpointResult:
    status: CheckpointStatus
    scope: BufferScope
    covered: int = 0
    revision: int = 0
    records: int = 0
    retries: int = 0
    accepted_at_ms: int = 0
    detail: str = ""


@dataclass(frozen=True, slots=True)
class UnreadableStream:
    member: str
    reason: str
    # ``None`` when the stream itself could not be read.
    records: int | None


@dataclass(frozen=True, slots=True)
class CheckpointReport:
    streams: int
    checkpointed: int
    records: int
    unreadable: tuple[UnreadableStream, ...]


def capture_prefix(tail: Sequence[BufferedUpdate]) -> tuple[BufferedUpdate, ...]:
    """The prefix one pass commits; a first record above the byte bound still goes alone."""
    size = 0
    for index, record in enumerate(tail[:CAPTURE_MAX_RECORDS]):
        size += len(record.update)
        if index and size > CAPTURE_MAX_BYTES:
            return tuple(tail[:index])
    return tuple(tail[:CAPTURE_MAX_RECORDS])


def compact_checkpoint(checkpoint: bytes, tail: Sequence[BufferedUpdate]) -> tuple[bytes, bytes]:
    """Merged checkpoint bytes and state vector; raises ``ValueError`` on an undecodable record."""
    compacted = compact_update(merge_tail(checkpoint, tail))
    return compacted, pycrdt.get_state(compacted)


async def stage_recovered(
    _db: AsyncSession, row: RealtimeYjsSnapshot, updates: tuple[BufferedUpdate, ...]
) -> None:
    """Fold a replaced epoch's provable prefix into the row; ``ensure_epoch`` commits it."""
    row.updates, row.state_vector = compact_checkpoint(row.updates, updates)
    row.revision += 1
    row.actor_id = updates[-1].actor_id
    row.updated_at = datetime.now(UTC)


def buffer_client() -> aioredis.Redis:
    """The process binary client, shared with the update buffer."""
    client = get_binary_client()
    if client is None:
        raise BufferUnavailable("Valkey binary client is not initialised")
    return client


@contextlib.asynccontextmanager
async def buffer_errors() -> AsyncIterator[None]:
    """Turn Valkey failures into retryable ``BufferUnavailable``, adopting a restarted instance."""
    try:
        yield
    except ValkeyIdentityChanged:
        with contextlib.suppress(*_VALKEY_FAILURES):
            await verify_server_identity()
        raise BufferUnavailable("Valkey instance changed") from None
    except _VALKEY_FAILURES as exc:
        raise BufferUnavailable("Valkey call failed") from exc


def stream_scopes(keys: Iterable[bytes | str], namespace: str) -> list[BufferScope]:
    """Scopes of well-formed stream keys, in a stable order; anything else is skipped."""
    scopes: set[BufferScope] = set()
    for key in keys:
        text = key.decode() if isinstance(key, bytes) else key
        try:
            scope = parse_member(text.partition(":stream:")[2])
            scope_of_stream(text, scope.bucket, namespace)
        except ValueError:
            continue
        scopes.add(scope)
    return sorted(scopes, key=lambda scope: scope.member)


def stream_match(namespace: str) -> str:
    return f"{namespace}rtbuf:{{v{LAYOUT_VERSION}:*}}:stream:*"


def _key(scope: BufferScope) -> DocKey:
    return scope.content_type, scope.content_id


def _row_of(scope: BufferScope) -> tuple:
    return (
        RealtimeYjsSnapshot.content_type == scope.content_type,
        RealtimeYjsSnapshot.content_id == scope.content_id,
    )


def _live(scope: BufferScope) -> tuple:
    return (
        *_row_of(scope),
        RealtimeYjsSnapshot.organization_id == scope.organization_id,
        RealtimeYjsSnapshot.generation == scope.generation,
        RealtimeYjsSnapshot.buffer_epoch == scope.epoch,
    )


async def _scope_status(db: AsyncSession, scope: BufferScope) -> CheckpointStatus | None:
    """``None`` while the scope is the row's live epoch."""
    row = (
        await db.execute(
            select(
                RealtimeYjsSnapshot.organization_id,
                RealtimeYjsSnapshot.generation,
                RealtimeYjsSnapshot.buffer_epoch,
            ).where(*_row_of(scope))
        )
    ).one_or_none()
    if row is None or (row.organization_id, row.generation) != (
        scope.organization_id,
        scope.generation,
    ):
        return CheckpointStatus.OBSOLETE
    return None if row.buffer_epoch == scope.epoch else CheckpointStatus.STALE


async def _recover(
    db: AsyncSession, buffer: UpdateBuffer, scope: BufferScope, reason: RecoveryReason
) -> CheckpointResult:
    if reason is RecoveryReason.MALFORMED:
        REALTIME_CHECKPOINT_POISON_TOTAL.labels(reason=reason.value).inc()
        return CheckpointResult(CheckpointStatus.POISONED, scope, detail=reason.value)
    try:
        # The health probe cannot see a gap, so only a gap forces the reset.
        head = await ensure_epoch(
            buffer,
            db,
            _key(scope),
            scope.organization_id,
            stage_recovered=stage_recovered,
            reset=reason if reason is RecoveryReason.GAP else None,
        )
    except ValueError:
        # A surviving record cannot be merged; the old epoch and its bytes stay in place.
        REALTIME_CHECKPOINT_POISON_TOTAL.labels(reason="undecodable").inc()
        return CheckpointResult(CheckpointStatus.POISONED, scope, detail="undecodable")
    await db.commit()
    if head.scope == scope:
        # Only a stale local record of the serving instance was corrected.
        return CheckpointResult(CheckpointStatus.DEFERRED, scope, detail=reason.value)
    return CheckpointResult(CheckpointStatus.RESET, scope, detail=reason.value)


async def capture_checkpoint(
    buffer: UpdateBuffer, scope: BufferScope
) -> CheckpointCapture | CheckpointResult:
    """Read the checkpoint and a bounded contiguous pending prefix under the document lock."""
    async with open_session() as db:
        await lock_document(db, _key(scope), scope.organization_id)
        status = await _scope_status(db, scope)
        if status is not None:
            return CheckpointResult(status, scope)
        try:
            state = await buffer.load_latest(db, _key(scope))
        except RecoveryRequired as exc:
            return await _recover(db, buffer, scope, exc.reason)
        if state is None:
            return CheckpointResult(CheckpointStatus.OBSOLETE, scope)
        prefix = capture_prefix(state.tail)
        if not prefix:
            return CheckpointResult(
                CheckpointStatus.CLEAN,
                scope,
                covered=state.head.checkpoint_seq,
                revision=state.head.checkpoint_revision,
            )
        return CheckpointCapture(
            scope,
            state.head.checkpoint_revision,
            state.head.checkpoint_seq,
            state.checkpoint,
            prefix,
        )


async def _store(capture: CheckpointCapture, updates: bytes, state_vector: bytes) -> int | None:
    scope = capture.scope
    async with open_session() as db:
        await lock_document(db, _key(scope), scope.organization_id)
        revision = (
            await db.execute(
                update(RealtimeYjsSnapshot)
                .where(
                    *_live(scope),
                    RealtimeYjsSnapshot.revision == capture.revision,
                    RealtimeYjsSnapshot.checkpoint_seq == capture.checkpoint_seq,
                )
                .values(
                    updates=updates,
                    state_vector=state_vector,
                    checkpoint_seq=capture.updates[-1].seq,
                    revision=capture.revision + 1,
                    actor_id=capture.updates[-1].actor_id,
                    updated_at=datetime.now(UTC),
                )
                .returning(RealtimeYjsSnapshot.revision)
                .execution_options(synchronize_session=False)
            )
        ).scalar_one_or_none()
        if revision is not None:
            await db.commit()
        return revision


async def commit_checkpoint(buffer: UpdateBuffer, capture: CheckpointCapture) -> CheckpointResult:
    """Merge outside the lock, then commit bytes and watermark only over the captured checkpoint.

    A competing checkpoint, ordinary write, replacement or reset recaptures from current state;
    appends after the captured prefix never invalidate the work.
    """
    for attempt in range(_COMMIT_ATTEMPTS):
        try:
            updates, state_vector = await asyncio.to_thread(
                compact_checkpoint, capture.checkpoint, capture.updates
            )
        except ValueError:
            REALTIME_CHECKPOINT_POISON_TOTAL.labels(reason="undecodable").inc()
            return CheckpointResult(
                CheckpointStatus.POISONED, capture.scope, retries=attempt, detail="undecodable"
            )
        revision = await _store(capture, updates, state_vector)
        if revision is not None:
            return CheckpointResult(
                CheckpointStatus.COMMITTED,
                capture.scope,
                covered=capture.updates[-1].seq,
                revision=revision,
                records=len(capture.updates),
                retries=attempt,
                accepted_at_ms=capture.updates[0].accepted_at_ms,
            )
        REALTIME_CHECKPOINT_RETRIES_TOTAL.labels(reason="checkpoint_changed").inc()
        recaptured = await capture_checkpoint(buffer, capture.scope)
        if isinstance(recaptured, CheckpointResult):
            return replace(recaptured, retries=attempt + 1)
        capture = recaptured
    return CheckpointResult(
        CheckpointStatus.DEFERRED, capture.scope, retries=_COMMIT_ATTEMPTS, detail="contended"
    )


async def clean_checkpoint(buffer: UpdateBuffer, scope: BufferScope) -> TrimResult | None:
    """Trim what PostgreSQL proves covered; ``None`` once the scope is no longer live."""
    async with open_session() as db:
        await lock_document(db, _key(scope), scope.organization_id)
        watermark = await db.scalar(select(RealtimeYjsSnapshot.checkpoint_seq).where(*_live(scope)))
        if watermark is None:
            return None
        return await buffer.trim_committed(scope, watermark)


async def _announce(buffer: UpdateBuffer, result: CheckpointResult, enqueue: Enqueue) -> None:
    scope = result.scope
    REALTIME_CHECKPOINT_AGE.observe(max(0.0, time.time() - result.accepted_at_ms / 1000))
    try:
        await publish_checkpoint_progress(
            scope.content_type,
            scope.content_id,
            generation=scope.generation,
            epoch=scope.epoch,
            covered_sequence=result.covered,
            checkpoint_revision=result.revision,
        )
    except Exception:
        logger.opt(exception=True).warning("Checkpoint progress was not published")
    try:
        await enqueue(
            SAVE_REALTIME_SNAPSHOT,
            f"{buffer.namespace}projection:{scope.content_type.value}:{scope.content_id}:"
            f"{result.revision}",
            (scope.content_type.value, str(scope.content_id), str(scope.organization_id), "", ""),
        )
    except Exception:
        logger.opt(exception=True).warning("Projection not enqueued; projection recovery repairs it")


async def _settle(buffer: UpdateBuffer, result: CheckpointResult, enqueue: Enqueue) -> None:
    if result.status in (CheckpointStatus.OBSOLETE, CheckpointStatus.STALE):
        # A replaced epoch may still hold records past a gap; only a gone generation drops them.
        obsolete = result.status is CheckpointStatus.OBSOLETE
        await buffer.retire(result.scope, MAX_WIRE_INTEGER if obsolete else 0)
        return
    if result.status not in (CheckpointStatus.COMMITTED, CheckpointStatus.CLEAN):
        return
    try:
        await clean_checkpoint(buffer, result.scope)
    except BufferUnavailable, RecoveryRequired:
        REALTIME_CHECKPOINT_TRIM_DEBT_TOTAL.labels(event="left").inc(result.records)
        logger.opt(exception=True).warning("Committed buffer prefix left for maintenance cleanup")
    if result.status is CheckpointStatus.COMMITTED:
        await _announce(buffer, result, enqueue)


async def checkpoint_document(
    buffer: UpdateBuffer, scope: BufferScope, *, enqueue: Enqueue = enqueue_core
) -> CheckpointResult:
    """One pass: capture, guarded commit, cleanup, then progress and projection after commit."""
    started = time.perf_counter()
    try:
        captured = await capture_checkpoint(buffer, scope)
        if isinstance(captured, CheckpointResult):
            result = captured
        else:
            result = await commit_checkpoint(buffer, captured)
        await _settle(buffer, result, enqueue)
    except BaseException:
        REALTIME_CHECKPOINT_DURATION.labels(outcome="failed").observe(time.perf_counter() - started)
        raise
    REALTIME_CHECKPOINT_DURATION.labels(outcome=result.status.value).observe(
        time.perf_counter() - started
    )
    return result


async def _drain(
    buffer: UpdateBuffer, scope: BufferScope, enqueue: Enqueue
) -> tuple[CheckpointResult, int]:
    covered = 0
    for _ in range(_DRAIN_PASSES):
        result = await checkpoint_document(buffer, scope, enqueue=enqueue)
        covered += result.records
        if result.status is not CheckpointStatus.COMMITTED:
            break
    return result, covered


async def checkpoint_all_pending(
    buffer: UpdateBuffer, *, enqueue: Enqueue = enqueue_core
) -> CheckpointReport:
    """Checkpoint every buffered stream, scheduled or not, and list what remains unproven."""
    await ensure_buffer_ready()
    async with buffer_errors():
        found = [
            key
            async for key in buffer_client().scan_iter(
                match=stream_match(buffer.namespace), count=_SCAN_COUNT
            )
        ]
    scopes = stream_scopes(found, buffer.namespace)
    checkpointed = records = 0
    unreadable: list[UnreadableStream] = []
    for scope in scopes:
        result: CheckpointResult | None = None
        reason = ""
        try:
            result, covered = await _drain(buffer, scope, enqueue)
            records += covered
        except Exception as exc:
            logger.opt(exception=True).warning("Checkpoint-all could not read one stream")
            reason = type(exc).__name__
        remaining: int | None = None
        with contextlib.suppress(BufferUnavailable):
            async with buffer_errors():
                remaining = await buffer_client().xlen(buffer_keys(scope, buffer.namespace).stream)
        if result is not None:
            if remaining == 0:
                if result.status is not CheckpointStatus.OBSOLETE:
                    checkpointed += 1
                continue
            settled = result.status in (CheckpointStatus.COMMITTED, CheckpointStatus.CLEAN)
            reason = result.detail or ("pending" if settled else result.status.value)
        unreadable.append(UnreadableStream(scope.member, reason, remaining))
    return CheckpointReport(len(scopes), checkpointed, records, tuple(unreadable))
