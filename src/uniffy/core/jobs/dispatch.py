"""Dispatch typed job references without importing worker handlers."""

from dataclasses import dataclass
from typing import Any

from uniffy.core.jobs.metrics import WORKER_JOB_ENQUEUE_TOTAL
from uniffy.core.valkey.queue import get_queue, get_queue_safe
from uniffy.vendor.arq.jobs import Job

from .types import JobEnqueueOutcome, JobRef


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


def _record_outcome(ref: JobRef, outcome: JobEnqueueOutcome) -> None:
    WORKER_JOB_ENQUEUE_TOTAL.labels(
        queue=ref.queue,
        job_name=ref.name,
        outcome=outcome,
    ).inc()
