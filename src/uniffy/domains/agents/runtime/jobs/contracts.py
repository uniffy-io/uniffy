"""Producer-facing agent runtime background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload, QueueName

RUN_AGENT_SESSION = JobRef(
    name="run_agent_session",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)
DELETE_RUN_STREAM = JobRef(
    name="delete_run_stream",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)

RUNTIME_JOB_REFS = (RUN_AGENT_SESSION, DELETE_RUN_STREAM)
RUNTIME_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
