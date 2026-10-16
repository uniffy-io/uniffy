"""Checkpoint workers and scheduling recovery on live Valkey and PostgreSQL, in disposable keys."""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pycrdt
import pytest
import pytest_asyncio
import valkey.asyncio as aioredis
from prometheus_client import REGISTRY
from sqlalchemy import delete, update

from uniffy.core.jobs import JobEnqueueOutcome, JobRef, JobReliability, RecoveryStore
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import register_realtime_adapter
from uniffy.core.realtime.admission import latest_under_lock
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    DUE_DELAY_MS,
    AdmissionOutcome,
    AdmissionStatus,
    BufferHead,
    LatestState,
    PendingUsage,
    Receipt,
    TrimResult,
    accounting_key,
    bucket_for,
    buffer_keys,
    parse_record,
)
from uniffy.core.realtime.checkpoint import (
    CheckpointCapture,
    CheckpointReport,
    CheckpointStatus,
    UnreadableStream,
    capture_checkpoint,
    checkpoint_all_pending,
    checkpoint_document,
    clean_checkpoint,
    commit_checkpoint,
    stage_recovered,
)
from uniffy.core.realtime.dispatch import (
    CLAIM_TTL_SECONDS,
    DUE_BATCH,
    DUE_SCAN,
    DispatchReport,
    checkpoint_job_id,
    claim_key,
    dispatch_due,
    run_checkpoint_job,
)
from uniffy.core.realtime.epoch import ensure_epoch, start_epoch
from uniffy.core.realtime.job_contracts import CHECKPOINT_REALTIME_DOCUMENT, SAVE_REALTIME_SNAPSHOT
from uniffy.core.realtime.live import stage_text_merge
from uniffy.core.realtime.maintenance import (
    IDLE_RECLAIM_MS,
    REPAIR_ROTATION_MS,
    RETIRED_RETENTION_MS,
    MaintenanceAction,
    maintain_buffer,
)
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD, markdown_text
from uniffy.core.realtime.publisher import doc_channel
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.state import DocKey
from uniffy.core.realtime.storage import load_snapshot, lock_document
from uniffy.core.types import ContentType
from uniffy.domains.notes.adapter import NoteRealtimeAdapter
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import get_binary_client, server_identity
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.infrastructure.valkey.pubsub import close_pubsub, init_pubsub
from uniffy.tests.integration.access.recording_search import recording_indexer
from uniffy.vendor.arq import Worker, create_pool, func
from uniffy.vendor.arq.connections import ArqValkey
from uniffy.vendor.arq.constants import retry_key_prefix
from uniffy.vendor.arq.jobs import Job
from uniffy.workers.inventory import worker_inventory
from uniffy.workers.registry import CORE_JOB_REGISTRATIONS

pytestmark = pytest.mark.asyncio(loop_scope="session")

BUDGET = 1024 * 1024 * 1024
STALE_RUN_ID = "0" * 40
# Every due window has passed at this instant.
FAR_FUTURE_MS = 2**52


def valkey() -> aioredis.Redis:
    client = get_binary_client()
    assert client is not None
    return client


def text_of(update_bytes: bytes) -> str:
    doc = pycrdt.Doc()
    doc.apply_update(update_bytes)
    return str(markdown_text(doc))


def edit(base: bytes, suffix: str) -> bytes:
    doc = pycrdt.Doc()
    doc.apply_update(base)
    before = doc.get_state()
    text = markdown_text(doc)
    text.insert(len(str(text)), suffix)
    return doc.get_update(before)


class Recorder:
    """Stands in for a queue whose jobs never run, as when ARQ loses them."""

    def __init__(self) -> None:
        self.jobs: list[tuple[str, str, tuple[str, ...]]] = []

    async def __call__(self, ref: JobRef, job_id: str, args: tuple[str, ...]) -> JobEnqueueOutcome:
        self.jobs.append((ref.name, job_id, args))
        return JobEnqueueOutcome.ENQUEUED


class Inline:
    """Runs each dispatched checkpoint right away, the way a core worker picks it up."""

    def __init__(self, buffer: UpdateBuffer) -> None:
        self.buffer = buffer
        self.projections = Recorder()
        self.results: list[Any] = []

    async def __call__(self, ref: JobRef, job_id: str, args: tuple[str, ...]) -> JobEnqueueOutcome:
        if ref is CHECKPOINT_REALTIME_DOCUMENT:
            member, claim = args
            self.results.append(
                await run_checkpoint_job(self.buffer, member, claim, enqueue=self.projections)
            )
        return JobEnqueueOutcome.ENQUEUED


async def seed_checkpoint(key: DocKey, organization_id) -> bytes:
    doc = pycrdt.Doc()
    doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY] = str(uuid4())
    markdown_text(doc).insert(0, "base")
    async with open_session() as db:
        db.add(
            RealtimeYjsSnapshot(
                content_type=key[0],
                content_id=key[1],
                organization_id=organization_id,
                generation=doc.get(DOC_META_FIELD, type=pycrdt.Map)[DOC_GENERATION_KEY],
                updates=doc.get_update(),
                state_vector=doc.get_state(),
            )
        )
        await db.commit()
    return doc.get_update()


