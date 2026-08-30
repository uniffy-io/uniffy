"""Producer-facing chat background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

REFRESH_CHAT_SEARCH_ACL = JobRef(
    name="refresh_chat_search_acl",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="chat_search_acl_refreshes row",
        trigger="15-second recovery schedule",
    ),
)
POST_SEND_CHAT_MESSAGE = JobRef(
    name="post_send_chat_message",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.BEST_EFFORT,
)
AUTO_UNMUTE_CHANNELS_SCHEDULE = JobRef(
    name="cron:auto_unmute_channels",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="expired muted_until on chat_channel_members rows",
        trigger="every-minute core schedule",
    ),
)
FLUSH_CHAT_SEARCH_ACL_REFRESHES_SCHEDULE = JobRef(
    name="cron:flush_chat_search_acl_refreshes",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="chat_search_acl_refreshes rows",
        trigger="15-second core schedule",
    ),
)
FLUSH_CHAT_READ_CURSORS_SCHEDULE = JobRef(
    name="cron:flush_chat_read_cursors",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

CHAT_JOB_REFS = (POST_SEND_CHAT_MESSAGE, REFRESH_CHAT_SEARCH_ACL)
CHAT_SCHEDULED_JOB_REFS = (
    AUTO_UNMUTE_CHANNELS_SCHEDULE,
    FLUSH_CHAT_READ_CURSORS_SCHEDULE,
    FLUSH_CHAT_SEARCH_ACL_REFRESHES_SCHEDULE,
)
