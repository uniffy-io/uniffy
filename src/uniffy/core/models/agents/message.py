"""Agent message model for conversation message storage."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentMessage(SQLModel, table=True):
    """
    A single message in an agent conversation session.

    Messages are stored in PostgreSQL to enable search indexing,
    permission-controlled access, and URN references.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    session_id : UUID
        Session this message belongs to (FK to agent_sessions).
    role : str
        Message role: "user", "assistant", "tool", "system", or "summary".
    content : str | None
        Text content (nullable for tool messages with no text).
    input_tokens : int
        Input tokens consumed by this message.
    output_tokens : int
        Output tokens produced by this message.
    model : str | None
        Which model produced this message.
    tool_name : str | None
        Tool name for tool-role messages.
    tool_call_id : str | None
        Anthropic tool_use id for correlating calls and results.
    tool_args : dict | None
        Tool call arguments as JSON.
    tool_result : str | None
        Tool execution result text.
    is_thinking : bool
        Whether this is a thinking/reasoning message.
    is_compacted : bool
        Whether this message was replaced by a summary.
    created_at : datetime
        When the message was created.

    """

    __tablename__ = "agents_messages"
    __table_args__ = (
        Index(
            "ix_agents_messages_session_created",
            "session_id",
            "created_at",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    session_id: UUID = Field(foreign_key="agents_sessions.id", nullable=False)
    role: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    content: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    input_tokens: int = Field(default=0, nullable=False)
    output_tokens: int = Field(default=0, nullable=False)
    model: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    tool_name: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    tool_call_id: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    tool_args: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    tool_result: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    file_ids: list[str] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    is_thinking: bool = Field(default=False, nullable=False)
    is_compacted: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentMessage."""
        return f"<AgentMessage(id={self.id}, role={self.role!r}, session_id={self.session_id})>"
