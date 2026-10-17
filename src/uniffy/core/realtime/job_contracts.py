"""Producer-facing realtime background-job contracts."""

from uniffy.core.jobs import (
    JobRecovery,
    JobRef,
    JobReliability,
    JobWorkload,
    QueueName,
    RecoveryStore,
)

_PROJECTION_RECOVERY = JobRecovery(
    fact="realtime_yjs_snapshots revision > rendered_revision or effects_pending",
    trigger="minute projection recovery schedule",
)

# Accepted edits live only in Valkey until a checkpoint commits them, so their scheduling recovers
# from Valkey facts and is lost together with the buffer.
_BUFFER_RECOVERY = JobRecovery(
    fact="realtime buffer due index and pending update streams",
    trigger="second checkpoint dispatcher and minute buffer maintenance scan",
    store=RecoveryStore.VALKEY,
)

PROJECT_REALTIME_DOCUMENT = JobRef(
    name="project_realtime_document",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=_PROJECTION_RECOVERY,
)

CHECKPOINT_REALTIME_DOCUMENT = JobRef(
    name="checkpoint_realtime_document",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BUFFERED,
    recovery=_BUFFER_RECOVERY,
)

RECOVER_REALTIME_PROJECTIONS_SCHEDULE = JobRef(
    name="cron:recover_realtime_projections",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=_PROJECTION_RECOVERY,
)

DISPATCH_REALTIME_CHECKPOINTS_SCHEDULE = JobRef(
    name="cron:dispatch_realtime_checkpoints",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BUFFERED,
    recovery=_BUFFER_RECOVERY,
)

MAINTAIN_REALTIME_BUFFER_SCHEDULE = JobRef(
    name="cron:maintain_realtime_buffer",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BUFFERED,
    recovery=_BUFFER_RECOVERY,
)

REALTIME_JOB_REFS = (PROJECT_REALTIME_DOCUMENT, CHECKPOINT_REALTIME_DOCUMENT)
REALTIME_SCHEDULED_JOB_REFS = (
    RECOVER_REALTIME_PROJECTIONS_SCHEDULE,
    DISPATCH_REALTIME_CHECKPOINTS_SCHEDULE,
    MAINTAIN_REALTIME_BUFFER_SCHEDULE,
)
