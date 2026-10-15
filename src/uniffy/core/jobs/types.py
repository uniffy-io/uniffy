"""Lightweight job metadata shared by producers and worker composition."""

from dataclasses import dataclass
from enum import StrEnum


class QueueName(StrEnum):
    CORE = "core"
    EGRESS = "egress"
    MEDIA = "media"

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
    # Recovers from a Valkey fact, so losing that buffer loses the work with it.
    BUFFERED = "buffered"
    BEST_EFFORT = "best_effort"


class RecoveryStore(StrEnum):
    POSTGRESQL = "postgresql"
    VALKEY = "valkey"


_REQUIRED_RECOVERY_STORES = {
    JobReliability.DURABLE: RecoveryStore.POSTGRESQL,
    JobReliability.BUFFERED: RecoveryStore.VALKEY,
}


class JobEnqueueOutcome(StrEnum):
    ENQUEUED = "enqueued"
    DEDUPLICATED = "deduplicated"
    UNAVAILABLE = "unavailable"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class JobRecovery:
    fact: str
    trigger: str
    store: RecoveryStore = RecoveryStore.POSTGRESQL

    def __post_init__(self) -> None:
        if not self.fact.strip():
            raise ValueError("A job recovery fact must be non-empty")
        if not self.trigger.strip():
            raise ValueError("A job recovery trigger must be non-empty")
        if not isinstance(self.store, RecoveryStore):
            raise TypeError("Job recovery store must be a RecoveryStore")


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
        if self.recovery is not None and not isinstance(self.recovery, JobRecovery):
            raise TypeError("Job recovery metadata must be a JobRecovery")
        store = _REQUIRED_RECOVERY_STORES.get(self.reliability)
        if store is not None and (self.recovery is None or self.recovery.store is not store):
            raise ValueError(
                f"{self.reliability.value} jobs must declare a {store.value} recovery fact "
                "and the sweep that retries it"
            )
