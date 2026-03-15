"""Agent session model for conversation storage."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentSession(SQLModel, table=True):
    """
    A conversation session between a user and an agent.

    Sessions track message history, token usage, and per-session
    configuration like model overrides.

    Attributes
    ----------
    id : UUID
        Unique identifier (primary key, UUIDv7).
    organization_id : UUID
        Organization this session belongs to (FK to login_organizations).
    agent_id : UUID
        Agent this session is with (FK to agents).
    user_id : UUID
        User who owns this session (FK to login_users).
    kind : str
        Session kind: "direct", "group", or "global".
    display_name : str | None
        User-provided or auto-generated name.
    model_override : str | None
        Per-session model switch (overrides agent default).
    total_input_tokens : int
        Cumulative input tokens across all messages.
    total_output_tokens : int
        Cumulative output tokens across all messages.
    message_count : int
        Total number of messages in this session.
    last_model_used : str | None
        Model used for the most recent assistant response.
    is_archived : bool
        Whether this session has been archived.
    created_at : datetime
        When the session was created.
    updated_at : datetime
        When the session was last updated.

    """

    __tablename__ = "agents_sessions"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    agent_id: UUID = Field(foreign_key="agents_agents.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    kind: str = Field(
        sa_column=Column(String(20), nullable=False),
    )
    display_name: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    model_override: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    total_input_tokens: int = Field(default=0, nullable=False)
    total_output_tokens: int = Field(default=0, nullable=False)
    message_count: int = Field(default=0, nullable=False)
    last_model_used: str | None = Field(
        default=None,
        sa_column=Column(String(100), nullable=True),
    )
    is_archived: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        """Return string representation of AgentSession."""
        return (
            f"<AgentSession(id={self.id}, kind={self.kind!r}, "
            f"agent_id={self.agent_id}, user_id={self.user_id})>"
        )
