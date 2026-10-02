"""Producer-facing realtime background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

SAVE_REALTIME_SNAPSHOT = JobRef(
    name="save_realtime_snapshot",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="realtime_yjs_snapshots revision > rendered_revision",
        trigger="minute projection recovery schedule",
    ),
)

RECOVER_REALTIME_PROJECTIONS_SCHEDULE = JobRef(
    name="cron:recover_realtime_projections",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="realtime_yjs_snapshots revision > rendered_revision",
        trigger="minute projection recovery schedule",
    ),
)

REALTIME_JOB_REFS = (SAVE_REALTIME_SNAPSHOT,)
REALTIME_SCHEDULED_JOB_REFS = (RECOVER_REALTIME_PROJECTIONS_SCHEDULE,)
