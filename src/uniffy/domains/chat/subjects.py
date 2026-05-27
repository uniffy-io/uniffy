"""Domain-level ChatSubject value type, kept separate from the protobuf message."""

from dataclasses import dataclass
from uuid import UUID

from uniffy.core.types import SubjectType


@dataclass(frozen=True, slots=True)
class ChatSubject:
    """A channel participant; subject_type must be USER or AGENT at this boundary."""

    subject_type: SubjectType
    subject_id: UUID

    @classmethod
    def user(cls, user_id: UUID) -> ChatSubject:
        return cls(SubjectType.USER, user_id)

    @classmethod
    def agent(cls, agent_id: UUID) -> ChatSubject:
        return cls(SubjectType.AGENT, agent_id)

    @property
    def as_key(self) -> tuple[str, UUID]:
        """Stable tuple for sort/dedup (matches PK column order)."""
        return (self.subject_type.value, self.subject_id)
