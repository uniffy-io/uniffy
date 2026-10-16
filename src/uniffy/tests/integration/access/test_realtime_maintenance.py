"""Buffer maintenance: idle reclaim, orphan and retired keys, and accounting on live services."""

from types import SimpleNamespace

import pytest
from sqlalchemy import delete

from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.admission import latest_under_lock
from uniffy.core.realtime.buffer_keys import (
    BUCKET_COUNT,
    AdmissionOutcome,
    AdmissionStatus,
    BufferHead,
    LatestState,
    PendingUsage,
    Receipt,
    accounting_key,
    buffer_keys,
    parse_record,
    stored_bytes,
)
from uniffy.core.realtime.checkpoint import (
    CheckpointCapture,
    CheckpointReport,
    CheckpointStatus,
    capture_checkpoint,
    checkpoint_all_pending,
    checkpoint_document,
    clean_checkpoint,
    commit_checkpoint,
)
from uniffy.core.realtime.dispatch import DispatchReport, dispatch_due
from uniffy.core.realtime.epoch import start_epoch
from uniffy.core.realtime.maintenance import (
    IDLE_RECLAIM_MS,
    REPAIR_ROTATION_MS,
    RETIRED_RETENTION_MS,
    MaintenanceAction,
    maintain_buffer,
)
from uniffy.core.realtime.storage import load_snapshot, lock_document
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.binary import server_identity
from uniffy.tests.integration.access.realtime_buffers import (
    FAR_FUTURE_MS,
    admit,
    edit,
    env,  # noqa: F401 - fixture
    establish,
    gauge,
    maintenance_cycle,
    stored_row,
)
from uniffy.tests.integration.access.realtime_live import Recorder, text_of, valkey

pytestmark = pytest.mark.asyncio(loop_scope="session")


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
    assert await env.buffer.bucket_usage(bucket) == PendingUsage(stored_bytes("u-1", payload), 1)


async def test_maintenance_walks_buffered_documents_without_visiting_unrelated_keys(env) -> None:
    heads = [await establish(env, key) for key in env.keys]
    await admit(env, heads[0], "u-1", edit(env.base, " Alice"))
    async with valkey().pipeline(transaction=False) as pipe:
        for index in range(25_000):
            pipe.set(f"{env.namespace}unrelated:{index}", b"x")
        await pipe.execute()

    report = await maintain_buffer(env.buffer, scan_calls=BUCKET_COUNT)

    # A keyspace SCAN of the same length would visit at most 16,000 keys and stop half way.
    assert report.cycle_complete
    assert report.documents == len(heads)
    assert report.actions == {MaintenanceAction.KEPT: len(heads)}


def reclaimed(kind: str) -> float:
    return gauge("uniffy_realtime_buffer_reclaimed_total", {"kind": kind})


def retired_records_dropped() -> float:
    return gauge("uniffy_realtime_buffer_retired_records_dropped_total")


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
    assert pending == (
        PendingUsage(0, 0) if cleanup == "trimmed" else PendingUsage(stored_bytes("u-1", alice), 1)
    )
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
    assert retained == PendingUsage(stored_bytes("u-3", frank), 1)
    # A week later the fresh epoch is idle too and gives up its keys in the same walk.
    assert young == {CheckpointStatus.STALE: 1, MaintenanceAction.RECLAIMED: 1}
    assert still == kept
    assert old == {MaintenanceAction.DROPPED: 1}
    assert retired_records_dropped() == counted + 1
    assert await valkey().exists(keys.stream) == 0
    assert await env.buffer.bucket_usage(head.scope.bucket) == PendingUsage(0, 0)
    assert text_of((await stored_row(env.key)).updates) == "base Dan"
