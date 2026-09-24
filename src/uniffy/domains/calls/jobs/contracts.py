"""Producer-facing calls background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

RECONCILE_CALLS_SCHEDULE = JobRef(
    name="cron:reconcile_calls",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="active call participants and ended or absent calls compared with LiveKit rooms",
        trigger="five-minute core schedule",
    ),
)
CLEANUP_ORPHAN_CALL_ROOMS_SCHEDULE = JobRef(
    name="cron:cleanup_orphan_call_rooms",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="ended or absent calls rows compared with LiveKit rooms",
        trigger="hourly core schedule",
    ),
)

CALLS_JOB_REFS: tuple[JobRef, ...] = ()
CALLS_SCHEDULED_JOB_REFS = (
    RECONCILE_CALLS_SCHEDULE,
    CLEANUP_ORPHAN_CALL_ROOMS_SCHEDULE,
)
