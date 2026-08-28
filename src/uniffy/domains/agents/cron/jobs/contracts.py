"""Producer-facing agent cron background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

EXECUTE_SINGLE_AGENT_CRON_TASK = JobRef(
    name="execute_single_agent_cron_task",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)
EXECUTE_AGENT_CRON_TASKS_SCHEDULE = JobRef(
    name="cron:execute_agent_cron_tasks",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="due agents_cron_tasks rows",
        trigger="every-minute egress schedule",
    ),
)

CRON_JOB_REFS = (EXECUTE_SINGLE_AGENT_CRON_TASK,)
CRON_SCHEDULED_JOB_REFS = (EXECUTE_AGENT_CRON_TASKS_SCHEDULE,)
