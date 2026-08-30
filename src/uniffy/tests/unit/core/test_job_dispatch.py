from unittest.mock import AsyncMock, patch

import pytest

from uniffy.core.jobs import (
    JobEnqueueOutcome,
    JobRef,
    JobReliability,
    JobWorkload,
    enqueue_job,
    enqueue_job_reconnecting,
)
from uniffy.core.valkey.queue import QueueName
from uniffy.core.jobs.metrics import WORKER_JOB_ENQUEUE_TOTAL


def _outcome_value(ref: JobRef, outcome: JobEnqueueOutcome) -> float:
    return WORKER_JOB_ENQUEUE_TOTAL.labels(
        queue=ref.queue,
        job_name=ref.name,
        outcome=outcome,
    )._value.get()


async def test_enqueue_job_dispatches_through_the_referenced_queue() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.EGRESS,
        workload=JobWorkload.INTEGRATION,
        reliability=JobReliability.BEST_EFFORT,
    )
    queued_job = object()
    queue = AsyncMock()
    queue.enqueue_job.return_value = queued_job
    before = _outcome_value(ref, JobEnqueueOutcome.ENQUEUED)

    with patch("uniffy.core.jobs.dispatch.get_queue", return_value=queue) as get_queue:
        result = await enqueue_job(ref, "payload", _job_id="natural-id")

    assert result is queued_job
    assert _outcome_value(ref, JobEnqueueOutcome.ENQUEUED) == before + 1
    get_queue.assert_called_once_with(QueueName.EGRESS)
    queue.enqueue_job.assert_awaited_once_with("example_job", "payload", _job_id="natural-id")


async def test_enqueue_job_propagates_queue_unavailability() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.CORE,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BEST_EFFORT,
    )
    before = _outcome_value(ref, JobEnqueueOutcome.UNAVAILABLE)

    with (
        patch("uniffy.core.jobs.dispatch.get_queue", side_effect=RuntimeError("queue unavailable")),
        pytest.raises(RuntimeError),
    ):
        await enqueue_job(ref)

    assert _outcome_value(ref, JobEnqueueOutcome.UNAVAILABLE) == before + 1


async def test_reconnecting_dispatch_recovers_a_queue_missing_from_this_process() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.CORE,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BEST_EFFORT,
    )
    queue = AsyncMock()
    queued_job = object()
    queue.enqueue_job.return_value = queued_job
    before = _outcome_value(ref, JobEnqueueOutcome.ENQUEUED)

    with patch(
        "uniffy.core.jobs.dispatch.get_queue_safe",
        new=AsyncMock(return_value=queue),
    ) as get_queue_safe:
        result = await enqueue_job_reconnecting(ref, "payload")

    assert result.job is queued_job
    assert result.outcome is JobEnqueueOutcome.ENQUEUED
    assert _outcome_value(ref, JobEnqueueOutcome.ENQUEUED) == before + 1
    get_queue_safe.assert_awaited_once_with(QueueName.CORE)
    queue.enqueue_job.assert_awaited_once_with(ref.name, "payload")


async def test_reconnecting_dispatch_reports_persistent_queue_unavailability() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.CORE,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BEST_EFFORT,
    )
    before = _outcome_value(ref, JobEnqueueOutcome.UNAVAILABLE)

    with patch(
        "uniffy.core.jobs.dispatch.get_queue_safe",
        new=AsyncMock(return_value=None),
    ):
        result = await enqueue_job_reconnecting(ref)

    assert result.job is None
    assert result.outcome is JobEnqueueOutcome.UNAVAILABLE
    assert _outcome_value(ref, JobEnqueueOutcome.UNAVAILABLE) == before + 1


async def test_reconnecting_dispatch_distinguishes_deduplication_from_unavailability() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.CORE,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BEST_EFFORT,
    )
    queue = AsyncMock()
    queue.enqueue_job.return_value = None
    before = _outcome_value(ref, JobEnqueueOutcome.DEDUPLICATED)

    with patch(
        "uniffy.core.jobs.dispatch.get_queue_safe",
        new=AsyncMock(return_value=queue),
    ):
        result = await enqueue_job_reconnecting(ref, _job_id="existing-job")

    assert result.job is None
    assert result.outcome is JobEnqueueOutcome.DEDUPLICATED
    assert _outcome_value(ref, JobEnqueueOutcome.DEDUPLICATED) == before + 1


async def test_enqueue_job_reports_natural_id_deduplication() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.CORE,
        workload=JobWorkload.CONTROL,
        reliability=JobReliability.BEST_EFFORT,
    )
    queue = AsyncMock()
    queue.enqueue_job.return_value = None
    before = _outcome_value(ref, JobEnqueueOutcome.DEDUPLICATED)

    with patch("uniffy.core.jobs.dispatch.get_queue", return_value=queue):
        result = await enqueue_job(ref, _job_id="existing-job")

    assert result is None
    assert _outcome_value(ref, JobEnqueueOutcome.DEDUPLICATED) == before + 1


async def test_enqueue_job_records_queue_errors_without_swallowing_them() -> None:
    ref = JobRef(
        name="example_job",
        queue=QueueName.EGRESS,
        workload=JobWorkload.INTEGRATION,
        reliability=JobReliability.BEST_EFFORT,
    )
    queue = AsyncMock()
    queue.enqueue_job.side_effect = TimeoutError("queue timed out")
    before = _outcome_value(ref, JobEnqueueOutcome.ERROR)

    with (
        patch("uniffy.core.jobs.dispatch.get_queue", return_value=queue),
        pytest.raises(TimeoutError, match="queue timed out"),
    ):
        await enqueue_job(ref)

    assert _outcome_value(ref, JobEnqueueOutcome.ERROR) == before + 1
