"""Producer-facing notification background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

DELIVER_PUSH_NOTIFICATION = JobRef(
    name="deliver_push_notification",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.BEST_EFFORT,
)
SEND_NOTIFICATION_EMAIL = JobRef(
    name="send_notification_email",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="pending notification_email_deliveries row",
        trigger="10-second email dispatcher schedule",
    ),
)
SEND_NOTIFICATION_DIGEST = JobRef(
    name="send_notification_digest",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="due notification_email_deliveries rows",
        trigger="10-second email dispatcher schedule",
    ),
)
DISPATCH_NOTIFICATION_EMAILS = JobRef(
    name="dispatch_notification_emails",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="due notification_email_deliveries rows",
        trigger="direct enqueue and 10-second recovery schedule",
    ),
)
DISPATCH_NOTIFICATION_EMAILS_SCHEDULE = JobRef(
    name="cron:dispatch_notification_emails",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="due notification_email_deliveries rows",
        trigger="10-second core schedule",
    ),
)

NOTIFICATION_JOB_REFS = (
    DELIVER_PUSH_NOTIFICATION,
    SEND_NOTIFICATION_EMAIL,
    SEND_NOTIFICATION_DIGEST,
    DISPATCH_NOTIFICATION_EMAILS,
)
NOTIFICATION_SCHEDULED_JOB_REFS = (DISPATCH_NOTIFICATION_EMAILS_SCHEDULE,)
