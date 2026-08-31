"""Producer-facing directory synchronization background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload, QueueName

SYNC_IDENTITY_SOURCE = JobRef(
    name="sync_identity_source",
    queue=QueueName.EGRESS,
    workload=JobWorkload.INTEGRATION,
    reliability=JobReliability.BEST_EFFORT,
)

DIRECTORY_JOB_REFS = (SYNC_IDENTITY_SOURCE,)
DIRECTORY_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
