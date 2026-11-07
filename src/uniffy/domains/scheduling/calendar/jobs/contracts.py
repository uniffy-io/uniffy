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

REFRESH_CALENDAR_SUBSCRIPTION = JobRef(
    name="refresh_calendar_subscription",
    queue=QueueName.EGRESS,
    workload=JobWorkload.INTEGRATION,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="calendar_subscriptions.next_refresh_at past its dispatch lease",
        trigger="every-minute core schedule",
    ),
)

# Read a candidate address before anything is saved; its caller waits for the answer.
CHECK_CALENDAR_FEED = JobRef(
    name="check_calendar_feed",
    queue=QueueName.EGRESS,
    workload=JobWorkload.INTEGRATION,
    reliability=JobReliability.BEST_EFFORT,
)

DISPATCH_CALENDAR_SUBSCRIPTIONS_SCHEDULE = JobRef(
    name="cron:dispatch_calendar_subscription_refreshes",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="due calendar_subscriptions rows",
        trigger="every-minute core schedule",
    ),
)

DISCOVER_CONNECTION_CALENDARS = JobRef(
    name="discover_calendar_connection_calendars",
    queue=QueueName.EGRESS,
    workload=JobWorkload.INTEGRATION,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="calendar_connections.next_discovery_at past its dispatch lease",
        trigger="every-minute core schedule",
    ),
)

SYNC_CONNECTED_CALENDAR = JobRef(
    name="sync_connected_calendar",
    queue=QueueName.EGRESS,
    workload=JobWorkload.INTEGRATION,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="calendar_connected_calendars.next_sync_at past its dispatch lease",
        trigger="every-minute core schedule",
    ),
)

PUSH_CALENDAR_CHANGE = JobRef(
    name="push_calendar_change",
    queue=QueueName.EGRESS,
    workload=JobWorkload.INTEGRATION,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="PENDING calendar_provider_pushes row past next_attempt_at",
        trigger="every-minute core schedule",
    ),
)

DISPATCH_CALENDAR_CONNECTIONS_SCHEDULE = JobRef(
    name="cron:dispatch_calendar_connections",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact=(
            "due calendar_connections, calendar_connected_calendars "
            "and calendar_provider_pushes rows"
        ),
        trigger="every-minute core schedule",
    ),
)

CALENDAR_JOB_REFS = (
    SEND_EVENT_MAIL,
    REFRESH_CALENDAR_SEARCH_ACL,
    REFRESH_CALENDAR_SUBSCRIPTION,
    CHECK_CALENDAR_FEED,
    DISCOVER_CONNECTION_CALENDARS,
    SYNC_CONNECTED_CALENDAR,
    PUSH_CALENDAR_CHANGE,
)
CALENDAR_SCHEDULED_JOB_REFS = (
    CHECK_CALENDAR_REMINDERS_SCHEDULE,
    DISPATCH_EVENT_MAIL_SCHEDULE,
    FLUSH_CALENDAR_SEARCH_ACL_REFRESHES_SCHEDULE,
    DISPATCH_CALENDAR_SUBSCRIPTIONS_SCHEDULE,
    DISPATCH_CALENDAR_CONNECTIONS_SCHEDULE,
)
