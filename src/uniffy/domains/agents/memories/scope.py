"""Memory bucket reference shared by operations, runtime, and tools."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import ColumnElement

from uniffy.core.models.agents.memory import AgentMemory, MemoryScope


@dataclass(frozen=True, slots=True)
class MemoryScopeRef:
    """One bucket: an audience (scope + subject) and its agent binding.

    ``agent_id`` is None for everything an audience shares across its agents;
    only organization entries may bind to a single agent, which the table
    enforces with a CHECK.
    """

    scope: MemoryScope
    subject_id: UUID | None = None
    agent_id: UUID | None = None

    def __post_init__(self) -> None:
        if self.agent_id is not None and self.scope is not MemoryScope.ORG:
            raise ValueError("Only organization memory can bind to a single agent")

    @classmethod
    def user(cls, user_id: UUID) -> MemoryScopeRef:
        return cls(MemoryScope.USER, user_id)

    @classmethod
    def channel(cls, channel_id: UUID) -> MemoryScopeRef:
        return cls(MemoryScope.CHANNEL, channel_id)

    @classmethod
    def session(cls, session_id: UUID) -> MemoryScopeRef:
        return cls(MemoryScope.SESSION, session_id)

    @classmethod
    def org(cls, agent_id: UUID | None = None) -> MemoryScopeRef:
        return cls(MemoryScope.ORG, None, agent_id)

    @property
    def cache_subject(self) -> str:
        return str(self.subject_id) if self.subject_id else "org"

    @property
    def cache_agent(self) -> str:
        return str(self.agent_id) if self.agent_id else "all"


AUDIENCE_TEXT: dict[MemoryScope, str] = {
    MemoryScope.USER: "private to this user, shared by every agent they talk to",
    MemoryScope.CHANNEL: "visible to all channel members and to every agent here",
    MemoryScope.SESSION: "visible to all session participants",
    MemoryScope.ORG: "visible to the whole organization",
}


def audience_text(ref: MemoryScopeRef) -> str:
    if ref.scope is MemoryScope.ORG and ref.agent_id is not None:
        return "visible to the whole organization and used only by this agent"
    return AUDIENCE_TEXT[ref.scope]


def scope_subject_columns(ref: MemoryScopeRef) -> dict[str, UUID | None]:
    """Column values encoding the bucket; exactly one subject except org."""
    return {
        "user_id": ref.subject_id if ref.scope is MemoryScope.USER else None,
        "channel_id": ref.subject_id if ref.scope is MemoryScope.CHANNEL else None,
        "session_id": ref.subject_id if ref.scope is MemoryScope.SESSION else None,
        "agent_id": ref.agent_id,
    }


def scope_filters(
    organization_id: UUID,
    ref: MemoryScopeRef,
) -> list[ColumnElement[bool]]:
    """WHERE conditions selecting exactly this bucket's rows."""
    cols = scope_subject_columns(ref)
    filters: list[ColumnElement[bool]] = [
        AgentMemory.organization_id == organization_id,
        AgentMemory.scope == ref.scope.value,
    ]
    for column, value in (
        (AgentMemory.user_id, cols["user_id"]),
        (AgentMemory.channel_id, cols["channel_id"]),
        (AgentMemory.session_id, cols["session_id"]),
        (AgentMemory.agent_id, cols["agent_id"]),
    ):
        filters.append(column.is_(None) if value is None else column == value)  # type: ignore[union-attr]
    return filters


def scope_ref_for_memory(memory: AgentMemory) -> MemoryScopeRef:
    scope = MemoryScope(memory.scope)
    subject = {
        MemoryScope.USER: memory.user_id,
        MemoryScope.CHANNEL: memory.channel_id,
        MemoryScope.SESSION: memory.session_id,
        MemoryScope.ORG: None,
    }[scope]
    return MemoryScopeRef(scope=scope, subject_id=subject, agent_id=memory.agent_id)
