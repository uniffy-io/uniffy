"""Producer-facing agent chat background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

RESPOND_TO_CHAT_MESSAGE = JobRef(
    name="respond_to_chat_message",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)


DELIVER_CHAT_TRIGGER = JobRef(
    name="deliver_chat_trigger",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="agents_chat_triggers pending admission rows",
        trigger="10-second recovery schedule; running interruptions require inspection",
    ),
)
RECOVER_CHAT_TRIGGERS_SCHEDULE = JobRef(
    name="cron:recover_chat_triggers",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="agents_chat_triggers pending and expired running rows",
        trigger="10-second recovery schedule",
    ),
)

CHAT_INTEGRATION_JOB_REFS = (RESPOND_TO_CHAT_MESSAGE, DELIVER_CHAT_TRIGGER)
CHAT_INTEGRATION_SCHEDULED_JOB_REFS = (RECOVER_CHAT_TRIGGERS_SCHEDULE,)
