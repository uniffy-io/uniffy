"""Checkpoint dispatch, its claims and job identities, and on-demand checkpoints on live services."""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import select, text

from uniffy.core.jobs import JobEnqueueOutcome, JobRef
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.buffer import UPDATE_BUFFER_CTX_KEY
from uniffy.core.realtime.buffer_keys import DUE_DELAY_MS, buffer_keys, parse_member
from uniffy.core.realtime.checkpoint import (
    CheckpointReport,
    CheckpointStatus,
    UnreadableStream,
    checkpoint_all_pending,
)
from uniffy.core.realtime.dispatch import (
    CLAIM_TTL_SECONDS,
    DUE_BATCH,
    DUE_SCAN,
    EARLY_SCAN,
    DispatchReport,
    checkpoint_job_id,
    claim_key,
    dispatch_due,
    run_checkpoint_job,
)
from uniffy.core.realtime.job_contracts import CHECKPOINT_REALTIME_DOCUMENT
from uniffy.core.realtime.jobs import checkpoint_realtime_document
from uniffy.core.realtime.maintenance import MaintenanceAction
from uniffy.core.realtime.state import DocKey
from uniffy.infrastructure.database.session import open_session
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.tests.integration.access.realtime_buffers import (
    FAR_FUTURE_MS,
    Inline,
    admit,
    bucket_mates,  # noqa: F401 - fixture
    edit,
    env,  # noqa: F401 - fixture
    establish,
    gauge,
    maintenance_cycle,
    stored_row,
)
from uniffy.tests.integration.access.realtime_live import Recorder, text_of, valkey
from uniffy.vendor.arq import Worker, create_pool, func
from uniffy.vendor.arq.connections import ArqValkey
from uniffy.vendor.arq.constants import in_progress_key_prefix, retry_key_prefix
from uniffy.vendor.arq.jobs import Job
from uniffy.vendor.arq.worker import Function
from uniffy.workers.registry import CORE_JOB_REGISTRATIONS

pytestmark = pytest.mark.asyncio(loop_scope="session")


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
    assert [name for name, _, _ in jobs.jobs] == [CHECKPOINT_REALTIME_DOCUMENT.name] * 2
    assert {args[0] for _, _, args in jobs.jobs} == {head.scope.member}
    # Each dispatch carries its own claim and a job id of its own.
    assert [job_id for _, job_id, _ in jobs.jobs] == [
        checkpoint_job_id(head.scope, claim, env.namespace) for _, _, (_, claim) in jobs.jobs
    ]
    assert len({job_id for _, job_id, _ in jobs.jobs}) == 2
    # Enqueueing never removes due work; only cleanup after a commit does.
    assert await valkey().zscore(keys.due, head.scope.member) == window


async def test_oversized_pending_tail_dispatches_before_its_due_window(env) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, "a" * 600_000))
    await admit(env, head, "u-2", edit(env.base, "b" * 600_000))
    jobs = Recorder()

    report = await dispatch_due(env.buffer, enqueue=jobs)

    assert report == DispatchReport(due=0, early=1, claimed=1, enqueued=1)
    assert dispatched(jobs, env.namespace) == [head.scope.member]


async def test_oversized_document_dispatches_early_behind_many_newer_pending_documents(
    env, bucket_mates
) -> None:
    oversized_key, *quiet_keys = await bucket_mates(0, EARLY_SCAN + 2)
    oversized = await establish(env, oversized_key)
    keys = buffer_keys(oversized.scope, env.namespace)
    await admit(env, oversized, "u-1", b"a" * 600_000)
    await admit(env, oversized, "u-2", b"b" * 600_000)
    for key in quiet_keys:
        await admit(env, await establish(env, key), "u-1", b"pending")
    window = int(await valkey().zscore(keys.due, oversized.scope.member))
    jobs = Recorder()

    report = await dispatch_due(env.buffer, enqueue=jobs, now_ms=window - 1)

    assert report == DispatchReport(due=0, early=1, claimed=1, enqueued=1)
    assert dispatched(jobs, env.namespace) == [oversized.scope.member]


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


async def queued_claim(pool: ArqValkey, job_id: str) -> tuple[str, str]:
    """The document member and claim a queued checkpoint job carries."""
    job = await Job(job_id, pool).info()
    assert job is not None
    member, claim = job.args
    return member, claim


def dispatched(jobs: Recorder, namespace: str) -> list[str]:
    """Members of the recorded checkpoint jobs, each checked against the id its claim gives it."""
    members = []
    for _, job_id, (member, claim) in jobs.jobs:
        assert job_id == checkpoint_job_id(parse_member(member), claim, namespace)
        members.append(member)
    return members


async def test_each_dispatch_gets_its_own_job_id_so_a_retained_result_cannot_suppress_it(
    env, arq_queue
) -> None:
    head = await establish(env)
    enqueue = queue_enqueuer(arq_queue)
    await admit(env, head, "u-1", edit(env.base, " Alice"))

    await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    first_jobs = await queued(arq_queue)
    _, first_claim = await queued_claim(arq_queue, first_jobs[0])
    await drain_queue(arq_queue, env)
    retained = await Job(first_jobs[0], arq_queue).result_info()
    reused = await arq_queue.enqueue_job(CHECKPOINT_REALTIME_DOCUMENT.name, _job_id=first_jobs[0])
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    second = await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    second_jobs = await queued(arq_queue)
    _, second_claim = await queued_claim(arq_queue, second_jobs[0])
    await drain_queue(arq_queue, env)

    assert first_jobs == [checkpoint_job_id(head.scope, first_claim, env.namespace)]
    assert retained is not None and retained.result == CheckpointStatus.COMMITTED.value
    assert reused is None
    assert second.enqueued == 1
    assert second_jobs == [checkpoint_job_id(head.scope, second_claim, env.namespace)]
    assert second_jobs != first_jobs
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


