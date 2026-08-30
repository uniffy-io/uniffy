"""Lightweight job metadata shared by producers and worker composition."""

from dataclasses import dataclass
from enum import StrEnum


class QueueName(StrEnum):
    CORE = "core"
    EGRESS = "egress"

    @property
    def valkey_name(self) -> str:
        return f"uniffy:queue:{self.value}"


class JobWorkload(StrEnum):
    CONTROL = "control"
    DELIVERY = "delivery"
    MEDIA = "media"
    AGENT = "agent"
    INTEGRATION = "integration"


class JobReliability(StrEnum):
    DURABLE = "durable"
    BEST_EFFORT = "best_effort"


class JobEnqueueOutcome(StrEnum):
    ENQUEUED = "enqueued"
    DEDUPLICATED = "deduplicated"
    UNAVAILABLE = "unavailable"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class JobRecovery:
    fact: str
    trigger: str

    def __post_init__(self) -> None:
        if not self.fact.strip():
            raise ValueError("A durable job recovery fact must be non-empty")
        if not self.trigger.strip():
            raise ValueError("A durable job recovery trigger must be non-empty")


@dataclass(frozen=True, slots=True)
class JobRef:
    name: str
    queue: QueueName
    workload: JobWorkload
    reliability: JobReliability
    recovery: JobRecovery | None = None

    def __post_init__(self) -> None:
        if not self.name or self.name != self.name.strip():
            raise ValueError("Job names must be non-empty and contain no surrounding whitespace")
        if not isinstance(self.queue, QueueName):
            raise TypeError("Job queue must be a QueueName")
        if not isinstance(self.workload, JobWorkload):
            raise TypeError("Job workload must be a JobWorkload")
        if not isinstance(self.reliability, JobReliability):
            raise TypeError("Job reliability must be a JobReliability")
        if self.reliability is JobReliability.DURABLE and self.recovery is None:
            raise ValueError("Durable jobs must declare their recovery fact and trigger")
        if self.recovery is not None and not isinstance(self.recovery, JobRecovery):
            raise TypeError("Job recovery metadata must be a JobRecovery")
