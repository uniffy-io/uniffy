"""Producer-facing background-job contracts."""

from uniffy.core.jobs.dispatch import JobEnqueueResult, enqueue_job, enqueue_job_reconnecting
from uniffy.core.jobs.types import (
    JobEnqueueOutcome,
    JobRecovery,
    JobRef,
    JobReliability,
    JobWorkload,
    QueueName,
    RecoveryStore,
)

__all__ = [
    "JobEnqueueOutcome",
    "JobEnqueueResult",
    "JobRef",
    "JobRecovery",
    "JobReliability",
    "JobWorkload",
    "QueueName",
    "RecoveryStore",
    "enqueue_job",
    "enqueue_job_reconnecting",
]
