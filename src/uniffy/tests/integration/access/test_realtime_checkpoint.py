"""Checkpoint capture, commit and cleanup on live Valkey and PostgreSQL, in disposable keys."""

from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pycrdt
import pytest
import pytest_asyncio

from uniffy.core.jobs import JobReliability, RecoveryStore
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import (
    DUE_DELAY_MS,
    PendingUsage,
    Receipt,
    TrimResult,
    accounting_key,
    buffer_keys,
    stored_bytes,
)
from uniffy.core.realtime.checkpoint import (
    CheckpointCapture,
    CheckpointStatus,
    capture_checkpoint,
    checkpoint_document,
    clean_checkpoint,
    commit_checkpoint,
)
from uniffy.core.realtime.dispatch import CLAIM_TTL_SECONDS, claim_key, dispatch_due
from uniffy.core.realtime.job_contracts import PROJECT_REALTIME_DOCUMENT
from uniffy.core.realtime.live import stage_text_merge
from uniffy.core.realtime.maintenance import MaintenanceAction
from uniffy.core.realtime.markdown import markdown_text
from uniffy.core.realtime.snapshot import SnapshotOutcome, persist_snapshot
from uniffy.core.realtime.storage import lock_document
from uniffy.core.types import ContentType
from uniffy.infrastructure.database.session import open_session
from uniffy.tests.integration.access.realtime_buffers import (
    FAR_FUTURE_MS,
    STALE_RUN_ID,
    Inline,
    admit,
    edit,
    env,  # noqa: F401 - fixture
    establish,
    gauge,
    maintenance_cycle,
    set_row,
    stored_row,
    stream_ids,
)
from uniffy.tests.integration.access.realtime_live import (
    BUDGET,
    Recorder,
    doc_subscription,
    text_of,
    valkey,
)
from uniffy.workers.inventory import worker_inventory
from uniffy.workers.registry import CORE_JOB_REGISTRATIONS

pytestmark = pytest.mark.asyncio(loop_scope="session")


def poison_count() -> float:
    return gauge("uniffy_realtime_checkpoint_poison_total", {"reason": "undecodable"})


async def test_cleanup_after_a_commit_keeps_the_append_that_arrived_after_capture(env) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    alice, bob, carol = (edit(env.base, name) for name in (" Alice", " Bob", " Carol"))
    alice_process = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUDGET)
    bob_process = UpdateBuffer(namespace=env.namespace, pending_budget_bytes=BUDGET)
    await admit(env, head, "u-alice", alice, buffer=alice_process)
    await admit(env, head, "u-bob", bob, actor=env.bob, buffer=bob_process)
    window = int(await valkey().zscore(keys.due, head.scope.member))

    capture = await capture_checkpoint(env.buffer, head.scope)
    await admit(env, head, "u-carol", carol, actor=env.carol)
    committed = await commit_checkpoint(env.buffer, capture)
    trimmed = await clean_checkpoint(env.buffer, head.scope)
    carol_ms = int((await valkey().xrange(keys.stream))[0][1][b"t"])
    jobs = Recorder()
    early = await dispatch_due(env.buffer, enqueue=jobs, now_ms=carol_ms + DUE_DELAY_MS - 1)
    on_time = await dispatch_due(env.buffer, enqueue=jobs, now_ms=carol_ms + DUE_DELAY_MS)

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
    assert trimmed == TrimResult(stored_bytes("u-alice", alice) + stored_bytes("u-bob", bob), 2, 1)
    assert await stream_ids(head, env.namespace) == [b"3-0"]
    assert set(await valkey().hkeys(keys.receipts)) == {b"u-carol"}
    # Carol typed during the pass: her edit waits ten seconds from its own acceptance, so the
    # document is not due again at once.
    assert window <= carol_ms + DUE_DELAY_MS
    assert await valkey().zscore(keys.due, head.scope.member) == carol_ms + DUE_DELAY_MS
    assert await valkey().hget(keys.control, "first_ms") == str(carol_ms).encode()
    assert (early.due, on_time.due) == (0, 1)
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(
        stored_bytes("u-carol", carol), 1
    )

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

    # The worker commits through 2 and dies before its cleanup runs.
    committed = await commit_checkpoint(env.buffer, await capture_checkpoint(env.buffer, head.scope))
    carol = edit(env.base, " Carol")
    await admit(env, head, "u-3", carol)
    carol_ms = int((await valkey().xrange(keys.stream, min="3-0"))[0][1][b"t"])
    actions = await maintenance_cycle(env.buffer)

    assert (committed.status, committed.covered) == (CheckpointStatus.COMMITTED, 2)
    assert actions == {MaintenanceAction.CLEANED: 1}
    assert await stream_ids(head, env.namespace) == [b"3-0"]
    assert set(await valkey().hkeys(keys.receipts)) == {b"u-3"}
    assert (await stored_row(env.key)).checkpoint_seq == 2
    assert await valkey().zscore(keys.due, head.scope.member) == carol_ms + DUE_DELAY_MS
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(
        stored_bytes("u-3", carol), 1
    )


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


@pytest_asyncio.fixture(loop_scope="session")
async def doc_messages(env) -> AsyncIterator[Any]:
    async with doc_subscription(env.key) as subscription:
        yield subscription


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
            PROJECT_REALTIME_DOCUMENT.name,
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
