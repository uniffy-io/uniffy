"""Operator read of the realtime edit buffer: preflight facts and deployment-wide pending totals."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from prometheus_client import Counter
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.realtime.buffer import BufferUnavailable, UpdateBuffer
from uniffy.core.realtime.buffer_keys import BUCKET_COUNT, DUE_DELAY_MS, accounting_key, due_key
from uniffy.core.realtime.checkpoint import buffer_client, buffer_errors
from uniffy.core.realtime.metrics import (
    REALTIME_BUFFER_EPOCH_RESETS_TOTAL,
    REALTIME_CHECKPOINT_POISON_TOTAL,
)
from uniffy.core.realtime.preflight import (
    PENDING_BUDGET_OVERRIDE,
    PREFLIGHT_MODE,
    PreflightMode,
    PreflightResult,
    ensure_buffer_ready,
    preflight_result,
)
from uniffy.domains.users.operations import UserOperations

_REPLIES_PER_BUCKET = 3


@dataclass(frozen=True, slots=True)
class BufferTotals:
    pending_bytes: int
    pending_records: int
    pending_documents: int
    oldest_pending_seconds: float


@dataclass(frozen=True, slots=True)
class RealtimeBufferStatus:
    """Deployment-wide buffer health; nothing in it names a document or an organization."""

    mode: PreflightMode
    budget_from_env: bool
    preflight: PreflightResult | None
    totals: BufferTotals | None
    epoch_resets: dict[str, int]
    poisoned_checkpoints: dict[str, int]


class RealtimeBufferOperations:
    def __init__(self, session: AsyncSession, buffer: UpdateBuffer) -> None:
        self._user_ops = UserOperations(session)
        self._buffer = buffer

    async def get_status(self, *, user_id: UUID) -> RealtimeBufferStatus:
        await self._user_ops.require_system_admin(user_id)
        # Retries an unreachable Valkey and rereads a restarted instance, as a buffer call would.
        await ensure_buffer_ready()
        try:
            totals = await self._totals()
        except BufferUnavailable:
            totals = None
        return RealtimeBufferStatus(
            mode=PREFLIGHT_MODE,
            budget_from_env=PENDING_BUDGET_OVERRIDE is not None,
            preflight=preflight_result(),
            totals=totals,
            epoch_resets=_process_counts(REALTIME_BUFFER_EPOCH_RESETS_TOTAL),
            poisoned_checkpoints=_process_counts(REALTIME_CHECKPOINT_POISON_TOTAL),
        )

    async def _totals(self) -> BufferTotals:
        namespace = self._buffer.namespace
        async with buffer_errors(), buffer_client().pipeline(transaction=False) as pipe:
            pipe.time()
            for bucket in range(BUCKET_COUNT):
                pipe.hmget(accounting_key(bucket, namespace), ["bytes", "records"])
                pipe.zcard(due_key(bucket, namespace))
                pipe.zrange(due_key(bucket, namespace), 0, 0, withscores=True)
            (seconds, microseconds), *replies = await pipe.execute()
        now_ms = seconds * 1000 + microseconds // 1000
        pending_bytes = pending_records = pending_documents = 0
        firsts: list[float] = []
        for index in range(0, len(replies), _REPLIES_PER_BUCKET):
            (stored, records), documents, first = replies[index : index + _REPLIES_PER_BUCKET]
            pending_bytes += int(stored or 0)
            pending_records += int(records or 0)
            pending_documents += documents
            firsts.extend(score for _, score in first)
        oldest = min(firsts, default=None)
        # A due entry scores its first pending edit plus the due delay, or a later retry.
        oldest_ms = 0 if oldest is None else max(0, now_ms - oldest + DUE_DELAY_MS)
        return BufferTotals(pending_bytes, pending_records, pending_documents, oldest_ms / 1000)


def _process_counts(counter: Counter) -> dict[str, int]:
    """Counts by reason in this process only; each backend and worker process keeps its own."""
    return {
        sample.labels["reason"]: int(sample.value)
        for family in counter.collect()
        for sample in family.samples
        if sample.name.endswith("_total")
    }