def registered_checkpoint() -> Function:
    """The checkpoint job exactly as the core fleet registers it."""
    return next(
        registration.to_arq()
        for registration in CORE_JOB_REGISTRATIONS
        if registration.ref is CHECKPOINT_REALTIME_DOCUMENT
    )


async def test_a_checkpoint_rejected_after_an_interrupted_run_keeps_no_result_for_its_id(
    env, arq_queue
) -> None:
    head = await establish(env)
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    job_id = checkpoint_job_id(head.scope, "claim", env.namespace)
    registered = registered_checkpoint()
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


# A core fleet's longest job timeout plus ARQ's ten seconds: far beyond the length of the test.
IN_PROGRESS_LIFETIME_MS = 310_000


@contextlib.asynccontextmanager
async def row_held(key: DocKey) -> AsyncIterator[int]:
    """Lock the snapshot row in a transaction of its own; yields the backend pid holding it."""
    async with open_session() as db:
        await db.execute(
            select(RealtimeYjsSnapshot.revision)
            .where(
                RealtimeYjsSnapshot.content_type == key[0],
                RealtimeYjsSnapshot.content_id == key[1],
            )
            .with_for_update()
        )
        pid = await db.scalar(text("SELECT pg_backend_pid()"))
        try:
            yield pid
        finally:
            await db.rollback()


async def blocked_behind(pid: int) -> None:
    """Wait until a statement waits for a lock the backend ``pid`` holds."""
    async with asyncio.timeout(10):
        while True:
            async with open_session() as db:
                waiting = await db.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity"
                        " WHERE :pid = ANY(pg_blocking_pids(pid))"
                    ),
                    {"pid": pid},
                )
            if waiting:
                return
            await asyncio.sleep(0.02)


async def work_until(
    pool: ArqValkey, ctx: dict[str, Any], done: Callable[[], Awaitable[bool]]
) -> None:
    """A core worker on the test queue until ``done`` holds; a stranded job may stay queued."""
    worker = Worker(
        [registered_checkpoint()],
        queue_name=pool.default_queue_name,
        valkey_pool=pool,
        handle_signals=False,
        poll_delay=0.01,
        ctx=ctx,
    )
    polling = asyncio.create_task(worker.main())
    try:
        async with asyncio.timeout(10):
            while not await done():
                await asyncio.sleep(0.05)
    finally:
        polling.cancel()
        await asyncio.wait([polling, *worker.tasks.values()])


async def test_a_checkpoint_killed_between_capture_and_commit_runs_again_once_its_claim_lapses(
    env, arq_queue
) -> None:
    head = await establish(env)
    keys = buffer_keys(head.scope, env.namespace)
    enqueue = queue_enqueuer(arq_queue)
    ctx: dict[str, Any] = {UPDATE_BUFFER_CTX_KEY: env.buffer}
    await admit(env, head, "u-1", edit(env.base, " Alice"))
    await admit(env, head, "u-2", edit(env.base, " Bob"))
    await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    (killed,) = await queued(arq_queue)
    member, claim = await queued_claim(arq_queue, killed)

    # The worker that took the job marked it in progress and counted its try, then died with the
    # capture done and the commit waiting on the row.
    await arq_queue.psetex(in_progress_key_prefix + killed, IN_PROGRESS_LIFETIME_MS, b"1")
    await arq_queue.incr(retry_key_prefix + killed)
    async with row_held(env.key) as holder:
        running = asyncio.create_task(checkpoint_realtime_document(ctx, member, claim))
        await blocked_behind(holder)
        running.cancel()
        await asyncio.wait([running])
    killed_at = time.monotonic()
    held = await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    requeued = held
    async with asyncio.timeout(CLAIM_TTL_SECONDS + 2):
        while not requeued.enqueued:
            await asyncio.sleep(0.2)
            requeued = await dispatch_due(env.buffer, enqueue=enqueue, now_ms=FAR_FUTURE_MS)
    waited = time.monotonic() - killed_at
    (retry,) = [job_id for job_id in await queued(arq_queue) if job_id != killed]
    _, retry_claim = await queued_claim(arq_queue, retry)

    async def drained() -> bool:
        return await valkey().xlen(keys.stream) == 0

    await work_until(arq_queue, ctx, drained)

    assert running.cancelled()
    # The dead pass kept its claim until it lapsed, so nothing ran a second pass meanwhile.
    assert (held.claimed, held.enqueued) == (0, 0)
    assert waited <= CLAIM_TTL_SECONDS + 1
    assert retry_claim != claim
    assert retry == checkpoint_job_id(head.scope, retry_claim, env.namespace)
    # The killed job's in-progress key still refuses its own id; the document no longer waits on it.
    assert await queued(arq_queue) == [killed]
    assert await arq_queue.exists(in_progress_key_prefix + killed) == 1
    row = await stored_row(env.key)
    assert row.checkpoint_seq == 2
    assert text_of(row.updates) in {"base Alice Bob", "base Bob Alice"}
    assert await valkey().zscore(keys.due, head.scope.member) is None
    assert await valkey().exists(claim_key(head.scope, env.namespace)) == 0


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
    assert dispatched(jobs, env.namespace) == [healthy.scope.member]


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
