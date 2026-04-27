"""Domain-level ChatSubject value type.

Internal representation of a channel participant, covering both USER and
AGENT. Kept separate from the protobuf `ChatSubject` message so the
operations layer doesn't take on a proto dependency. Converters in the
handler layer translate between the two.
"""

from dataclasses import dataclass
from uuid import UUID

from uniffy.core.types import SubjectType


@dataclass(frozen=True, slots=True)
class ChatSubject:
    """A channel participant identified by (type, id).

    Invariants:
      - `subject_type` is one of USER / AGENT at this boundary. GROUP and
        ORGANIZATION are valid `SubjectType` values elsewhere but have no
        meaning as chat participants today.
      - `subject_id` is a UUID; the caller has already parsed the proto
        string form.
    """

    subject_type: SubjectType
    subject_id: UUID

    @classmethod
    def user(cls, user_id: UUID) -> ChatSubject:
        """Construct a USER subject (shorthand for legacy user-only paths)."""
        return cls(SubjectType.USER, user_id)

    @classmethod
    def agent(cls, agent_id: UUID) -> ChatSubject:
        """Construct an AGENT subject."""
        return cls(SubjectType.AGENT, agent_id)

    @property
    def as_key(self) -> tuple[str, UUID]:
        """Stable tuple for sorting / dedup (matches PK column order)."""
        return (self.subject_type.value, self.subject_id)
