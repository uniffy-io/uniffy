"""Memory scope reference shared by operations, runtime, and tools."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import ColumnElement

from uniffy.core.models.agents.memory import AgentMemory, MemoryScope


@dataclass(frozen=True, slots=True)
class MemoryScopeRef:
    """One scope subject: the audience a memory entry belongs to."""

    scope: MemoryScope
    subject_id: UUID | None = None

    @property
    def cache_subject(self) -> str:
        return str(self.subject_id) if self.subject_id else "org"


AUDIENCE_TEXT: dict[MemoryScope, str] = {
    MemoryScope.USER: "private to this user",
    MemoryScope.CHANNEL: "visible to all channel members",
    MemoryScope.SESSION: "visible to all session participants",
    MemoryScope.ORG: "visible to the whole organization",
}


def scope_subject_columns(ref: MemoryScopeRef) -> dict[str, UUID | None]:
    """Column values encoding the scope subject; exactly one non-null except org."""
    return {
        "user_id": ref.subject_id if ref.scope is MemoryScope.USER else None,
        "channel_id": ref.subject_id if ref.scope is MemoryScope.CHANNEL else None,
        "session_id": ref.subject_id if ref.scope is MemoryScope.SESSION else None,
    }


def scope_filters(
    agent_id: UUID,
    organization_id: UUID,
    ref: MemoryScopeRef,
) -> list[ColumnElement[bool]]:
    """WHERE conditions selecting exactly this scope subject's rows."""
    cols = scope_subject_columns(ref)
    filters: list[ColumnElement[bool]] = [
        AgentMemory.agent_id == agent_id,
        AgentMemory.organization_id == organization_id,
        AgentMemory.scope == ref.scope.value,
    ]
    for column, value in (
        (AgentMemory.user_id, cols["user_id"]),
        (AgentMemory.channel_id, cols["channel_id"]),
        (AgentMemory.session_id, cols["session_id"]),
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
    return MemoryScopeRef(scope=scope, subject_id=subject)
