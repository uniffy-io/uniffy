from uniffy.core.jobs import JobRecovery, JobRef, JobReliability, JobWorkload, QueueName

RUN_SKILL_EVALUATION = JobRef(
    name="run_skill_evaluation",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.DURABLE,
    recovery=JobRecovery(
        fact="agents_skill_evaluation_runs has a queued or running row with a deadline_at",
        trigger="expire_skill_evaluations settles overdue runs without automatic provider work",
    ),
)
EXPIRE_SKILL_EVALUATIONS_SCHEDULE = JobRef(
    name="cron:expire_skill_evaluations",
    queue=QueueName.CORE,
    workload=JobWorkload.CONTROL,
    reliability=JobReliability.BEST_EFFORT,
)

EVALUATION_JOB_REFS = (RUN_SKILL_EVALUATION,)
EVALUATION_SCHEDULED_JOB_REFS = (EXPIRE_SKILL_EVALUATIONS_SCHEDULE,)
