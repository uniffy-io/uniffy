"""Producer-facing audit background-job contracts."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

PROVISION_AUDIT_PARTITIONS_SCHEDULE = JobRef(
    name="cron:provision_audit_partitions",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="PostgreSQL audit partition bounds",
        trigger="core startup and daily schedule",
    ),
)

AUDIT_JOB_REFS: tuple[JobRef, ...] = ()
AUDIT_SCHEDULED_JOB_REFS = (PROVISION_AUDIT_PARTITIONS_SCHEDULE,)
