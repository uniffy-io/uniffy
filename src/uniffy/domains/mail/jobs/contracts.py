"""Producer-facing mail background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload, QueueName

SEND_EMAIL = JobRef(
    name="send_email",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.BEST_EFFORT,
)

MAIL_JOB_REFS = (SEND_EMAIL,)
MAIL_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
