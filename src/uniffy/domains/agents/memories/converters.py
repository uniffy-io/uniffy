"""Proto <-> domain converters for agent memories."""

from uniffy_proto.agents.v1.memories_pb2 import (
    MEMORY_CATEGORY_CONTEXT,
    MEMORY_CATEGORY_FACTS,
    MEMORY_CATEGORY_INSTRUCTIONS,
    MEMORY_CATEGORY_PREFERENCES,
    MEMORY_CATEGORY_UNSPECIFIED,
    MEMORY_SCOPE_CHANNEL,
    MEMORY_SCOPE_ORG,
    MEMORY_SCOPE_SESSION,
    MEMORY_SCOPE_UNSPECIFIED,
    MEMORY_SCOPE_USER,
    MEMORY_SOURCE_MANUAL,
    MEMORY_SOURCE_TOOL,
    MEMORY_SOURCE_UNSPECIFIED,
    MemoryCategory,
    MemoryInfo,
)
from uniffy_proto.agents.v1.memories_pb2 import (
    MemoryScope as MemoryScopeProto,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.memory import AgentMemory, MemoryScope, MemorySource

MEMORY_CATEGORY_TO_PROTO: dict[str, MemoryCategory] = {
    "preferences": MEMORY_CATEGORY_PREFERENCES,
    "facts": MEMORY_CATEGORY_FACTS,
    "context": MEMORY_CATEGORY_CONTEXT,
    "instructions": MEMORY_CATEGORY_INSTRUCTIONS,
}

MEMORY_CATEGORY_FROM_PROTO: dict[int, str] = {
    MEMORY_CATEGORY_PREFERENCES: "preferences",
    MEMORY_CATEGORY_FACTS: "facts",
    MEMORY_CATEGORY_CONTEXT: "context",
    MEMORY_CATEGORY_INSTRUCTIONS: "instructions",
}

MEMORY_SCOPE_TO_PROTO: dict[str, MemoryScopeProto] = {
    MemoryScope.USER.value: MEMORY_SCOPE_USER,
    MemoryScope.CHANNEL.value: MEMORY_SCOPE_CHANNEL,
    MemoryScope.SESSION.value: MEMORY_SCOPE_SESSION,
    MemoryScope.ORG.value: MEMORY_SCOPE_ORG,
}

MEMORY_SCOPE_FROM_PROTO: dict[int, MemoryScope] = {
    MEMORY_SCOPE_USER: MemoryScope.USER,
    MEMORY_SCOPE_CHANNEL: MemoryScope.CHANNEL,
    MEMORY_SCOPE_SESSION: MemoryScope.SESSION,
    MEMORY_SCOPE_ORG: MemoryScope.ORG,
}

_SOURCE_TO_PROTO = {
    MemorySource.TOOL.value: MEMORY_SOURCE_TOOL,
    MemorySource.MANUAL.value: MEMORY_SOURCE_MANUAL,
}


def memory_category_to_proto(category: str) -> MemoryCategory:
    return MEMORY_CATEGORY_TO_PROTO.get(category, MEMORY_CATEGORY_UNSPECIFIED)


def memory_category_from_proto(proto_category: MemoryCategory) -> str | None:
    return MEMORY_CATEGORY_FROM_PROTO.get(proto_category)


def memory_scope_from_proto(proto_scope: int) -> MemoryScope:
    """Unspecified defaults to USER: the caller's own entries."""
    if proto_scope == MEMORY_SCOPE_UNSPECIFIED:
        return MemoryScope.USER
    scope = MEMORY_SCOPE_FROM_PROTO.get(proto_scope)
    if scope is None:
        from uniffy.core.errors import ValidationError

        raise ValidationError("scope", "Unknown memory scope")
    return scope


def memory_to_proto(
    memory: AgentMemory,
    *,
    created_by_name: str = "",
    created_by_agent_name: str = "",
) -> MemoryInfo:
    info = MemoryInfo(
        id=str(memory.id),
        key=memory.key,
        content=memory.content,
        category=memory_category_to_proto(memory.category),
        importance=memory.importance,
        access_count=memory.access_count,
        created_at=datetime_to_timestamp(memory.created_at),
        updated_at=datetime_to_timestamp(memory.updated_at),
        scope=MEMORY_SCOPE_TO_PROTO.get(memory.scope, MEMORY_SCOPE_UNSPECIFIED),
        description=memory.description,
        pinned=memory.pinned,
        source=_SOURCE_TO_PROTO.get(memory.source, MEMORY_SOURCE_UNSPECIFIED),
        created_by_user_id=str(memory.created_by_user_id),
        created_by_name=created_by_name,
        created_by_agent_name=created_by_agent_name,
    )
    if memory.agent_id is not None:
        info.agent_id = str(memory.agent_id)
    if memory.channel_id is not None:
        info.channel_id = str(memory.channel_id)
    if memory.session_id is not None:
        info.session_id = str(memory.session_id)
    if memory.created_by_agent_id is not None:
        info.created_by_agent_id = str(memory.created_by_agent_id)
    return info
