"""Valkey buffer for accepted realtime edits between PostgreSQL checkpoints."""

import asyncio
import contextlib
import dataclasses
import hashlib
from collections import OrderedDict
from collections.abc import AsyncIterator
from enum import StrEnum
from uuid import UUID

import valkey.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from valkey.exceptions import OutOfMemoryError, ValkeyError

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    MAX_PENDING_DOCUMENT_BYTES,
    MAX_PENDING_DOCUMENT_RECORDS,
    RECORD_FORMAT,
    AdmissionOutcome,
    AdmissionStatus,
    BufferedUpdate,
    BufferHead,
    BufferScope,
    LatestState,
    PendingUsage,
    Receipt,
    TrimResult,
    accounting_key,
    buffer_keys,
    due_key,
    parse_member,
    parse_record,
    scope_of_stream,
    stream_pattern,
    validate_namespace,
    validate_update,
)
from uniffy.core.realtime.buffer_script import (
    ADMIT_SCRIPT,
    INITIALIZE_SCRIPT,
    REBASE_SCRIPT,
    REPAIR_SCRIPT,
    TRIM_SCRIPT,
    run_script,
)
from uniffy.core.realtime.limits import MAX_FRAME_BYTES
from uniffy.core.realtime.metrics import REALTIME_BUFFER_ADMISSIONS_TOTAL
from uniffy.core.realtime.preflight import (
    PreflightVerdict,
    ensure_buffer_ready,
    preflight_result,
)
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.wire import MAX_WIRE_STRING_BYTES
from uniffy.infrastructure.valkey.binary import (
    ValkeyIdentity,
    ValkeyIdentityChanged,
    get_binary_client,
    server_identity,
    verify_server_identity,
)

ADMISSION_DEADLINE_SECONDS = 0.15
# One document may fill a quarter of its bucket at most, so it cannot starve the others.
_DOCUMENT_BUDGET_DIVISOR = 4
_ATTEMPTS = 3
_PAGE_RECORDS = 512
_SCAN_COUNT = 1000
_CACHE_MAX_BYTES = 64 * 1024 * 1024
_VALKEY_FAILURES = (ValkeyError, OSError, TimeoutError)


class BufferUnavailable(Exception):
    """Retryable: Valkey is unreachable or buffered acceptance is disabled; nothing was written."""


class AdmissionUnknown(Exception):
    """The admission call started but its outcome is unknown; retry with the same update id."""

    def __init__(self, update_id: str) -> None:
        super().__init__(f"admission of update {update_id!r} has an unknown outcome")
        self.update_id = update_id


class RecoveryReason(StrEnum):
    UNINITIALIZED = "uninitialized"
    IDENTITY_CHANGED = "identity_changed"
    MISSING_CONTROL = "missing_control"
    STALE_TAIL = "stale_tail"
    GAP = "gap"
    MALFORMED = "malformed"


class RecoveryRequired(Exception):
    """Buffered state cannot be proven complete; reset the epoch under the document lock."""

    def __init__(self, reason: RecoveryReason) -> None:
        super().__init__(reason.value)
        self.reason = reason


class _FactsChanged(Exception):
    pass


@dataclasses.dataclass(frozen=True, slots=True)
class _Facts:
    organization_id: UUID | None
    generation: str | None
    epoch: str | None
    run_id: str | None
    checkpoint_seq: int
    revision: int


def _matches(key: DocKey) -> tuple:
    return (
        RealtimeYjsSnapshot.content_type == key[0],
        RealtimeYjsSnapshot.content_id == key[1],
    )


async def _read_facts(db: AsyncSession, key: DocKey) -> _Facts | None:
    row = (
        await db.execute(
            select(
                RealtimeYjsSnapshot.organization_id,
                RealtimeYjsSnapshot.generation,
                RealtimeYjsSnapshot.buffer_epoch,
                RealtimeYjsSnapshot.valkey_run_id,
                RealtimeYjsSnapshot.checkpoint_seq,
                RealtimeYjsSnapshot.revision,
            ).where(*_matches(key))
        )
    ).one_or_none()
    return None if row is None else _Facts(*row)


async def _read_checkpoint(db: AsyncSession, key: DocKey, facts: _Facts) -> bytes:
    updates = (
        await db.execute(
            select(RealtimeYjsSnapshot.updates).where(
                *_matches(key),
                RealtimeYjsSnapshot.revision == facts.revision,
                RealtimeYjsSnapshot.checkpoint_seq == facts.checkpoint_seq,
                RealtimeYjsSnapshot.buffer_epoch == facts.epoch,
            )
        )
    ).scalar_one_or_none()
    if updates is None:
        raise _FactsChanged
    return updates


