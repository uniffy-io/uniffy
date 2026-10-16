"""Valkey buffer for accepted realtime edits between PostgreSQL checkpoints."""

import asyncio
import contextlib
import dataclasses
from collections import defaultdict
from collections.abc import AsyncIterator
from enum import StrEnum
from uuid import UUID

import valkey.asyncio as aioredis
from loguru import logger
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from valkey.exceptions import OutOfMemoryError, ValkeyError

from uniffy.core.crypto import CryptoError, OrgDataCipher, SealedDataError
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    EARLY_PENDING_BYTES,
    EARLY_PENDING_RECORDS,
    MAX_PENDING_DOCUMENT_BYTES,
    MAX_PENDING_DOCUMENT_RECORDS,
    MAX_STORED_UPDATE_BYTES,
    RECORD_FORMAT,
    AdmissionOutcome,
    AdmissionStatus,
    BufferedUpdate,
    BufferHead,
    BufferScope,
    HeldState,
    LatestState,
    LatestTail,
    PendingUsage,
    Receipt,
    TrimResult,
    accounting_key,
    buffer_keys,
    due_key,
    parse_member,
    parse_record,
    record_aad,
    scopes_key,
    validate_namespace,
    validate_update,
)
from uniffy.core.realtime.buffer_script import (
    ADMIT_SCRIPT,
    DROP_RETIRED_SCRIPT,
    INITIALIZE_SCRIPT,
    REBASE_SCRIPT,
    RECLAIM_SCRIPT,
    REPAIR_SCRIPT,
    TRIM_SCRIPT,
    run_script,
)
from uniffy.core.realtime.latest import (
    CheckpointFacts,
    CheckpointMoved,
    LatestCache,
    read_checkpoint,
    read_facts,
)
from uniffy.core.realtime.metrics import (
    REALTIME_BUFFER_ADMISSIONS_TOTAL,
    REALTIME_BUFFER_UNSEAL_FAILURES_TOTAL,
    REALTIME_LATEST_READS_TOTAL,
)
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

logger = logger.bind(component="core.realtime.buffer")

# Worker context key for the process buffer that job handlers share.
UPDATE_BUFFER_CTX_KEY = "update_buffer"
ADMISSION_DEADLINE_SECONDS = 0.15
# One document may fill a quarter of its bucket and one organization half of it, so neither can
# starve the others. Several organizations under one person's control can still fill a bucket.
_DOCUMENT_BUDGET_DIVISOR = 4
_ORGANIZATION_BUDGET_DIVISOR = 2
_ATTEMPTS = 3
_PAGE_RECORDS = 512
_SCAN_COUNT = 1000
_CACHE_MAX_BYTES = 64 * 1024 * 1024
_VALKEY_FAILURES = (ValkeyError, OSError, TimeoutError)
# Loading an organization key reads PostgreSQL; failing to is as retryable as an unreachable Valkey.
_KEY_FAILURES = (CryptoError, SQLAlchemyError, OSError)


class BufferUnavailable(Exception):
    """Retryable: Valkey or the organization key cannot be reached, or buffered acceptance is
    disabled; nothing was written.
    """


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


_latest_cache = LatestCache(_CACHE_MAX_BYTES)


