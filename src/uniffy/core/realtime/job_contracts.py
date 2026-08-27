"""Producer-facing realtime background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

SAVE_REALTIME_SNAPSHOT = JobRef(
    name="save_realtime_snapshot",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

REALTIME_JOB_REFS = (SAVE_REALTIME_SNAPSHOT,)
REALTIME_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
