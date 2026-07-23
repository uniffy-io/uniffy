"""Agent memory model: audience-scoped persistent memory entries."""

from datetime import UTC, datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class MemoryScope(str, Enum):
    """Audience of a memory entry; mirrors the surface it was created on."""

    USER = "user"
    CHANNEL = "channel"
    SESSION = "session"
    ORG = "org"


class MemorySource(str, Enum):
    TOOL = "tool"
    MANUAL = "manual"


class AgentMemory(SQLModel, table=True):
    """A memory entry visible exactly to the audience of its scope subject."""

    __tablename__ = "agents_memories"
    __table_args__ = (
        UniqueConstraint(
            "agent_id",
            "scope",
            "user_id",
            "channel_id",
            "session_id",
            "key",
            name="uq_agents_memories_scope_key",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(
            "(scope = 'user' AND user_id IS NOT NULL"
            " AND channel_id IS NULL AND session_id IS NULL)"
            " OR (scope = 'channel' AND channel_id IS NOT NULL"
            " AND user_id IS NULL AND session_id IS NULL)"
            " OR (scope = 'session' AND session_id IS NOT NULL"
            " AND user_id IS NULL AND channel_id IS NULL)"
            " OR (scope = 'org' AND user_id IS NULL"
            " AND channel_id IS NULL AND session_id IS NULL)",
            name="agents_memories_scope_consistent",
        ),
        CheckConstraint(
            "source IN ('tool', 'manual')",
            name="agents_memories_source_valid",
        ),
        Index(
            "ix_agents_memories_personal",
            "agent_id",
            "user_id",
            postgresql_where="user_id IS NOT NULL",
        ),
        Index(
            "ix_agents_memories_channel",
            "agent_id",
            "channel_id",
            postgresql_where="channel_id IS NOT NULL",
        ),
        Index(
            "ix_agents_memories_session",
            "agent_id",
            "session_id",
            postgresql_where="session_id IS NOT NULL",
        ),
        Index(
            "ix_agents_memories_org",
            "agent_id",
            postgresql_where="scope = 'org'",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    agent_id: UUID = Field(nullable=False)
    scope: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    user_id: UUID | None = Field(default=None, nullable=True)
    channel_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    session_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("agents_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    organization_id: UUID = Field(nullable=False)
    created_by_user_id: UUID = Field(nullable=False)
    source: str = Field(
        sa_column=Column(String(10), nullable=False, default=MemorySource.TOOL.value),
    )
    key: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    description: str = Field(
        sa_column=Column(String(255), nullable=False),
    )
    content: str = Field(
        sa_column=Column(Text, nullable=False),
    )
    category: str = Field(
        sa_column=Column(String(50), nullable=False, default="facts"),
    )
    importance: float = Field(
        sa_column=Column(Float, nullable=False, default=0.5),
    )
    pinned: bool = Field(
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    access_count: int = Field(default=0, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return f"<AgentMemory(id={self.id}, scope={self.scope!r}, key={self.key!r})>"
