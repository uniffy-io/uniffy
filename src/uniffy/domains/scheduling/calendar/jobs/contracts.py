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

REFRESH_CALENDAR_SEARCH_ACL = JobRef(
    name="refresh_calendar_search_acl",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="calendar_search_acl_refresh_queue row",
        trigger="35-second recovery schedule",
    ),
)

FLUSH_CALENDAR_SEARCH_ACL_REFRESHES_SCHEDULE = JobRef(
    name="cron:flush_calendar_search_acl_refreshes",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="calendar_search_acl_refresh_queue rows",
        trigger="35-second core schedule",
    ),
)

CALENDAR_JOB_REFS = (SEND_EVENT_MAIL, REFRESH_CALENDAR_SEARCH_ACL)
CALENDAR_SCHEDULED_JOB_REFS = (
    CHECK_CALENDAR_REMINDERS_SCHEDULE,
    DISPATCH_EVENT_MAIL_SCHEDULE,
    FLUSH_CALENDAR_SEARCH_ACL_REFRESHES_SCHEDULE,
)
