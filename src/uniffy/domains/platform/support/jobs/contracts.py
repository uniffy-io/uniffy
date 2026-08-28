"""Producer-facing support-session background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

EXPIRE_SUPPORT_SESSIONS_SCHEDULE = JobRef(
    name="cron:expire_support_sessions",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="active expired support_sessions rows",
        trigger="every-minute core schedule",
    ),
)

SUPPORT_SESSION_JOB_REFS: tuple[JobRef, ...] = ()
SUPPORT_SESSION_SCHEDULED_JOB_REFS = (EXPIRE_SUPPORT_SESSIONS_SCHEDULE,)
