"""Producer-facing collaborator background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload, QueueName

# Scores only tune picker order, so a missed night is an acceptable loss.
DERIVE_COLLABORATOR_ACTIVITY_SCHEDULE = JobRef(
    name="cron:derive_collaborator_activity",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

COLLABORATOR_SCHEDULED_JOB_REFS = (DERIVE_COLLABORATOR_ACTIVITY_SCHEDULE,)
COLLABORATOR_JOB_REFS: tuple[JobRef, ...] = ()
