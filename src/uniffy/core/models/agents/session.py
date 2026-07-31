"""Agent session model for conversation storage."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class AgentSession(SQLModel, table=True):
    """A conversation session between a user and an agent."""

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
    is_test: bool = Field(default=False, nullable=False)
    loaded_tool_groups: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            PG_JSONB,
            nullable=False,
            server_default=text("'[]'::jsonb"),
        ),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentSession(id={self.id}, kind={self.kind!r}, "
            f"agent_id={self.agent_id}, user_id={self.user_id})>"
        )
