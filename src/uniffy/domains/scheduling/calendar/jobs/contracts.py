"""Producer-facing calendar background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

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

SEND_EVENT_MAIL = JobRef(
    name="send_calendar_event_mail",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="pending calendar-composed notification_email_deliveries row",
        trigger="every-minute event mail schedule",
    ),
)

DISPATCH_EVENT_MAIL_SCHEDULE = JobRef(
    name="cron:dispatch_calendar_event_mail",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="due calendar-composed notification_email_deliveries rows",
        trigger="every-minute core schedule",
    ),
)

CALENDAR_JOB_REFS = (SEND_EVENT_MAIL,)
CALENDAR_SCHEDULED_JOB_REFS = (
    CHECK_CALENDAR_REMINDERS_SCHEDULE,
    DISPATCH_EVENT_MAIL_SCHEDULE,
)
