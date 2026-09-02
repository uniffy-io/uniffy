"""Producer-facing search background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

REINDEX_RENAMED_CONTENT = JobRef(
    name="reindex_renamed_content",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

FLUSH_SEARCH_REMOVALS = JobRef(
    name="flush_search_removals",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="search_removal_queue rows",
        trigger="five-minute recovery schedule",
    ),
)
FLUSH_SEARCH_REMOVALS_SCHEDULE = JobRef(
    name="cron:flush_search_removals",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="search_removal_queue rows",
        trigger="five-minute core schedule",
    ),
)

SEARCH_JOB_REFS = (REINDEX_RENAMED_CONTENT, FLUSH_SEARCH_REMOVALS)
SEARCH_SCHEDULED_JOB_REFS = (FLUSH_SEARCH_REMOVALS_SCHEDULE,)
