"""Turn due buffered documents into checkpoint jobs, one claim and one job id per due window."""

import contextlib
from dataclasses import dataclass

import valkey.asyncio as aioredis
from loguru import logger

from uniffy.core.jobs import JobEnqueueOutcome
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    BufferScope,
    accounting_key,
    bucket_prefix,
    buffer_keys,
    due_key,
    parse_member,
)
from uniffy.core.realtime.checkpoint import (
    CheckpointResult,
    CheckpointStatus,
    Enqueue,
    buffer_client,
    buffer_errors,
    checkpoint_document,
    enqueue_core,
)
from uniffy.core.realtime.job_contracts import CHECKPOINT_REALTIME_DOCUMENT
from uniffy.core.realtime.metrics import (
    REALTIME_BUFFER_OLDEST_PENDING_SECONDS,
    REALTIME_BUFFER_PENDING_BYTES,
    REALTIME_BUFFER_PENDING_RECORDS,
    REALTIME_CHECKPOINT_DISPATCH_BATCH,
    REALTIME_CHECKPOINT_QUEUE_AGE,
)
from uniffy.core.realtime.preflight import ensure_buffer_ready

logger = logger.bind(component="core.realtime.dispatch")

_MIB = 1024 * 1024
EARLY_PENDING_BYTES = 1 * _MIB
EARLY_PENDING_RECORDS = 1024
# Claims outlive one dispatcher interval plus queue pickup; ARQ job ids dedupe longer waits.
CLAIM_TTL_SECONDS = 5
BACKOFF_BASE_SECONDS = 15
BACKOFF_MAX_SECONDS = 600
DUE_SCAN = 64
DUE_BATCH = 16
EARLY_SCAN = 32
DISPATCH_LIMIT = 64
_FAILURE_MEMORY_SECONDS = 3600


@dataclass(frozen=True, slots=True)
class DispatchReport:
    due: int
    early: int
    claimed: int
    enqueued: int


def claim_key(scope: BufferScope, namespace: str = "") -> str:
    return f"{bucket_prefix(scope.bucket, namespace)}:claim:{scope.member}"


def _failures_key(scope: BufferScope, namespace: str) -> str:
    return f"{bucket_prefix(scope.bucket, namespace)}:failures:{scope.member}"


def checkpoint_job_id(scope: BufferScope, window_ms: int, namespace: str = "") -> str:
    """One id per epoch and due window, so a retained result never suppresses a later window."""
    return f"{namespace}checkpoint:{scope.member}:{window_ms}"


def backoff_seconds(failures: int) -> int:
    return min(BACKOFF_BASE_SECONDS * 2 ** max(failures - 1, 0), BACKOFF_MAX_SECONDS)


async def valkey_now(client: aioredis.Redis) -> int:
    seconds, microseconds = await client.time()
    return seconds * 1000 + microseconds // 1000


async def back_off(buffer: UpdateBuffer, scope: BufferScope) -> None:
    """Hold a failing document away from dispatch and maintenance until its backoff ends."""
    client = buffer_client()
    failures_key = _failures_key(scope, buffer.namespace)
    async with buffer_errors():
        failures = await client.incr(failures_key)
        await client.expire(failures_key, _FAILURE_MEMORY_SECONDS)
        seconds = backoff_seconds(failures)
        retry_at = await valkey_now(client) + seconds * 1000
        await client.set(claim_key(scope, buffer.namespace), "backoff", ex=seconds)
        # Dispatch reads only the oldest due entries, so a held document moves out of their way.
        await client.zadd(
            due_key(scope.bucket, buffer.namespace), {scope.member: retry_at}, xx=True, gt=True
        )


async def run_checkpoint_job(
    buffer: UpdateBuffer, member: str, claim: str, *, enqueue: Enqueue = enqueue_core
) -> CheckpointResult:
    """Checkpoint one dispatched document; success releases its claim, failure backs it off."""
    scope = parse_member(member)
    try:
        result = await checkpoint_document(buffer, scope, enqueue=enqueue)
    except BufferUnavailable, RecoveryRequired:
        raise
    except Exception:
        with contextlib.suppress(BufferUnavailable):
            await back_off(buffer, scope)
        raise
    if result.status is CheckpointStatus.POISONED:
        await back_off(buffer, scope)
        return result
    client = buffer_client()
    async with buffer_errors():
        await release_owned_job_lock(client, claim_key(scope, buffer.namespace), claim)
        await client.delete(_failures_key(scope, buffer.namespace))
    return result


def _due_scope(member: bytes, bucket: int) -> BufferScope | None:
    try:
        scope = parse_member(member)
    except ValueError:
        return None
    return scope if scope.bucket == bucket else None


