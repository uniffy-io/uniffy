"""Producer-facing permission background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

REINDEX_ORG_CONTENT_FOR_DEFAULTS = JobRef(
    name="reindex_org_content_for_defaults",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

PERMISSION_JOB_REFS = (REINDEX_ORG_CONTENT_FOR_DEFAULTS,)
PERMISSION_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
