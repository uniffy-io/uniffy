"""Producer-facing agent session background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

COMPACT_SESSION = JobRef(
    name="compact_session",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)

SESSION_JOB_REFS = (COMPACT_SESSION,)
SESSION_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
