"""Agent run log model for recording each agent interaction."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentRunLog(SQLModel, table=True):
    """A log entry recording a single agent interaction (message send).

    Captures model, token usage, tool calls, duration, and status
    for observability, usage tracking, and debugging.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    session_id : UUID
        Session this run belongs to.
    agent_id : UUID
        Agent that processed this run.
    user_id : UUID
        User who initiated the run.
    organization_id : UUID
        Organization context.
    model : str
        Model identifier used for this run.
    input_tokens : int
        Total input tokens consumed across all LLM calls in this run.
    output_tokens : int
        Total output tokens produced across all LLM calls in this run.
    tool_calls : list[dict] | None
        List of tool calls made during this run.
        Each entry: {"name": str, "call_id": str}.
    tool_iterations : int
        Number of tool loop iterations in this run.
    duration_ms : int
        Total duration of the run in milliseconds.
    status : str
        Run outcome: "success", "error", or "timeout".
    error : str | None
        Error message if status is "error".
    created_at : datetime
        When the run started.

    """

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
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    # Nullable so chat-triggered runs (which have no AgentSession) can
    # still be persisted. The usage page filters by organization_id +
    # created_at and uses count(distinct session_id) for the "sessions"
    # tile, which ignores NULL by SQL semantics.
    session_id: UUID | None = Field(default=None, nullable=True)
    # Set on chat-triggered runs so we can later slice usage by channel.
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
    input_tokens: int = Field(default=0, nullable=False)
    output_tokens: int = Field(default=0, nullable=False)
    tool_calls: list[dict] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    tool_iterations: int = Field(default=0, nullable=False)
    duration_ms: int = Field(default=0, nullable=False)
    status: str = Field(
        sa_column=Column(String(20), nullable=False, default="success"),
    )
    error: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentRunLog."""
        return (
            f"<AgentRunLog(id={self.id}, agent_id={self.agent_id}, "
            f"status={self.status!r}, tokens={self.input_tokens}+{self.output_tokens})>"
        )
