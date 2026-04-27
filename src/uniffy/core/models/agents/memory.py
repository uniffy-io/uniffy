"""Agent memory model for persistent cross-session memory."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
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


class AgentMemory(SQLModel, table=True):
    """A persistent memory entry scoped by agent + (user | channel).

    Memories can be scoped three ways:
      - (agent, user)              personal across all channels
      - (agent, channel)           channel-wide (user_id NULL)
      - (agent, user, channel)     this user in this channel only

    `organization_id` is no longer part of the uniqueness key: both
    `agent_id` and `channel_id` are individually org-scoped, so including
    org would be redundant. It stays on the row for observability and
    simple org-wide cleanup. The unique constraint uses NULLS NOT DISTINCT
    so null scope columns still participate in conflict detection.
    """

    __tablename__ = "agents_memories"
    __table_args__ = (
        UniqueConstraint(
            "agent_id",
            "user_id",
            "channel_id",
            "key",
            name="uq_agents_memories_agent_user_channel_key",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(
            "user_id IS NOT NULL OR channel_id IS NOT NULL",
            name="agents_memories_scope_present",
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
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    agent_id: UUID = Field(nullable=False)
    user_id: UUID | None = Field(default=None, nullable=True)
    channel_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    organization_id: UUID = Field(nullable=False)
    key: str = Field(
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
        """Return string representation of AgentMemory."""
        return f"<AgentMemory(id={self.id}, key={self.key!r}, category={self.category!r})>"
