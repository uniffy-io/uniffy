"""Checkpoint dispatch, its claims and job identities, and on-demand checkpoints on live services."""

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any

import pytest
import pytest_asyncio

from uniffy.core.jobs import JobEnqueueOutcome, JobRef
from uniffy.core.realtime.buffer_keys import DUE_DELAY_MS, buffer_keys
from uniffy.core.realtime.checkpoint import (
    CheckpointReport,
    CheckpointStatus,
    UnreadableStream,
    checkpoint_all_pending,
)
from uniffy.core.realtime.dispatch import (
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
from uniffy.core.realtime.maintenance import MaintenanceAction
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
from uniffy.vendor.arq.constants import retry_key_prefix
from uniffy.vendor.arq.jobs import Job
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
    assert [job_id for _, job_id, _ in jobs.jobs] == [
        checkpoint_job_id(oversized.scope, window, env.namespace)
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
