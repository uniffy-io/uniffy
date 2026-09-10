"""Agent run log model for recording each agent interaction."""

from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentRunKind(StrEnum):
    CHAT = "chat"
    IMAGE = "image"
    CRON = "cron"
    EVALUATION = "evaluation"


class AgentRunStatus(StrEnum):
    PENDING = "pending"
    SUCCESS = "success"
    ERROR = "error"


class AgentRunLog(SQLModel, table=True):
    """A log entry recording a single agent interaction (message send)."""

    __tablename__ = "agents_run_logs"
    __table_args__ = (
        Index(
            "ix_agents_run_logs_org_created",
            "organization_id",
            "created_at",
        ),
        Index(
            "ix_agents_run_logs_agent_created",
            "agent_id",
            "created_at",
        ),
        Index(
            "ix_agents_run_logs_org_created_kind",
            "organization_id",
            "created_at",
            "kind",
        ),
        Index(
            "ix_agents_run_logs_cron_task_created",
            "cron_task_id",
            "created_at",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    # Nullable so chat-triggered runs (which have no AgentSession) persist.
    session_id: UUID | None = Field(default=None, nullable=True)
    channel_id: UUID | None = Field(default=None, nullable=True)
    agent_id: UUID = Field(nullable=False)
    user_id: UUID = Field(nullable=False)
    organization_id: UUID = Field(nullable=False)
    model: str = Field(
        sa_column=Column(String(100), nullable=False),
    )
    provider_key_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_provider_keys.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    kind: AgentRunKind = Field(
        default=AgentRunKind.CHAT,
        sa_column=Column(String(16), nullable=False, default=AgentRunKind.CHAT),
    )
    # Set on rows produced by a scheduled/on-demand cron execution; SET NULL on
    # task delete so token and cost history survives.
    cron_task_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("agents_cron_tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    image_count: int = Field(default=0, nullable=False)
    cost: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(12, 6), nullable=True),
    )
    cost_currency: str | None = Field(
        default=None,
        sa_column=Column(String(3), nullable=True),
    )
    input_tokens: int = Field(default=0, nullable=False)
    output_tokens: int = Field(default=0, nullable=False)
    cache_creation_input_tokens: int = Field(default=0, nullable=False)
    cache_read_input_tokens: int = Field(default=0, nullable=False)
    thinking_tokens: int = Field(default=0, nullable=False)
    tool_calls: list[dict] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    model_calls: list[dict] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    tool_iterations: int = Field(default=0, nullable=False)
    duration_ms: int = Field(default=0, nullable=False)
    status: AgentRunStatus = Field(
        default=AgentRunStatus.SUCCESS,
        sa_column=Column(String(20), nullable=False, default=AgentRunStatus.SUCCESS),
    )
    error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    retry_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    failover_provider_key_ids: list[str] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    cancelled: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    deadline_exceeded: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentRunLog(id={self.id}, agent_id={self.agent_id}, "
            f"status={self.status!r}, tokens={self.input_tokens}+{self.output_tokens})>"
        )