@pytest_asyncio.fixture(loop_scope="session")
async def env(access, valkey_namespace) -> AsyncIterator[SimpleNamespace]:
    register_realtime_adapter(NoteRealtimeAdapter(recording_indexer()))
    keys = [
        (ContentType.NOTE, note_id)
        for note_id in (access.private_note_id, access.shared_note_id, access.org_note_id)
    ]
    bases = [await seed_checkpoint(key, access.org_id) for key in keys]
    try:
        yield SimpleNamespace(
            buffer=UpdateBuffer(namespace=valkey_namespace, pending_budget_bytes=BUDGET),
            namespace=valkey_namespace,
            key=keys[0],
            keys=keys,
            base=bases[0],
            bases=bases,
            org=access.org_id,
            alice=access.member_id,
            bob=access.peer_id,
            carol=access.owner_id,
            jobs=Recorder(),
        )
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.content_id.in_([key[1] for key in keys])
                )
            )
            await db.commit()


@pytest_asyncio.fixture(loop_scope="session")
async def bucket_mates(env) -> AsyncIterator[Callable[[int, int], Awaitable[list[DocKey]]]]:
    """Seeds extra documents that hash into one buffer bucket; teardown deletes their rows."""
    created: list[DocKey] = []

    async def seed(bucket: int, count: int) -> list[DocKey]:
        keys: list[DocKey] = []
        while len(keys) < count:
            key = (ContentType.NOTE, uuid4())
            if bucket_for(env.org, key[0], key[1]) == bucket:
                await seed_checkpoint(key, env.org)
                created.append(key)
                keys.append(key)
        return keys

    try:
        yield seed
    finally:
        async with open_session() as db:
            await db.execute(
                delete(RealtimeYjsSnapshot).where(
                    RealtimeYjsSnapshot.content_id.in_([key[1] for key in created])
                )
            )
            await db.commit()


async def establish(env: SimpleNamespace, key: DocKey | None = None) -> BufferHead:
    key = key or env.key
    async with open_session() as db:
        await lock_document(db, key, env.org)
        head = await ensure_epoch(env.buffer, db, key, env.org, stage_recovered=stage_recovered)
        await db.commit()
    return head


async def admit(
    env: SimpleNamespace,
    head: BufferHead,
    update_id: str,
    payload: bytes,
    *,
    actor=None,
    buffer: UpdateBuffer | None = None,
) -> AdmissionOutcome:
    outcome = await (buffer or env.buffer).admit(
        head, update_id=update_id, update=payload, actor_id=actor or env.alice
    )
    assert outcome.status is AdmissionStatus.ACCEPTED
    return outcome


async def stored_row(key: DocKey) -> RealtimeYjsSnapshot:
    async with open_session() as db:
        row = await load_snapshot(db, key)
    assert row is not None
    return row


async def set_row(key: DocKey, **values: Any) -> None:
    async with open_session() as db:
        await db.execute(
            update(RealtimeYjsSnapshot)
            .where(
                RealtimeYjsSnapshot.content_type == key[0],
                RealtimeYjsSnapshot.content_id == key[1],
            )
            .values(**values)
        )
        await db.commit()


async def stream_ids(head: BufferHead, namespace: str) -> list[bytes]:
    return [
        entry_id for entry_id, _ in await valkey().xrange(buffer_keys(head.scope, namespace).stream)
    ]


def gauge(name: str) -> float | None:
    return REGISTRY.get_sample_value(name)


def poison_count() -> float:
    sample = REGISTRY.get_sample_value(
        "uniffy_realtime_checkpoint_poison_total", {"reason": "undecodable"}
    )
    return sample or 0.0


async def maintenance_cycle(buffer: UpdateBuffer, now_ms: int | None = None) -> dict:
    totals: dict = {}
    for _ in range(100):
        report = await maintain_buffer(buffer, now_ms=now_ms)
        for action, count in report.actions.items():
            totals[action] = totals.get(action, 0) + count
        if report.cycle_complete:
            return totals
    raise AssertionError("buffer maintenance never completed a walk of the key space")


async def test_cleanup_after_a_commit_keeps_the_append_that_arrived_after_capture(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    alice, bob, carol = (edit(env.base, name) for name in (" Alice", " Bob", " Carol"))
    alice_process = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUDGET)
    bob_process = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUDGET)
    await admit(env, head, "u-alice", alice, buffer=alice_process)
    await admit(env, head, "u-bob", bob, actor=env.bob, buffer=bob_process)
    window = await valkey().zscore(keys.due, head.scope.member)
    first_ms = await valkey().hget(keys.control, "first_ms")

    capture = await capture_checkpoint(env.buffer, head.scope)
    await admit(env, head, "u-carol", carol, actor=env.carol)
    committed = await commit_checkpoint(env.buffer, capture)
    trimmed = await clean_checkpoint(env.buffer, head.scope)

    assert isinstance(capture, CheckpointCapture)
    assert [record.update_id for record in capture.updates] == ["u-alice", "u-bob"]
    assert (committed.status, committed.covered, committed.records) == (
        CheckpointStatus.COMMITTED,
        2,
        2,
    )
    row = await stored_row(env.key)
    assert (row.checkpoint_seq, row.revision, row.actor_id) == (
        2,
        head.checkpoint_revision + 1,
        env.bob,
    )
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert trimmed == TrimResult(len(alice) + len(bob), 2, 1)
    assert await stream_ids(head, env.namespace) == [b"3-0"]
    assert set(await valkey().hkeys(keys.receipts)) == {b"u-carol"}
    assert await valkey().zscore(keys.due, head.scope.member) == window
    assert await valkey().hget(keys.control, "first_ms") == first_ms
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(len(carol), 1)

    later = await checkpoint_document(env.buffer, head.scope, enqueue=env.jobs)

    assert (later.status, later.covered) == (CheckpointStatus.COMMITTED, 3)
    assert "Carol" in text_of((await stored_row(env.key)).updates)
    assert await valkey().xlen(keys.stream) == 0
    assert await valkey().zscore(keys.due, head.scope.member) is None
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)


