"""Producer-facing agent chat background-job contracts."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

RESPOND_TO_CHAT_MESSAGE = JobRef(
    name="respond_to_chat_message",
    queue=QueueName.EGRESS,
    workload=JobWorkload.AGENT,
    reliability=JobReliability.BEST_EFFORT,
)

CHAT_INTEGRATION_JOB_REFS = (RESPOND_TO_CHAT_MESSAGE,)
CHAT_INTEGRATION_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
