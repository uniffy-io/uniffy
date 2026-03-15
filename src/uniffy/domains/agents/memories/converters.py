"""Proto <-> domain converters for agent memories."""

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.gen.agents.v1.memories_pb2 import (
    MEMORY_CATEGORY_CONTEXT,
    MEMORY_CATEGORY_FACTS,
    MEMORY_CATEGORY_INSTRUCTIONS,
    MEMORY_CATEGORY_PREFERENCES,
    MEMORY_CATEGORY_UNSPECIFIED,
    MemoryCategory,
    MemoryInfo,
)

# --- Memory Category mappings ---

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


def memory_category_to_proto(category: str) -> MemoryCategory:
    """Convert domain memory category string to proto enum.

    Parameters
    ----------
    category : str
        Domain memory category (e.g. "preferences", "facts").

    Returns
    -------
    MemoryCategory
        Proto enum value.

    """
    return MEMORY_CATEGORY_TO_PROTO.get(category, MEMORY_CATEGORY_UNSPECIFIED)


def memory_category_from_proto(proto_category: MemoryCategory) -> str | None:
    """Convert proto memory category enum to domain string.

    Parameters
    ----------
    proto_category : MemoryCategory
        Proto enum value.

    Returns
    -------
    str | None
        Domain memory category string, or None if unspecified.

    """
    return MEMORY_CATEGORY_FROM_PROTO.get(proto_category)


def memory_to_proto(memory: AgentMemory) -> MemoryInfo:
    """Convert an AgentMemory model to proto MemoryInfo.

    Parameters
    ----------
    memory : AgentMemory
        Database model instance.

    Returns
    -------
    MemoryInfo
        Proto message.

    """
    return MemoryInfo(
        id=str(memory.id),
        agent_id=str(memory.agent_id),
        key=memory.key,
        content=memory.content,
        category=memory_category_to_proto(memory.category),
        importance=memory.importance,
        access_count=memory.access_count,
        created_at=datetime_to_timestamp(memory.created_at),
        updated_at=datetime_to_timestamp(memory.updated_at),
    )