async def rpc_merge(env: SimpleNamespace, incoming: str) -> RealtimeYjsSnapshot:
    """An ordinary text write committing over live state, cleanup included."""
    async with open_session() as db:
        await lock_document(db, env.key, env.org)
        merge = await stage_text_merge(
            env.buffer,
            db,
            env.key,
            env.org,
            env.carol,
            base="base",
            stored="base",
            incoming=incoming,
        )
        await db.commit()
    await merge.after_commit()
    return await stored_row(env.key)


@pytest.mark.parametrize("appended", [False, True], ids=["covered", "carol-appends"])
async def test_commit_over_a_stale_capture_retries_from_the_newer_row(env, appended) -> None:
    head = await establish(env)
    await admit(env, head, "u-alice", edit(env.base, " Alice"))
    await admit(env, head, "u-bob", edit(env.base, " Bob"), actor=env.bob)

    capture = await capture_checkpoint(env.buffer, head.scope)
    rpc = await rpc_merge(env, "RPC base")
    if appended:
        await admit(env, head, "u-carol", edit(rpc.updates, " Carol"), actor=env.carol)
    result = await commit_checkpoint(env.buffer, capture)

    assert isinstance(capture, CheckpointCapture)
    assert capture.revision == head.checkpoint_revision < rpc.revision
    assert rpc.checkpoint_seq == 2
    row = await stored_row(env.key)
    assert (row.generation, row.buffer_epoch) == (head.scope.generation, head.scope.epoch)
    if appended:
        # The recapture finds only Carol's append past the write's watermark.
        assert (result.status, result.retries, result.covered) == (
            CheckpointStatus.COMMITTED,
            1,
            3,
        )
        assert (row.revision, row.checkpoint_seq) == (rpc.revision + 1, 3)
    else:
        assert (result.status, result.retries, result.covered) == (CheckpointStatus.CLEAN, 1, 2)
        assert (row.revision, row.checkpoint_seq) == (rpc.revision, 2)
    merged = text_of(row.updates)
    assert all(word in merged for word in ("RPC", "Alice", "Bob"))
    assert ("Carol" in merged) is appended
    assert await stream_ids(head, env.namespace) == ([b"3-0"] if appended else [])


