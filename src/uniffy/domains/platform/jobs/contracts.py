"""Producer-facing platform background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

NOTIFY_PENDING_ORG_PURGES_SCHEDULE = JobRef(
    name="cron:notify_pending_org_purges",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.BEST_EFFORT,
)

PLATFORM_JOB_REFS: tuple[JobRef, ...] = ()
PLATFORM_SCHEDULED_JOB_REFS = (NOTIFY_PENDING_ORG_PURGES_SCHEDULE,)
