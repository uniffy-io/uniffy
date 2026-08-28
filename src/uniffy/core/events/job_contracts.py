"""Background-job contracts owned by the core event subsystem."""

from uniffy.core.jobs import JobRef, JobReliability, JobWorkload
from uniffy.core.valkey.queue import QueueName

PROCESS_NOTIFICATION_EVENT = JobRef(
    name="process_notification_event",
    queue=QueueName.CORE,
    workload=JobWorkload.DELIVERY,
    reliability=JobReliability.BEST_EFFORT,
)

EVENT_JOB_REFS = (PROCESS_NOTIFICATION_EVENT,)
EVENT_SCHEDULED_JOB_REFS: tuple[JobRef, ...] = ()