class UpdateBuffer:
    """Admission, latest-state reads, cleanup and accounting in one key namespace.

    Budget, client and cipher default to the preflight budget, the process binary client and the
    organization keys in PostgreSQL. Records rest sealed; every read hands out plaintext.
    """

    def __init__(
        self,
        *,
        namespace: str = "",
        pending_budget_bytes: int | None = None,
        client: aioredis.Redis | None = None,
        cipher: OrgDataCipher | None = None,
    ) -> None:
        validate_namespace(namespace)
        self.namespace = namespace
        self._pending_budget_bytes = pending_budget_bytes
        self._client = client
        self._cipher = cipher or OrgDataCipher()

    def bucket_budget(self) -> int:
        """Bytes one bucket may hold; refuses until the serving instance passed its preflight."""
        result = preflight_result()
        if result is None:
            raise BufferUnavailable("Valkey preflight has not run for the serving instance")
        if result.verdict is PreflightVerdict.DISABLED:
            raise BufferUnavailable("Valkey eviction policy can drop pending edits")
        total = self._pending_budget_bytes
        if total is None:
            total = result.pending_budget_bytes
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
        sealed, digest = await self._seal(scope, update_id, update, actor_id)
        args = [
            update_id.encode(),
            sealed,
            digest,
            str(actor_id),
            scope.member,
            head.checkpoint_seq,
            min(MAX_PENDING_DOCUMENT_BYTES, budget // _DOCUMENT_BUDGET_DIVISOR),
            MAX_PENDING_DOCUMENT_RECORDS,
            budget,
            DUE_DELAY_MS,
            MAX_STORED_UPDATE_BYTES,
            MAX_WIRE_STRING_BYTES,
            RECORD_FORMAT,
            budget // _ORGANIZATION_BUDGET_DIVISOR,
            EARLY_PENDING_BYTES,
            EARLY_PENDING_RECORDS,
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
                    [
                        keys.stream,
                        keys.control,
                        keys.receipts,
                        keys.due,
                        keys.accounting,
                        keys.early,
                        keys.scopes,
                    ],
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
            return self._outcome(status, receipt, sealed)
        return self._outcome(status)

    async def unseal_record(
        self, scope: BufferScope, update_id: str, actor_id: UUID, sealed: bytes
    ) -> bytes:
        """The plaintext of a record sealed for exactly this scope, update id and actor.

        Raises ``SealedDataError`` for bytes that do not open, and :class:`BufferUnavailable`
        when the organization key cannot be loaded.
        """
        aad = record_aad(scope, update_id, actor_id)
        async with self._key_call(scope):
            update = await self._cipher.unseal(scope.organization_id, sealed, aad=aad)
        return update

    async def load_latest(self, db: AsyncSession, key: DocKey) -> LatestState | None:
        """Checkpoint plus the verified tail through the head; ``None`` when no row exists.

        Safe without the document lock: a checkpoint or reset racing the read is retried.
        """
        await ensure_buffer_ready()
        failure: RecoveryRequired | None = None
        for _ in range(_ATTEMPTS):
            facts = await read_facts(db, key)
            if facts is None:
                return None
            try:
                return await self._load(db, key, facts)
            except CheckpointMoved:
                continue
            except RecoveryRequired as exc:
                failure = exc
                if await read_facts(db, key) == facts:
                    raise
        raise failure or BufferUnavailable("realtime checkpoint kept changing during the read")

    async def read_since(self, db: AsyncSession, key: DocKey, held: HeldState) -> LatestTail | None:
        """The records past what a resident document holds, without reading its checkpoint.

        ``None`` once the row names another generation, epoch, instance, revision or watermark;
        read :meth:`load_latest` then. Raises :class:`RecoveryRequired` for a hole in the tail.
        """
        await ensure_buffer_ready()
        facts = await read_facts(db, key)
        identity = server_identity()
        if (
            facts is None
            or identity is None
            or facts.organization_id is None
            or facts.generation is None
            or facts.epoch is None
            or facts.run_id != identity.run_id
            or (facts.generation, facts.epoch, facts.revision, facts.checkpoint_seq)
            != (held.generation, held.epoch, held.checkpoint_revision, held.checkpoint_seq)
        ):
            return None
        scope = BufferScope(facts.organization_id, key[0], key[1], facts.generation, facts.epoch)
        head_seq = await self.control_head(scope)
        if head_seq is None or head_seq < max(facts.checkpoint_seq, held.head_seq):
            return None
        tail = await self.read_updates(scope, after=held.head_seq, through=head_seq)
        REALTIME_LATEST_READS_TOTAL.labels(source="resident").inc()
        head = BufferHead(scope, head_seq, facts.checkpoint_seq, facts.revision, identity.run_id)
        return LatestTail(head, tail)

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
                try:
                    update = await self.unseal_record(
                        scope, record.update_id, record.actor_id, record.update
                    )
                except SealedDataError:
                    REALTIME_BUFFER_UNSEAL_FAILURES_TOTAL.labels(source="stream").inc()
                    logger.warning(
                        "Buffered record {seq} of {member} does not unseal",
                        seq=record.seq,
                        member=scope.member,
                    )
                    return tuple(updates), RecoveryReason.MALFORMED
                updates.append(dataclasses.replace(record, update=update))
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
        keys = buffer_keys(scope, self.namespace)
        async with self._valkey_call():
            await run_script(
                self._valkey(),
                INITIALIZE_SCRIPT,
                [keys.control, keys.scopes],
                [revision, scope.member],
            )

    async def trim_committed(self, scope: BufferScope, through: int) -> TrimResult:
        """Retire records through a sequence the caller saw committed in PostgreSQL."""
        await ensure_buffer_ready()
        return await self._trim(scope, through, retire=False)

    async def retire(self, scope: BufferScope, through: int) -> TrimResult:
        """Drop an epoch's control, receipts and due entry; records after ``through`` remain."""
        await ensure_buffer_ready()
        return await self._trim(scope, through, retire=True)

    async def reclaim_idle(
        self, scope: BufferScope, checkpoint_seq: int, idle_before_ms: int
    ) -> bool:
        """Drop an epoch PostgreSQL covers through its head, with nothing due and no recent append.

        The caller holds the document lock and clears the row's epoch in the same transaction.
        """
        await ensure_buffer_ready()
        keys = buffer_keys(scope, self.namespace)
        async with self._valkey_call():
            reclaimed = await run_script(
                self._valkey(),
                RECLAIM_SCRIPT,
                [
                    keys.stream,
                    keys.control,
                    keys.receipts,
                    keys.due,
                    keys.accounting,
                    keys.early,
                    keys.scopes,
                ],
                [checkpoint_seq, scope.member, max(idle_before_ms, 0)],
            )
        return bool(reclaimed)

    async def drop_retired(self, scope: BufferScope, older_than_ms: int) -> PendingUsage:
        """Drop what a retired epoch kept once its newest record is older than the cutoff."""
        await ensure_buffer_ready()
        keys = buffer_keys(scope, self.namespace)
        async with self._valkey_call():
            dropped_bytes, dropped_records = await run_script(
                self._valkey(),
                DROP_RETIRED_SCRIPT,
                [keys.stream, keys.control, keys.accounting, keys.scopes],
                [max(older_than_ms, 0), scope.member],
            )
        return PendingUsage(dropped_bytes, dropped_records)

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

    async def scopes(self, bucket: int) -> list[BufferScope]:
        """Every scope of one bucket that holds a control record or records."""
        await ensure_buffer_ready()
        page: list[BufferScope] = []
        cursor = 0
        while True:
            cursor, members = await self.scope_page(bucket, cursor)
            page.extend(members)
            if cursor == 0:
                return page

    async def scope_page(self, bucket: int, cursor: int) -> tuple[int, list[BufferScope]]:
        """One SSCAN page of a bucket's scopes and the cursor that continues it, zero at the end."""
        async with self._valkey_call():
            cursor, members = await self._valkey().sscan(
                scopes_key(bucket, self.namespace), cursor, count=_SCAN_COUNT
            )
        found: list[BufferScope] = []
        for member in members:
            with contextlib.suppress(ValueError):
                scope = parse_member(member)
                if scope.bucket == bucket:
                    found.append(scope)
        return int(cursor), found

    async def repair_accounting(self, bucket: int) -> PendingUsage:
        """Recompute one bucket's counters from its streams.

        Each document is corrected atomically. The bucket and organization totals are replaced
        only when no append or trim ran during the pass; under constant traffic only per-document
        corrections apply.
        """
        await ensure_buffer_ready()
        client = self._valkey()
        accounting = accounting_key(bucket, self.namespace)
        for _ in range(_ATTEMPTS):
            async with self._valkey_call():
                changes = await client.hget(accounting, "changes") or b"0"
            scopes = await self.scopes(bucket)
            total_bytes = total_records = 0
            organizations: dict[UUID, int] = defaultdict(int)
            async with self._valkey_call():
                for scope in sorted(scopes, key=lambda each: each.member):
                    keys = buffer_keys(scope, self.namespace)
                    found_bytes, found_records = await run_script(
                        client,
                        REPAIR_SCRIPT,
                        [keys.stream, keys.control, keys.accounting],
                        [scope.member],
                    )
                    total_bytes += found_bytes
                    total_records += found_records
                    if found_bytes:
                        organizations[scope.organization_id] += found_bytes
                totals = [
                    item
                    for organization, spent in sorted(organizations.items())
                    for item in (str(organization), spent)
                ]
                rebased = await run_script(
                    client,
                    REBASE_SCRIPT,
                    [accounting],
                    [changes, total_bytes, total_records, *totals],
                )
            if rebased:
                return PendingUsage(total_bytes, total_records)
        return await self.bucket_usage(bucket)

    async def organization_usage(self, bucket: int, organization_id: UUID) -> int:
        """Stored bytes one organization holds in a bucket."""
        await ensure_buffer_ready()
        async with self._valkey_call():
            spent = await self._valkey().hget(
                accounting_key(bucket, self.namespace), f"o:{organization_id}"
            )
        return int(spent or 0)

    async def adopt_identity(self) -> ValkeyIdentity:
        """Record the instance now serving, after a connection reported a different one."""
        try:
            return await verify_server_identity()
        except _VALKEY_FAILURES as exc:
            raise BufferUnavailable("Valkey is unreachable") from exc

    def _outcome(
        self,
        status: AdmissionStatus,
        receipt: Receipt | None = None,
        sealed: bytes | None = None,
    ) -> AdmissionOutcome:
        REALTIME_BUFFER_ADMISSIONS_TOTAL.labels(outcome=status.value).inc()
        return AdmissionOutcome(status, receipt, sealed)

    async def _seal(
        self, scope: BufferScope, update_id: str, update: bytes, actor_id: UUID
    ) -> tuple[bytes, str]:
        """The sealed record and its receipt digest, both computed before Valkey is reached."""
        organization_id = scope.organization_id
        async with self._key_call(scope):
            sealed = await self._cipher.seal(
                organization_id, update, aad=record_aad(scope, update_id, actor_id)
            )
            # Keyed by the active DEK, so a retry across a rotation answers id_conflict.
            digest = await self._cipher.receipt_digest(organization_id, update)
        return sealed, digest

    @contextlib.asynccontextmanager
    async def _key_call(self, scope: BufferScope) -> AsyncIterator[None]:
        try:
            yield
        except SealedDataError:
            raise
        except _KEY_FAILURES as exc:
            # Only the error type: tracebacks would show plaintext held by the frames.
            logger.warning(
                "Organization key for {member} is unavailable: {error}",
                member=scope.member,
                error=type(exc).__name__,
            )
            raise BufferUnavailable("organization key is unavailable") from exc

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

    async def _load(self, db: AsyncSession, key: DocKey, facts: CheckpointFacts) -> LatestState:
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
            REALTIME_LATEST_READS_TOTAL.labels(source="cache").inc()
            if cached.head.head_seq == head_seq:
                return cached
            checkpoint = cached.checkpoint
            tail = cached.tail + await self.read_updates(
                scope, after=cached.head.head_seq, through=head_seq
            )
        else:
            REALTIME_LATEST_READS_TOTAL.labels(source="checkpoint").inc()
            checkpoint = await read_checkpoint(db, key, facts)
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
                [
                    keys.stream,
                    keys.control,
                    keys.receipts,
                    keys.due,
                    keys.accounting,
                    keys.early,
                    keys.scopes,
                ],
                [
                    through,
                    scope.member,
                    int(retire),
                    DUE_DELAY_MS,
                    EARLY_PENDING_BYTES,
                    EARLY_PENDING_RECORDS,
                ],
            )
        return TrimResult(removed_bytes, removed_records, remaining)
