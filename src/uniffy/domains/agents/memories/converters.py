"""Proto <-> domain converters for agent memories."""

from uniffy_proto.agents.v1.memories_pb import MemoryCategory, MemoryInfo
from uniffy_proto.agents.v1.memories_pb import MemoryCategory as _ProtoMemoryCategory
from uniffy_proto.agents.v1.memories_pb import (
    MemoryScope as MemoryScopeProto,
)
from uniffy_proto.agents.v1.memories_pb import MemoryScope as _ProtoMemoryScope
from uniffy_proto.agents.v1.memories_pb import MemorySource as _ProtoMemorySource

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.memory import AgentMemory, MemoryScope, MemorySource

MEMORY_CATEGORY_TO_PROTO: dict[str, MemoryCategory] = {
    "preferences": _ProtoMemoryCategory.PREFERENCES,
    "facts": _ProtoMemoryCategory.FACTS,
    "context": _ProtoMemoryCategory.CONTEXT,
    "instructions": _ProtoMemoryCategory.INSTRUCTIONS,
}

MEMORY_CATEGORY_FROM_PROTO: dict[int, str] = {
    _ProtoMemoryCategory.PREFERENCES: "preferences",
    _ProtoMemoryCategory.FACTS: "facts",
    _ProtoMemoryCategory.CONTEXT: "context",
    _ProtoMemoryCategory.INSTRUCTIONS: "instructions",
}

MEMORY_SCOPE_TO_PROTO: dict[str, MemoryScopeProto] = {
    MemoryScope.USER.value: _ProtoMemoryScope.USER,
    MemoryScope.CHANNEL.value: _ProtoMemoryScope.CHANNEL,
    MemoryScope.SESSION.value: _ProtoMemoryScope.SESSION,
    MemoryScope.ORG.value: _ProtoMemoryScope.ORG,
}

MEMORY_SCOPE_FROM_PROTO: dict[int, MemoryScope] = {
    _ProtoMemoryScope.USER: MemoryScope.USER,
    _ProtoMemoryScope.CHANNEL: MemoryScope.CHANNEL,
    _ProtoMemoryScope.SESSION: MemoryScope.SESSION,
    _ProtoMemoryScope.ORG: MemoryScope.ORG,
}

_SOURCE_TO_PROTO = {
    MemorySource.TOOL.value: _ProtoMemorySource.TOOL,
    MemorySource.MANUAL.value: _ProtoMemorySource.MANUAL,
}


def memory_category_to_proto(category: str) -> MemoryCategory:
    return MEMORY_CATEGORY_TO_PROTO.get(category, _ProtoMemoryCategory.UNSPECIFIED)


def memory_category_from_proto(proto_category: MemoryCategory) -> str | None:
    return MEMORY_CATEGORY_FROM_PROTO.get(proto_category)


def memory_scope_from_proto(proto_scope: int) -> MemoryScope:
    """Unspecified defaults to USER: the caller's own entries."""
    if proto_scope == _ProtoMemoryScope.UNSPECIFIED:
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
        scope=MEMORY_SCOPE_TO_PROTO.get(memory.scope, _ProtoMemoryScope.UNSPECIFIED),
        description=memory.description,
        pinned=memory.pinned,
        source=_SOURCE_TO_PROTO.get(memory.source, _ProtoMemorySource.UNSPECIFIED),
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
