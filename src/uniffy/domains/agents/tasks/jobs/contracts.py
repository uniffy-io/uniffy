"""Producer-facing agent task assignment background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

DELIVER_TASK_ASSIGNMENT = JobRef(
    name="deliver_task_assignment",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="agents_task_assignments pending rows",
        trigger="10-second recovery schedule; running interruptions require inspection",
    ),
)
RECOVER_TASK_ASSIGNMENTS_SCHEDULE = JobRef(
    name="cron:recover_task_assignments",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="agents_task_assignments pending and expired running rows",
        trigger="10-second recovery schedule",
    ),
)

TASK_ASSIGNMENT_JOB_REFS = (DELIVER_TASK_ASSIGNMENT,)
TASK_ASSIGNMENT_SCHEDULED_JOB_REFS = (RECOVER_TASK_ASSIGNMENTS_SCHEDULE,)