class _LatestCache:
    """Per-process LRU of reconstructed documents, bounded by retained bytes."""

    def __init__(self, max_bytes: int) -> None:
        self._entries: OrderedDict[tuple[str, DocKey], LatestState] = OrderedDict()
        self._bytes = 0
        self._max_bytes = max_bytes

    def get(self, key: tuple[str, DocKey]) -> LatestState | None:
        state = self._entries.get(key)
        if state is not None:
            self._entries.move_to_end(key)
        return state

    def put(self, key: tuple[str, DocKey], state: LatestState) -> None:
        self.discard(key)
        if state.size > self._max_bytes:
            return
        self._entries[key] = state
        self._bytes += state.size
        while self._bytes > self._max_bytes:
            _, evicted = self._entries.popitem(last=False)
            self._bytes -= evicted.size

    def discard(self, key: tuple[str, DocKey]) -> None:
        state = self._entries.pop(key, None)
        if state is not None:
            self._bytes -= state.size


_latest_cache = _LatestCache(_CACHE_MAX_BYTES)


class UpdateBuffer:
    """Admission, latest-state reads, cleanup and accounting in one key namespace.

    Budget and client default to the preflight budget and the process binary client.
    """

    def __init__(
        self,
        *,
        namespace: str = "",
        pending_budget_bytes: int | None = None,
        client: aioredis.Redis | None = None,
    ) -> None:
        validate_namespace(namespace)
        self.namespace = namespace
        self._pending_budget_bytes = pending_budget_bytes
        self._client = client

    def bucket_budget(self) -> int:
        result = preflight_result()
        if result is not None and result.verdict is PreflightVerdict.DISABLED:
            raise BufferUnavailable("Valkey eviction policy can drop pending edits")
        total = self._pending_budget_bytes
        if total is None and result is not None:
            total = result.pending_budget_bytes
        if total is None:
            raise BufferUnavailable("Valkey preflight has not run")
        return total // BUCKET_COUNT

    async def admit(
        self, head: BufferHead, *, update_id: str, update: bytes, actor_id: UUID
    ) -> AdmissionOutcome:
        """Append one update under ``head``, read under the caller's document lock.

        Raises :class:`AdmissionUnknown` once the call may have reached Valkey without a reply.
        """
        try:
            validate_update(update_id, update)
        except ValueError:
            return self._outcome(AdmissionStatus.TYPE_ERROR)
        await ensure_buffer_ready()
        budget = self.bucket_budget()
        scope = head.scope
        keys = buffer_keys(scope, self.namespace)
        args = [
            update_id.encode(),
            update,
            hashlib.sha256(update).hexdigest(),
            str(actor_id),
            scope.member,
            head.checkpoint_seq,
            min(MAX_PENDING_DOCUMENT_BYTES, budget // _DOCUMENT_BUDGET_DIVISOR),
            MAX_PENDING_DOCUMENT_RECORDS,
            budget,
            DUE_DELAY_MS,
            MAX_FRAME_BYTES,
            MAX_WIRE_STRING_BYTES,
            RECORD_FORMAT,
        ]
        connection = self._valkey().client()
        try:
            await connection.initialize()
        except ValkeyIdentityChanged:
            await self.adopt_identity()
            return self._outcome(AdmissionStatus.RECOVERY_REQUIRED)
        except _VALKEY_FAILURES as exc:
            raise BufferUnavailable("Valkey is unreachable") from exc
        try:
            # A live pooled connection serves the instance recorded when it connected; a head
            # bound to any other instance must be re-established before it issues sequences.
            identity = server_identity()
            if identity is None or identity.run_id != head.run_id:
                return self._outcome(AdmissionStatus.RECOVERY_REQUIRED)
            async with asyncio.timeout(ADMISSION_DEADLINE_SECONDS):
                reply = await run_script(
                    connection,
                    ADMIT_SCRIPT,
                    [keys.stream, keys.control, keys.receipts, keys.due, keys.accounting],
                    args,
                )
        except OutOfMemoryError:
            return self._outcome(AdmissionStatus.BUDGET_EXHAUSTED)
        except _VALKEY_FAILURES as exc:
            REALTIME_BUFFER_ADMISSIONS_TOTAL.labels(outcome="unknown").inc()
            raise AdmissionUnknown(update_id) from exc
        finally:
            await connection.aclose()
        status = AdmissionStatus(reply[0].decode())
        if status in (AdmissionStatus.ACCEPTED, AdmissionStatus.DUPLICATE):
            receipt = Receipt(scope.generation, scope.epoch, int(reply[1]), update_id)
            return self._outcome(status, receipt)
        return self._outcome(status)

    async def load_latest(self, db: AsyncSession, key: DocKey) -> LatestState | None:
        """Checkpoint plus the verified tail through the head; ``None`` when no row exists.

        Safe without the document lock: a checkpoint or reset racing the read is retried.
        """
        await ensure_buffer_ready()
        failure: RecoveryRequired | None = None
        for _ in range(_ATTEMPTS):
            facts = await _read_facts(db, key)
            if facts is None:
                return None
            try:
                return await self._load(db, key, facts)
            except _FactsChanged:
                continue
            except RecoveryRequired as exc:
                failure = exc
                if await _read_facts(db, key) == facts:
                    raise
        raise failure or BufferUnavailable("realtime checkpoint kept changing during the read")

    async def read_updates(
        self, scope: BufferScope, *, after: int, through: int
    ) -> tuple[BufferedUpdate, ...]:
        """Records ``after + 1`` through ``through``; a hole is a recovery condition."""
        await ensure_buffer_ready()
        updates, broken = await self.read_prefix(scope, after, through)
        if broken is not None:
            raise RecoveryRequired(broken)
        return updates

    async def read_prefix(
        self, scope: BufferScope, after: int, through: int | None, limit: int | None = None
    ) -> tuple[tuple[BufferedUpdate, ...], RecoveryReason | None]:
        """The contiguous records after ``after``, and why they stop short of ``through``."""
        stream = buffer_keys(scope, self.namespace).stream
        upper = "+" if through is None else f"{through}-0"
        updates: list[BufferedUpdate] = []
        expected = after + 1
        while (through is None or expected <= through) and (limit is None or len(updates) < limit):
            count = _PAGE_RECORDS if limit is None else min(_PAGE_RECORDS, limit - len(updates))
            async with self._valkey_call():
                page = await self._valkey().xrange(
                    stream, min=f"{expected}-0", max=upper, count=count
                )
            if not page:
                break
            for entry_id, fields in page:
                record = parse_record(entry_id, fields)
                if record is None:
                    return tuple(updates), RecoveryReason.MALFORMED
                if record.seq != expected:
                    return tuple(updates), RecoveryReason.GAP
                updates.append(record)
                expected += 1
        if through is not None and expected <= through:
            return tuple(updates), RecoveryReason.GAP
        return tuple(updates), None

    async def control_head(self, scope: BufferScope) -> int | None:
        """Last issued sequence of the epoch; ``None`` when its control record is gone."""
        async with self._valkey_call():
            raw = await self._valkey().hget(buffer_keys(scope, self.namespace).control, "head")
        return int(raw) if raw is not None and raw.isdigit() else None

    async def initialize(self, scope: BufferScope, revision: int) -> None:
        """Create the control record of a fresh epoch; an existing record is left alone."""
        async with self._valkey_call():
            await run_script(
                self._valkey(),
                INITIALIZE_SCRIPT,
                [buffer_keys(scope, self.namespace).control],
                [revision],
            )

    async def trim_committed(self, scope: BufferScope, through: int) -> TrimResult:
        """Retire records through a sequence the caller saw committed in PostgreSQL."""
        await ensure_buffer_ready()
        return await self._trim(scope, through, retire=False)

    async def retire(self, scope: BufferScope, through: int) -> TrimResult:
        """Drop an epoch's control, receipts and due entry; records after ``through`` remain."""
        await ensure_buffer_ready()
        return await self._trim(scope, through, retire=True)

    def forget(self, key: DocKey) -> None:
        _latest_cache.discard((self.namespace, key))

    async def pending_documents(self, organization_id: UUID) -> set[DocKey]:
        """Documents of one organization whose buffered edits wait for a checkpoint."""
        await ensure_buffer_ready()
        found: set[DocKey] = set()
        async with self._valkey_call():
            client = self._valkey()
            for bucket in range(BUCKET_COUNT):
                async for member, _ in client.zscan_iter(
                    due_key(bucket, self.namespace),
                    match=f"{organization_id}:*",
                    count=_SCAN_COUNT,
                ):
                    try:
                        scope = parse_member(member)
                    except ValueError:
                        continue
                    found.add((scope.content_type, scope.content_id))
        return found

    async def bucket_usage(self, bucket: int) -> PendingUsage:
        await ensure_buffer_ready()
        async with self._valkey_call():
            pending_bytes, records = await self._valkey().hmget(
                accounting_key(bucket, self.namespace), ["bytes", "records"]
            )
        return PendingUsage(int(pending_bytes or 0), int(records or 0))

    async def repair_accounting(self, bucket: int) -> PendingUsage:
        """Recompute one bucket's counters from its streams.

        Each document is corrected atomically. The bucket total is replaced only when no append
        or trim ran during the pass; under constant traffic only per-document corrections apply.
        """
        await ensure_buffer_ready()
        client = self._valkey()
        accounting = accounting_key(bucket, self.namespace)
        for _ in range(_ATTEMPTS):
            async with self._valkey_call():
                changes = await client.hget(accounting, "changes") or b"0"
                streams = {
                    key
                    async for key in client.scan_iter(
                        match=stream_pattern(bucket, self.namespace), count=_SCAN_COUNT
                    )
                }
                total_bytes = total_records = 0
                for stream in streams:
                    try:
                        scope = scope_of_stream(stream, bucket, self.namespace)
                    except ValueError:
                        continue
                    keys = buffer_keys(scope, self.namespace)
                    found_bytes, found_records = await run_script(
                        client, REPAIR_SCRIPT, [keys.stream, keys.control, keys.accounting], []
                    )
                    total_bytes += found_bytes
                    total_records += found_records
                rebased = await run_script(
                    client, REBASE_SCRIPT, [accounting], [changes, total_bytes, total_records]
                )
            if rebased:
                return PendingUsage(total_bytes, total_records)
        return await self.bucket_usage(bucket)

    async def adopt_identity(self) -> ValkeyIdentity:
        """Record the instance now serving, after a connection reported a different one."""
        try:
            return await verify_server_identity()
        except _VALKEY_FAILURES as exc:
            raise BufferUnavailable("Valkey is unreachable") from exc

    def _outcome(self, status: AdmissionStatus, receipt: Receipt | None = None) -> AdmissionOutcome:
        REALTIME_BUFFER_ADMISSIONS_TOTAL.labels(outcome=status.value).inc()
        return AdmissionOutcome(status, receipt)

    def _valkey(self) -> aioredis.Redis:
        client = self._client or get_binary_client()
        if client is None:
            raise BufferUnavailable("Valkey binary client is not initialised")
        return client

    @contextlib.asynccontextmanager
    async def _valkey_call(self) -> AsyncIterator[None]:
        try:
            yield
        except ValkeyIdentityChanged:
            await self.adopt_identity()
            raise RecoveryRequired(RecoveryReason.IDENTITY_CHANGED) from None
        except _VALKEY_FAILURES as exc:
            raise BufferUnavailable("Valkey call failed") from exc

    async def _load(self, db: AsyncSession, key: DocKey, facts: _Facts) -> LatestState:
        if facts.epoch is None or facts.generation is None or facts.organization_id is None:
            raise RecoveryRequired(RecoveryReason.UNINITIALIZED)
        identity = server_identity()
        if identity is None:
            raise BufferUnavailable("Valkey binary client is not initialised")
        if facts.run_id != identity.run_id:
            raise RecoveryRequired(RecoveryReason.IDENTITY_CHANGED)
        scope = BufferScope(facts.organization_id, key[0], key[1], facts.generation, facts.epoch)
        head_seq = await self.control_head(scope)
        if head_seq is None:
            raise RecoveryRequired(RecoveryReason.MISSING_CONTROL)
        if head_seq < facts.checkpoint_seq:
            raise RecoveryRequired(RecoveryReason.STALE_TAIL)
        head = BufferHead(scope, head_seq, facts.checkpoint_seq, facts.revision, identity.run_id)
        cache_key = (self.namespace, key)
        cached = _latest_cache.get(cache_key)
        # Valid only for the same generation, epoch, instance and checkpoint, at or below head.
        if (
            cached is not None
            and dataclasses.replace(cached.head, head_seq=head_seq) == head
            and cached.head.head_seq <= head_seq
        ):
            if cached.head.head_seq == head_seq:
                return cached
            checkpoint = cached.checkpoint
            tail = cached.tail + await self.read_updates(
                scope, after=cached.head.head_seq, through=head_seq
            )
        else:
            checkpoint = await _read_checkpoint(db, key, facts)
            tail = await self.read_updates(scope, after=facts.checkpoint_seq, through=head_seq)
        state = LatestState(head, checkpoint, tail)
        _latest_cache.put(cache_key, state)
        return state

    async def _trim(self, scope: BufferScope, through: int, *, retire: bool) -> TrimResult:
        keys = buffer_keys(scope, self.namespace)
        async with self._valkey_call():
            removed_bytes, removed_records, remaining = await run_script(
                self._valkey(),
                TRIM_SCRIPT,
                [keys.stream, keys.control, keys.receipts, keys.due, keys.accounting],
                [through, scope.member, int(retire)],
            )
        return TrimResult(removed_bytes, removed_records, remaining)
