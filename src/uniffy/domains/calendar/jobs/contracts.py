"""Producer-facing calendar background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

CHECK_CALENDAR_REMINDERS_SCHEDULE = JobRef(
    name="cron:check_calendar_reminders",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="unsent due calendar_event_reminders rows",
        trigger="every-minute core schedule",
    ),
)

CALENDAR_JOB_REFS: tuple[JobRef, ...] = ()
CALENDAR_SCHEDULED_JOB_REFS = (CHECK_CALENDAR_REMINDERS_SCHEDULE,)
