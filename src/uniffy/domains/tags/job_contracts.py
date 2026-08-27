"""Producer-facing tag background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

REINDEX_TAG_URNS = JobRef(
    name="reindex_tag_urns",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)
REINDEX_TAG_DOC = JobRef(
    name="reindex_tag_doc",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

TAG_JOB_REFS = (REINDEX_TAG_URNS, REINDEX_TAG_DOC)
TAG_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
