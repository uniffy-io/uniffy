"""Dispatch typed job references without importing worker handlers."""

from dataclasses import dataclass
from typing import Any

from uniffy.core.errors import UnavailableError
from uniffy.core.jobs.metrics import WORKER_JOB_ENQUEUE_TOTAL
from uniffy.infrastructure.valkey.queue import get_queue, get_queue_safe
from uniffy.vendor.arq.jobs import Job

from .types import JobEnqueueOutcome, JobRef

_RESULT_POLL_SECONDS = 0.25


@dataclass(frozen=True, slots=True)
class JobEnqueueResult:
    job: Job | None
    outcome: JobEnqueueOutcome


async def enqueue_job(ref: JobRef, *args: Any, **kwargs: Any) -> Job | None:
    try:
        queue = get_queue(ref.queue)
    except RuntimeError:
        _record_outcome(ref, JobEnqueueOutcome.UNAVAILABLE)
        raise

    try:
        job = await queue.enqueue_job(ref.name, *args, **kwargs)
    except Exception:
        _record_outcome(ref, JobEnqueueOutcome.ERROR)
        raise

    outcome = JobEnqueueOutcome.DEDUPLICATED if job is None else JobEnqueueOutcome.ENQUEUED
    _record_outcome(ref, outcome)
    return job


async def enqueue_job_reconnecting(
    ref: JobRef,
    *args: Any,
    **kwargs: Any,
) -> JobEnqueueResult:
    try:
        queue = await get_queue_safe(ref.queue)
    except Exception:
        _record_outcome(ref, JobEnqueueOutcome.ERROR)
        raise
    if queue is None:
        outcome = JobEnqueueOutcome.UNAVAILABLE
        _record_outcome(ref, outcome)
        return JobEnqueueResult(job=None, outcome=outcome)

    try:
        job = await queue.enqueue_job(ref.name, *args, **kwargs)
    except Exception:
        _record_outcome(ref, JobEnqueueOutcome.ERROR)
        raise

    outcome = JobEnqueueOutcome.DEDUPLICATED if job is None else JobEnqueueOutcome.ENQUEUED
    _record_outcome(ref, outcome)
    return JobEnqueueResult(job=job, outcome=outcome)


async def run_job_and_wait(ref: JobRef, *args: Any, timeout: float, **kwargs: Any) -> Any:
    """Enqueue and wait for the handler's return value, for a caller whose answer depends on it.

    Raises ``UnavailableError`` when the queue is down or refuses the job, and
    ``TimeoutError`` when the worker does not answer in time.
    """
    result = await enqueue_job_reconnecting(ref, *args, **kwargs)
    if result.job is None:
        raise UnavailableError(f"{ref.name} could not be queued")
    return await result.job.result(timeout=timeout, poll_delay=_RESULT_POLL_SECONDS)


def _record_outcome(ref: JobRef, outcome: JobEnqueueOutcome) -> None:
    WORKER_JOB_ENQUEUE_TOTAL.labels(
        queue=ref.queue,
        job_name=ref.name,
        outcome=outcome,
    ).inc()
