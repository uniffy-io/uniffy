"""Agent-channel binding model for per-channel agent configuration."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentChannelBinding(SQLModel, table=True):
    """Per-(channel, agent) configuration and usage counters."""

    __tablename__ = "agents_channel_bindings"
    __table_args__ = (
        UniqueConstraint("channel_id", "agent_id", name="agents_channel_bindings_unique"),
        CheckConstraint(
            "context_radius BETWEEN 0 AND 50",
            name="agents_channel_bindings_context_radius_sane",
        ),
        CheckConstraint(
            "rate_limit_per_minute BETWEEN 1 AND 1000",
            name="agents_channel_bindings_rate_sane",
        ),
        Index("ix_agents_channel_bindings_agent", "agent_id"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    channel_id: UUID = Field(
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    agent_id: UUID = Field(
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )

    model_override: str | None = Field(
        default=None,
        sa_column=Column(Text(), nullable=True),
    )
    tool_allowlist: list[str] | None = Field(
        default=None,
        sa_column=Column(PG_JSONB, nullable=True),
    )
    system_prompt_addendum: str | None = Field(
        default=None,
        sa_column=Column(Text(), nullable=True),
    )
    respond_on_reply: bool = Field(
        default=True,
        sa_column=Column(Boolean(), nullable=False, server_default=text("true")),
    )
    respond_in_thread: bool = Field(
        default=True,
        sa_column=Column(Boolean(), nullable=False, server_default=text("true")),
    )
    context_radius: int = Field(
        default=8,
        sa_column=Column(Integer(), nullable=False, server_default=text("8")),
    )
    rate_limit_per_minute: int = Field(
        default=10,
        sa_column=Column(Integer(), nullable=False, server_default=text("10")),
    )

    token_budget_month: int | None = Field(
        default=None,
        sa_column=Column(Integer(), nullable=True),
    )
    tokens_used_month: int = Field(
        default=0,
        sa_column=Column(Integer(), nullable=False, server_default=text("0")),
    )
    tokens_reset_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    last_compacted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    compaction_summary_msg_ids: list[UUID] = Field(
        default_factory=list,
        sa_column=Column(
            PG_ARRAY(PG_UUID(as_uuid=True)),
            nullable=False,
            server_default=text("'{}'::uuid[]"),
        ),
    )
    last_active_token_estimate: int = Field(
        default=0,
        sa_column=Column(Integer(), nullable=False, server_default=text("0")),
    )
    last_output_token_estimate: int = Field(
        default=0,
        sa_column=Column(Integer(), nullable=False, server_default=text("0")),
    )
    last_cache_read_token_estimate: int = Field(
        default=0,
        sa_column=Column(Integer(), nullable=False, server_default=text("0")),
    )
    manual_reset_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    created_by_user_id: UUID = Field(
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("login_users.id"),
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
            onupdate=lambda: datetime.now(UTC),
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentChannelBinding(id={self.id}, "
            f"channel_id={self.channel_id}, agent_id={self.agent_id})>"
        )
