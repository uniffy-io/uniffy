"""Producer-facing project background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

REFRESH_PROJECT_SEARCH_ACL = JobRef(
    name="refresh_project_search_acl",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="project_search_acl_refreshes row",
        trigger="25-second recovery schedule",
    ),
)
CHECK_TASK_DUE_DATES_SCHEDULE = JobRef(
    name="cron:check_task_due_dates",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="incomplete projects_tasks rows with due dates",
        trigger="every-minute core schedule",
    ),
)
FLUSH_PROJECT_SEARCH_ACL_REFRESHES_SCHEDULE = JobRef(
    name="cron:flush_project_search_acl_refreshes",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="project_search_acl_refreshes rows",
        trigger="25-second core schedule",
    ),
)

PROJECT_JOB_REFS = (REFRESH_PROJECT_SEARCH_ACL,)
PROJECT_SCHEDULED_JOB_REFS = (
    CHECK_TASK_DUE_DATES_SCHEDULE,
    FLUSH_PROJECT_SEARCH_ACL_REFRESHES_SCHEDULE,
)
