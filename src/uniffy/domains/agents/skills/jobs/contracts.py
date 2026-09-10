"""Explicit generation jobs and recovery of interrupted draft requests."""

from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

GENERATE_SKILL_DRAFT = JobRef(
    name="generate_skill_draft",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="agents_skill_drafts.status = generating with a generation_deadline_at",
        trigger="expire_skill_draft_generations marks overdue attempts failed for explicit retry",
    ),
)
EXPIRE_SKILL_DRAFT_GENERATIONS_SCHEDULE = JobRef(
    name="cron:expire_skill_draft_generations",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

SKILL_JOB_REFS = (GENERATE_SKILL_DRAFT,)
SKILL_SCHEDULED_JOB_REFS = (EXPIRE_SKILL_DRAFT_GENERATIONS_SCHEDULE,)