async def test_cleanup_rerun_after_a_lost_trim_removes_only_the_committed_prefix(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    window = await valkey().zscore(keys.due, head.scope.member)

    # The worker commits through 2 and dies before its cleanup runs.
    committed = await commit_checkpoint(env.buffer, await capture_checkpoint(env.buffer, head.scope))
    carol = edit(env.base, " Carol")
    await admit(env, head, "u-3", carol)
    actions = await maintenance_cycle(env.buffer)

    assert (committed.status, committed.covered) == (CheckpointStatus.COMMITTED, 2)
    assert actions == {MaintenanceAction.CLEANED: 1}
    assert await stream_ids(head, env.namespace) == [b"3-0"]
    assert set(await valkey().hkeys(keys.receipts)) == {b"u-3"}
    assert (await stored_row(env.key)).checkpoint_seq == 2
    assert await valkey().zscore(keys.due, head.scope.member) == window
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(len(carol), 1)


async def test_maintenance_reschedules_a_surviving_stream_after_its_due_and_claim_vanish(
    env,
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    first_ms = int(await valkey().hget(keys.control, "first_ms"))
    lost = Recorder()

    dispatched = await dispatch_due(env.buffer, enqueue=lost, now_ms=FAR_FUTURE_MS)
    await valkey().delete(keys.due, claim_key(head.scope, env.namespace))
    nothing_due = await dispatch_due(env.buffer, enqueue=lost, now_ms=FAR_FUTURE_MS)
    actions = await maintenance_cycle(env.buffer)
    rescheduled = await valkey().zscore(keys.due, head.scope.member)
    worker = Inline(env.buffer)
    recovered = await dispatch_due(env.buffer, enqueue=worker, now_ms=FAR_FUTURE_MS)

    assert dispatched == DispatchReport(due=1, early=0, claimed=1, enqueued=1)
    assert nothing_due == DispatchReport(due=0, early=0, claimed=0, enqueued=0)
    assert actions == {MaintenanceAction.RESCHEDULED: 1}
    assert rescheduled == first_ms + DUE_DELAY_MS
    assert recovered.enqueued == 1
    assert [(result.status, result.covered) for result in worker.results] == [
        (CheckpointStatus.COMMITTED, 2)
    ]
    row = await stored_row(env.key)
    assert row.checkpoint_seq == 2
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert await valkey().xlen(keys.stream) == 0
    assert await valkey().zscore(keys.due, head.scope.member) is None
    assert await valkey().exists(claim_key(head.scope, env.namespace)) == 0


async def test_idle_documents_get_no_checkpoint_writes(env) -> None:
    for key in env.keys:
        await establish(env, key)
    before = [await stored_row(key) for key in env.keys]
    jobs = Recorder()

    dispatched = await dispatch_due(env.buffer, enqueue=jobs, now_ms=FAR_FUTURE_MS)
    actions = await maintenance_cycle(env.buffer)
    report = await checkpoint_all_pending(env.buffer, enqueue=jobs)

    assert dispatched == DispatchReport(due=0, early=0, claimed=0, enqueued=0)
    # Fresh epochs are neither due nor idle long enough to give up their keys.
    assert actions == {MaintenanceAction.KEPT: len(env.keys)}
    assert report == CheckpointReport(streams=0, checkpointed=0, records=0, unreadable=())
    assert jobs.jobs == []
    after = [await stored_row(key) for key in env.keys]
    assert [(row.updates, row.revision, row.checkpoint_seq, row.updated_at) for row in after] == [
        (row.updates, row.revision, row.checkpoint_seq, row.updated_at) for row in before
    ]
    assert [key async for key in valkey().scan_iter(match=f"{env.namespace}*:stream:*")] == []


async def test_restored_older_buffer_state_never_checkpoints_a_lost_receipt_sequence(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    alice, bob = edit(env.base, " Alice"), edit(env.base, " Bob")
    await admit(env, head, "u-alice", alice)
    bob_receipt = (await admit(env, head, "u-bob", bob, actor=env.bob)).receipt
    # Valkey restarted from an older persisted state: Bob's append never reached disk.
    await valkey().xdel(keys.stream, "2-0")
    await valkey().hset(keys.control, mapping={"head": 1, "bytes": len(alice), "records": 1})
    await valkey().hdel(keys.receipts, "u-bob")
    await valkey().hincrby(accounting_key(head.scope.bucket, env.namespace), "bytes", -len(bob))
    await valkey().hincrby(accounting_key(head.scope.bucket, env.namespace), "records", -1)
    await set_row(env.key, valkey_run_id=STALE_RUN_ID)

    stale_pass = await checkpoint_document(env.buffer, head.scope, enqueue=env.jobs)
    fresh = await establish(env)
    mallory = await admit(env, fresh, "u-mallory", edit(env.base, " Mallory"), actor=env.carol)
    saved = await checkpoint_document(env.buffer, fresh.scope, enqueue=env.jobs)

    assert (stale_pass.status, stale_pass.covered) == (CheckpointStatus.RESET, 0)
    assert fresh.scope.epoch != head.scope.epoch
    assert fresh.scope.generation == head.scope.generation
    assert bob_receipt == Receipt(head.scope.generation, head.scope.epoch, 2, "u-bob")
    assert mallory.receipt == Receipt(fresh.scope.generation, fresh.scope.epoch, 1, "u-mallory")
    # Progress names the new epoch, so a client holding Bob's receipt can never match it.
    assert (saved.status, saved.scope.epoch, saved.covered) == (
        CheckpointStatus.COMMITTED,
        fresh.scope.epoch,
        1,
    )
    row = await stored_row(env.key)
    assert (row.buffer_epoch, row.checkpoint_seq) == (fresh.scope.epoch, 1)
    text = text_of(row.updates)
    assert "Alice" in text and "Mallory" in text and "Bob" not in text
    assert await valkey().exists(keys.stream, keys.control, keys.receipts) == 0


async def test_a_poisoned_document_keeps_its_bytes_and_backs_off_while_others_checkpoint(
    env,
) -> None:
    heads = [await establish(env, key) for key in env.keys]
    for head, base in zip(heads, env.bases, strict=True):
        await admit(env, head, "u-1", edit(base, " Alice"))
    poisoned = heads[0]
    await admit(env, poisoned, "u-2", b"not a yjs update")
    poisoned_keys = buffer_keys(poisoned.scope, env.namespace)
    stored = await valkey().xrange(poisoned_keys.stream)
    poison_before = poison_count()
    worker = Inline(env.buffer)

    first = await dispatch_due(env.buffer, enqueue=worker, now_ms=FAR_FUTURE_MS)
    second = await dispatch_due(env.buffer, enqueue=worker, now_ms=FAR_FUTURE_MS)

    assert (first.enqueued, second.enqueued) == (3, 0)
    statuses = {result.scope: result.status for result in worker.results}
    assert statuses == {
        poisoned.scope: CheckpointStatus.POISONED,
        heads[1].scope: CheckpointStatus.COMMITTED,
        heads[2].scope: CheckpointStatus.COMMITTED,
    }
    row = await stored_row(env.keys[0])
    assert (row.checkpoint_seq, row.revision, row.updates) == (
        0,
        poisoned.checkpoint_revision,
        env.bases[0],
    )
    assert await valkey().xrange(poisoned_keys.stream) == stored
    assert await valkey().pttl(claim_key(poisoned.scope, env.namespace)) > CLAIM_TTL_SECONDS * 1000
    assert poison_count() == poison_before + 1
    for head, key in zip(heads[1:], env.keys[1:], strict=True):
        assert (await stored_row(key)).checkpoint_seq == 1
        assert await valkey().xlen(buffer_keys(head.scope, env.namespace).stream) == 0


async def test_dispatch_claim_suppresses_repeat_enqueues_until_it_expires(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    window = int(await valkey().zscore(keys.due, head.scope.member))
    jobs = Recorder()

    first = await dispatch_due(env.buffer, enqueue=jobs, now_ms=FAR_FUTURE_MS, claim_seconds=1)
    held = await dispatch_due(env.buffer, enqueue=jobs, now_ms=FAR_FUTURE_MS, claim_seconds=1)
    await asyncio.sleep(1.2)
    expired = await dispatch_due(env.buffer, enqueue=jobs, now_ms=FAR_FUTURE_MS, claim_seconds=1)

    assert (first.claimed, held.claimed, expired.claimed) == (1, 0, 1)
    job_id = checkpoint_job_id(head.scope, window, env.namespace)
    assert [(name, queued_id) for name, queued_id, _ in jobs.jobs] == [
        (CHECKPOINT_REALTIME_DOCUMENT.name, job_id),
        (CHECKPOINT_REALTIME_DOCUMENT.name, job_id),
    ]
    assert jobs.jobs[0][2][0] == head.scope.member
    # Enqueueing never removes due work; only cleanup after a commit does.
    assert await valkey().zscore(keys.due, head.scope.member) == window


async def test_oversized_pending_tail_dispatches_before_its_due_window(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, "a" * 600_000))
    await admit(env, head, "u-2", edit(env.base, "b" * 600_000))
    window = int(await valkey().zscore(keys.due, head.scope.member))
    jobs = Recorder()

    report = await dispatch_due(env.buffer, enqueue=jobs)

    assert report == DispatchReport(due=0, early=1, claimed=1, enqueued=1)
    assert [job_id for _, job_id, _ in jobs.jobs] == [
        checkpoint_job_id(head.scope, window, env.namespace)
    ]


@pytest_asyncio.fixture(loop_scope="session")
async def arq_queue(valkey_namespace) -> AsyncIterator[ArqValkey]:
    pool = await create_pool(
        ValkeyConfig.from_env().to_arq_valkey_settings(),
        default_queue_name=f"{valkey_namespace}queue",
    )
    try:
        yield pool
    finally:
        # ARQ keys its job records outside the queue name; job ids carry the namespace.
        keys = [key async for key in pool.scan_iter(match=f"arq:*{valkey_namespace}*", count=1000)]
        if keys:
            await pool.delete(*keys)
        await pool.aclose(close_connection_pool=True)


def queue_enqueuer(pool: ArqValkey):
    async def enqueue(ref: JobRef, job_id: str, args: tuple[str, ...]) -> JobEnqueueOutcome:
        job = await pool.enqueue_job(ref.name, *args, _job_id=job_id)
        return JobEnqueueOutcome.ENQUEUED if job else JobEnqueueOutcome.DEDUPLICATED

    return enqueue


async def drain_queue(pool: ArqValkey, env: SimpleNamespace) -> None:
    async def checkpoint(ctx: dict[str, Any], member: str, claim: str) -> str:
        return (await run_checkpoint_job(env.buffer, member, claim, enqueue=env.jobs)).status.value

    worker = Worker(
        [func(checkpoint, name=CHECKPOINT_REALTIME_DOCUMENT.name, keep_result=3600)],
        queue_name=pool.default_queue_name,
        valkey_pool=pool,
        burst=True,
        handle_signals=False,
        poll_delay=0.01,
    )
    await worker.main()


async def queued(pool: ArqValkey) -> list[str]:
    return [job_id.decode() for job_id in await pool.zrange(pool.default_queue_name, 0, -1)]


async def test_each_due_window_gets_its_own_job_id_so_a_retained_result_cannot_suppress_it(
    env, arq_queue
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    enqueue = queue_enqueuer(arq_queue)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    first_window = int(await valkey().zscore(keys.due, head.scope.member))

    await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    first_jobs = await queued(arq_queue)
    await drain_queue(arq_queue, env)
    retained = await Job(first_jobs[0], arq_queue).result_info()
    reused = await arq_queue.enqueue_job(CHECKPOINT_REALTIME_DOCUMENT.name, _job_id=first_jobs[0])
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    second_window = int(await valkey().zscore(keys.due, head.scope.member))
    second = await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    second_jobs = await queued(arq_queue)
    await drain_queue(arq_queue, env)

    assert first_jobs == [checkpoint_job_id(head.scope, first_window, env.namespace)]
    assert retained is not None and retained.result == CheckpointStatus.COMMITTED.value
    assert reused is None
    assert second_window != first_window
    assert second.enqueued == 1
    assert second_jobs == [checkpoint_job_id(head.scope, second_window, env.namespace)]
    row = await stored_row(env.key)
    assert row.checkpoint_seq == 2
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}


async def test_checkpoint_now_covers_streams_without_due_markers_and_reports_what_it_cannot_read(
    env,
) -> None:
    heads = [await establish(env, key) for key in env.keys]
    scheduled, unscheduled, broken = heads
    await admit(env, scheduled, "u-1", edit(env.bases[0], " Alice"))
    await admit(env, scheduled, "u-2", edit(env.bases[0], " Bob"))
    await admit(env, unscheduled, "u-1", edit(env.bases[1], " Carol"))
    await valkey().zrem(buffer_keys(unscheduled.scope, env.namespace).due, unscheduled.scope.member)
    for index, name in enumerate((" Dan", " Erin", " Frank"), start=1):
        await admit(env, broken, f"u-{index}", edit(env.bases[2], name))
    await valkey().xdel(buffer_keys(broken.scope, env.namespace).stream, "2-0")

    report = await checkpoint_all_pending(env.buffer, enqueue=env.jobs)

    assert report == CheckpointReport(
        streams=3,
        checkpointed=2,
        records=3,
        unreadable=(UnreadableStream(broken.scope.member, "gap", 1),),
    )
    assert (await stored_row(env.keys[0])).checkpoint_seq == 2
    assert "Carol" in text_of((await stored_row(env.keys[1])).updates)
    recovered = await stored_row(env.keys[2])
    assert recovered.buffer_epoch != broken.scope.epoch
    assert text_of(recovered.updates) == "base Dan"


@pytest_asyncio.fixture(loop_scope="session")
async def doc_messages(env) -> AsyncIterator[Any]:
    await init_pubsub()
    client = aioredis.from_url(ValkeyConfig.from_env().to_url())
    subscription = client.pubsub()
    await subscription.subscribe(doc_channel(*env.key))
    try:
        yield subscription
    finally:
        await subscription.aclose()
        await client.aclose()
        await close_pubsub()


async def test_commit_publishes_progress_and_enqueues_projection_for_the_new_revision(
    env, doc_messages
) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    jobs = Recorder()

    result = await checkpoint_document(env.buffer, head.scope, enqueue=jobs)
    payloads = []
    for _ in range(50):
        message = await doc_messages.get_message(ignore_subscribe_messages=True, timeout=0.1)
        if message is not None:
            payloads.append(loads(message["data"]))
        if len(payloads) == 2:
            break

    def progress(covered: int, revision: int) -> dict:
        return {
            "kind": "checkpoint_progress",
            "generation": head.scope.generation,
            "epoch": head.scope.epoch,
            "covered_sequence": covered,
            "checkpoint_revision": revision,
        }

    # Binding the first epoch announces it before the checkpoint covers anything.
    assert [
        {
            key: value
            for key, value in payload.items()
            if key not in {"origin_replica", "published_at"}
        }
        for payload in payloads
    ] == [progress(0, head.checkpoint_revision), progress(1, result.revision)]
    assert jobs.jobs == [
        (
            SAVE_REALTIME_SNAPSHOT.name,
            f"{env.namespace}projection:{ContentType.NOTE.value}:{env.key[1]}:{result.revision}",
            (ContentType.NOTE.value, str(env.key[1]), str(env.org)),
        )
    ]


async def test_projection_payload_runs_through_the_registered_core_handler(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    jobs = Recorder()
    result = await checkpoint_document(env.buffer, head.scope, enqueue=jobs)
    ((name, job_id, payload),) = jobs.jobs
    registration = next(item for item in CORE_JOB_REGISTRATIONS if item.ref.name == name)
    (listed,) = [entry for entry in worker_inventory() if entry.ref is registration.ref]

    first = await registration.handler({"job_try": 1}, *payload)
    projected = await stored_row(env.key)
    replayed = await registration.handler({"job_try": 1}, *payload)

    # Projection recovers from PostgreSQL, unlike the buffered checkpoint that enqueued it.
    assert listed.ref.reliability is JobReliability.DURABLE
    assert listed.ref.recovery is not None
    assert listed.ref.recovery.store is RecoveryStore.POSTGRESQL
    note_id = env.key[1]
    assert (
        job_id == f"{env.namespace}projection:{ContentType.NOTE.value}:{note_id}:{result.revision}"
    )
    assert (
        first
        == replayed
        == {"status": SnapshotOutcome.RENDERED.value, "content_id": str(env.key[1])}
    )
    assert projected.rendered_revision == projected.revision == result.revision
    assert (projected.checkpoint_seq, projected.buffer_epoch) == (1, head.scope.epoch)
    again = await stored_row(env.key)
    assert (again.revision, again.rendered_revision, again.updated_at) == (
        projected.revision,
        projected.rendered_revision,
        projected.updated_at,
    )
    async with open_session() as db:
        note = await db.get(Note, env.key[1])
    assert note is not None and note.content == "base Alice"


async def test_checkpoint_collects_deleted_content_and_projection_keeps_its_bytes(env) -> None:
    head = await establish(env)
    doc = pycrdt.Doc()
    doc.apply_update(env.base)
    text = markdown_text(doc)
    frames = []
    for index in range(20):
        before = doc.get_state()
        text.insert(len(str(text)), "x" * 5000)
        frames.append(doc.get_update(before))
        before = doc.get_state()
        del text[len("base") :]
        frames.append(doc.get_update(before))
        await admit(env, head, f"u-{index}-insert", frames[-2])
        await admit(env, head, f"u-{index}-delete", frames[-1])

    committed = await checkpoint_document(env.buffer, head.scope, enqueue=env.jobs)
    checkpointed = await stored_row(env.key)
    outcome = await persist_snapshot(*env.key, env.org)

    projected = await stored_row(env.key)
    async with open_session() as db:
        note = await db.get(Note, env.key[1])
    assert (committed.status, committed.covered) == (CheckpointStatus.COMMITTED, len(frames))
    assert text_of(checkpointed.updates) == "base"
    assert len(checkpointed.updates) * 100 < len(pycrdt.merge_updates(env.base, *frames))
    assert outcome is SnapshotOutcome.RENDERED
    assert projected.updates == checkpointed.updates
    assert note is not None and note.content == "base"


async def test_a_checkpoint_rejected_after_an_interrupted_run_keeps_no_result_for_its_window(
    env, arq_queue
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    window = int(await valkey().zscore(keys.due, head.scope.member))
    job_id = checkpoint_job_id(head.scope, window, env.namespace)
    registered = next(
        registration.to_arq()
        for registration in CORE_JOB_REGISTRATIONS
        if registration.ref is CHECKPOINT_REALTIME_DOCUMENT
    )
    await arq_queue.enqueue_job(registered.name, head.scope.member, "claim", _job_id=job_id)
    # A worker restart cancelled the earlier run after its try was counted.
    await arq_queue.set(retry_key_prefix + job_id, 1)

    await Worker(
        [registered],
        queue_name=arq_queue.default_queue_name,
        valkey_pool=arq_queue,
        burst=True,
        handle_signals=False,
        poll_delay=0.01,
    ).main()
    again = await arq_queue.enqueue_job(registered.name, head.scope.member, "claim", _job_id=job_id)

    assert await Job(job_id, arq_queue).result_info() is None
    assert again is not None
    assert await queued(arq_queue) == [job_id]
    assert (await stored_row(env.key)).checkpoint_seq == 0


async def test_backed_off_documents_leave_the_due_head_so_newer_work_still_dispatches(
    env, bucket_mates
) -> None:
    held_keys = await bucket_mates(0, DUE_SCAN)
    (healthy_key,) = await bucket_mates(0, 1)
    held = [await establish(env, key) for key in held_keys]
    healthy = await establish(env, healthy_key)
    for head in held:
        await admit(env, head, "u-1", b"not a yjs update")
    held_window = int(
        await valkey().zscore(buffer_keys(held[-1].scope, env.namespace).due, held[-1].scope.member)
    )
    worker = Inline(env.buffer)

    for _ in range(DUE_SCAN // DUE_BATCH):
        await dispatch_due(env.buffer, enqueue=worker, now_ms=held_window)
    await admit(env, healthy, "u-1", b"pending")
    window = int(
        await valkey().zscore(buffer_keys(healthy.scope, env.namespace).due, healthy.scope.member)
    )
    jobs = Recorder()
    report = await dispatch_due(env.buffer, enqueue=jobs, now_ms=window)

    assert {result.status for result in worker.results} == {CheckpointStatus.POISONED}
    assert {result.scope for result in worker.results} == {head.scope for head in held}
    assert report.enqueued == 1
    assert [job_id for _, job_id, _ in jobs.jobs] == [
        checkpoint_job_id(healthy.scope, window, env.namespace)
    ]


async def test_maintenance_recounts_one_bucket_per_period_from_its_streams(env) -> None:
    head = await establish(env)
    payload = edit(env.base, " Alice")
    await admit(env, head, "u-1", payload)
    bucket = head.scope.bucket
    drifted = PendingUsage(999_999, 7)
    await valkey().hset(
        accounting_key(bucket, env.namespace),
        mapping={"bytes": drifted.bytes, "records": drifted.records},
    )

    await maintain_buffer(env.buffer, now_ms=(bucket + 1) % BUCKET_COUNT * REPAIR_ROTATION_MS)
    elsewhere = await env.buffer.bucket_usage(bucket)
    await maintain_buffer(env.buffer, now_ms=bucket * REPAIR_ROTATION_MS)

    assert elsewhere == drifted
    assert await env.buffer.bucket_usage(bucket) == PendingUsage(len(payload), 1)


async def test_dispatch_reports_the_age_of_the_oldest_pending_edit(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    first_ms = int(await valkey().hget(keys.control, "first_ms"))
    now = first_ms + DUE_DELAY_MS + 5_000

    await dispatch_due(env.buffer, enqueue=Recorder(), now_ms=now)
    pending = gauge("uniffy_realtime_buffer_oldest_pending_seconds")
    waiting = gauge("uniffy_realtime_checkpoint_queue_age_seconds")
    await env.buffer.trim_committed(head.scope, 1)
    await dispatch_due(env.buffer, enqueue=Recorder(), now_ms=now)

    assert (pending, waiting) == (15.0, 5.0)
    assert gauge("uniffy_realtime_buffer_oldest_pending_seconds") == 0.0


def reclaimed(kind: str) -> float:
    return REGISTRY.get_sample_value("uniffy_realtime_buffer_reclaimed_total", {"kind": kind}) or 0.0


def retired_records_dropped() -> float:
    sample = REGISTRY.get_sample_value("uniffy_realtime_buffer_retired_records_dropped_total")
    return sample or 0.0


async def idle_after(head: BufferHead, namespace: str) -> int:
    """The first instant at which the epoch counts as idle."""
    last_ms = await valkey().hget(buffer_keys(head.scope, namespace).control, "last_ms")
    return int(last_ms) + IDLE_RECLAIM_MS + 1


async def attach(env: SimpleNamespace) -> LatestState:
    """Settle the document the way an opening editor hydrates it."""
    async with open_session() as db:
        await lock_document(db, env.key, env.org)
        state = await latest_under_lock(env.buffer, db, env.key, env.org)
        await db.commit()
    return state


@pytest.mark.parametrize("cleanup", ["trimmed", "lost"])
async def test_idle_epoch_gives_up_its_keys_and_the_next_attach_starts_a_fresh_epoch(
    env, cleanup
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    alice = edit(env.base, " Alice")
    await admit(env, head, "u-1", alice)
    capture = await capture_checkpoint(env.buffer, head.scope)
    assert isinstance(capture, CheckpointCapture)
    await commit_checkpoint(env.buffer, capture)
    if cleanup == "trimmed":
        await clean_checkpoint(env.buffer, head.scope)
    else:
        # The worker died before its cleanup and the due entry was lost with the queue.
        await valkey().zrem(keys.due, head.scope.member)
    pending = await env.buffer.bucket_usage(head.scope.bucket)
    before = await stored_row(env.key)
    counted = reclaimed("idle")

    actions = await maintenance_cycle(env.buffer, now_ms=await idle_after(head, env.namespace))

    after = await stored_row(env.key)
    assert pending == (PendingUsage(0, 0) if cleanup == "trimmed" else PendingUsage(len(alice), 1))
    assert actions == {MaintenanceAction.RECLAIMED: 1}
    assert reclaimed("idle") == counted + 1
    assert await valkey().exists(keys.stream, keys.control, keys.receipts) == 0
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)
    assert (after.buffer_epoch, after.valkey_run_id, after.checkpoint_seq) == (None, None, 0)
    assert (after.generation, after.revision, after.updates) == (
        before.generation,
        before.revision,
        before.updates,
    )

    state = await attach(env)
    bob = await env.buffer.admit(
        state.head, update_id="u-2", update=edit(after.updates, " Bob"), actor_id=env.bob
    )
    saved = await checkpoint_document(env.buffer, state.head.scope, enqueue=env.jobs)

    assert state.head.scope.epoch != head.scope.epoch
    assert state.head.scope.generation == head.scope.generation
    assert (state.head.head_seq, state.head.checkpoint_seq, state.tail) == (0, 0, ())
    assert text_of(state.checkpoint) == "base Alice"
    assert bob == AdmissionOutcome(
        AdmissionStatus.ACCEPTED,
        Receipt(head.scope.generation, state.head.scope.epoch, 1, "u-2"),
    )
    assert (saved.status, saved.covered) == (CheckpointStatus.COMMITTED, 1)
    assert text_of((await stored_row(env.key)).updates) == "base Alice Bob"


@pytest.mark.parametrize("busy", ["due", "pending", "recent"])
async def test_reclaim_leaves_a_due_entry_a_pending_tail_and_a_recent_edit_alone(env, busy) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    if busy == "due":
        capture = await capture_checkpoint(env.buffer, head.scope)
        assert isinstance(capture, CheckpointCapture)
        await commit_checkpoint(env.buffer, capture)
    elif busy == "recent":
        await checkpoint_document(env.buffer, head.scope, enqueue=env.jobs)
    idle = await idle_after(head, env.namespace)
    counted = reclaimed("idle")

    actions = await maintenance_cycle(env.buffer, now_ms=None if busy == "recent" else idle)

    expected = {
        "due": MaintenanceAction.CLEANED,
        "pending": MaintenanceAction.KEPT,
        "recent": MaintenanceAction.KEPT,
    }[busy]
    assert actions == {expected: 1}
    assert reclaimed("idle") == counted
    assert (await stored_row(env.key)).buffer_epoch == head.scope.epoch
    assert await valkey().hget(keys.control, "head") == b"1"
    assert await valkey().xlen(keys.stream) == (1 if busy == "pending" else 0)
    assert (await valkey().zscore(keys.due, head.scope.member) is None) == (busy != "pending")


async def test_orphan_controls_of_a_rolled_back_epoch_and_a_deleted_row_are_reclaimed(
    env,
) -> None:
    head = await establish(env)
    async with open_session() as db:
        await lock_document(db, env.key, env.org)
        row = await load_snapshot(db, env.key)
        identity = server_identity()
        assert row is not None and identity is not None
        rolled_back = await start_epoch(env.buffer, row, env.org, identity)
        await db.rollback()
    deleted = await establish(env, env.keys[1])
    async with open_session() as db:
        await db.execute(
            delete(RealtimeYjsSnapshot).where(RealtimeYjsSnapshot.content_id == env.keys[1][1])
        )
        await db.commit()
    orphans = [buffer_keys(scope, env.namespace) for scope in (rolled_back, deleted.scope)]
    present = [await valkey().exists(keys.control) for keys in orphans]
    counted = reclaimed("orphan")

    actions = await maintenance_cycle(env.buffer)

    assert present == [1, 1]
    assert actions == {
        CheckpointStatus.STALE: 1,
        CheckpointStatus.OBSOLETE: 1,
        MaintenanceAction.KEPT: 1,
    }
    assert reclaimed("orphan") == counted + 2
    assert [await valkey().exists(keys.control) for keys in orphans] == [0, 0]
    assert await valkey().hget(buffer_keys(head.scope, env.namespace).control, "head") == b"0"
    assert (await stored_row(env.key)).buffer_epoch == head.scope.epoch


async def test_records_a_retired_epoch_kept_are_dropped_and_counted_past_retention(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    frank = edit(env.base, " Frank")
    for index, payload in enumerate((edit(env.base, " Dan"), edit(env.base, " Erin"), frank)):
        await admit(env, head, f"u-{index + 1}", payload)
    await valkey().xdel(keys.stream, "2-0")
    # The gap moves the document to a fresh epoch; the record past it stays for investigation.
    reset = await checkpoint_document(env.buffer, head.scope, enqueue=env.jobs)
    kept = await valkey().xrange(keys.stream)
    newest = parse_record(*kept[-1])
    assert newest is not None
    retained = await env.buffer.bucket_usage(head.scope.bucket)
    counted = retired_records_dropped()

    young = await maintenance_cycle(env.buffer, now_ms=newest.accepted_at_ms + RETIRED_RETENTION_MS)
    still = await valkey().xrange(keys.stream)
    old = await maintenance_cycle(
        env.buffer, now_ms=newest.accepted_at_ms + RETIRED_RETENTION_MS + 1
    )

    assert reset.status is CheckpointStatus.RESET
    assert [entry_id for entry_id, _ in kept] == [b"3-0"]
    assert retained == PendingUsage(len(frank), 1)
    # A week later the fresh epoch is idle too and gives up its keys in the same walk.
    assert young == {CheckpointStatus.STALE: 1, MaintenanceAction.RECLAIMED: 1}
    assert still == kept
    assert old == {MaintenanceAction.DROPPED: 1}
    assert retired_records_dropped() == counted + 1
    assert await valkey().exists(keys.stream) == 0
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)
    assert text_of((await stored_row(env.key)).updates) == "base Dan"