async def dispatch_due(
    buffer: UpdateBuffer,
    *,
    enqueue: Enqueue = enqueue_core,
    now_ms: int | None = None,
    claim_seconds: int = CLAIM_TTL_SECONDS,
) -> DispatchReport:
    """Enqueue one checkpoint per due or oversized document.

    Due entries stay until cleanup proves coverage, so a lost job is dispatched again.
    """
    await ensure_buffer_ready()
    client = buffer_client()
    namespace = buffer.namespace
    async with buffer_errors():
        now = now_ms if now_ms is not None else await valkey_now(client)
        async with client.pipeline(transaction=False) as pipe:
            for bucket in range(BUCKET_COUNT):
                due = due_key(bucket, namespace)
                pipe.zrange(due, 0, 0, withscores=True)
                pipe.hmget(accounting_key(bucket, namespace), ["bytes", "records"])
                pipe.zrangebyscore(due, "-inf", now, start=0, num=DUE_SCAN, withscores=True)
                pipe.zrevrangebyscore(
                    due, "+inf", f"({now}", start=0, num=EARLY_SCAN, withscores=True
                )
            replies = await pipe.execute()
    firsts: list[float] = []
    due_found: list[tuple[BufferScope, int]] = []
    upcoming: list[tuple[BufferScope, int]] = []
    # Rotating the first bucket keeps one busy bucket from always filling the batch.
    start = now // 1000 % BUCKET_COUNT
    for bucket in (*range(start, BUCKET_COUNT), *range(start)):
        first, usage, due, later = replies[bucket * 4 : bucket * 4 + 4]
        REALTIME_BUFFER_PENDING_BYTES.labels(bucket=str(bucket)).set(int(usage[0] or 0))
        REALTIME_BUFFER_PENDING_RECORDS.labels(bucket=str(bucket)).set(int(usage[1] or 0))
        firsts.extend(score for _, score in first)
        for found, entries in ((due_found, due), (upcoming, later)):
            found.extend(
                (scope, int(score))
                for member, score in entries
                if (scope := _due_scope(member, bucket)) is not None
            )
    oldest = min(firsts, default=None)
    REALTIME_BUFFER_OLDEST_PENDING_SECONDS.set(
        0 if oldest is None else max(0, now - oldest + DUE_DELAY_MS) / 1000
    )
    REALTIME_CHECKPOINT_QUEUE_AGE.set(0 if oldest is None else max(0, now - oldest) / 1000)
    selected, early = await _select(client, due_found, upcoming, namespace)
    claimed = enqueued = 0
    for scope, window in selected[:DISPATCH_LIMIT]:
        async with buffer_errors():
            token = await acquire_owned_job_lock(client, claim_key(scope, namespace), claim_seconds)
        if token is None:
            continue
        claimed += 1
        try:
            outcome = await enqueue(
                CHECKPOINT_REALTIME_DOCUMENT,
                checkpoint_job_id(scope, window, namespace),
                (scope.member, token),
            )
        except Exception:
            logger.opt(exception=True).warning("Checkpoint enqueue failed; dispatch retries it")
            continue
        enqueued += outcome is JobEnqueueOutcome.ENQUEUED
    REALTIME_CHECKPOINT_DISPATCH_BATCH.observe(enqueued)
    return DispatchReport(len(due_found), early, claimed, enqueued)


async def _select(
    client: aioredis.Redis,
    due: list[tuple[BufferScope, int]],
    upcoming: list[tuple[BufferScope, int]],
    namespace: str,
) -> tuple[list[tuple[BufferScope, int]], int]:
    """Due documents plus oversized early ones; claimed documents never crowd out their bucket."""
    candidates = [*((*entry, False) for entry in due), *((*entry, True) for entry in upcoming)]
    if not candidates:
        return [], 0
    async with buffer_errors(), client.pipeline(transaction=False) as pipe:
        for scope, _, _ in candidates:
            pipe.exists(claim_key(scope, namespace))
            pipe.hmget(buffer_keys(scope, namespace).control, ["bytes", "records"])
        replies = await pipe.execute()
    taken: dict[int, int] = {}
    selected = []
    early = 0
    for index, (scope, window, ahead) in enumerate(candidates):
        held, (pending_bytes, records) = replies[index * 2 : index * 2 + 2]
        if ahead:
            if int(pending_bytes or 0) <= EARLY_PENDING_BYTES and int(records or 0) <= (
                EARLY_PENDING_RECORDS
            ):
                continue
            early += 1
        if not held and taken.get(scope.bucket, 0) < DUE_BATCH:
            taken[scope.bucket] = taken.get(scope.bucket, 0) + 1
            selected.append((scope, window))
    return selected, early
