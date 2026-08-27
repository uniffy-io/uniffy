"""Producer-facing background-job contracts."""

from uniffy.core.jobs.dispatch import JobEnqueueResult, enqueue_job, enqueue_job_reconnecting
from uniffy.core.jobs.types import (
    JobEnqueueOutcome,
    JobRecovery,
    JobRef,
    JobReliability,
    JobWorkload,
)

__all__ = [
    "JobEnqueueOutcome",
    "JobEnqueueResult",
    "JobRef",
    "JobRecovery",
    "JobReliability",
    "JobWorkload",
    "enqueue_job",
    "enqueue_job_reconnecting",
]
