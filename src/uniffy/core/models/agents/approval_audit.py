"""Agent approval audit model for destructive tool confirmation history."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB as PG_JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlmodel import Field, SQLModel


class AgentApprovalAudit(SQLModel, table=True):
    """Durable record of the final resolution for a destructive tool confirmation."""

    __tablename__ = "agents_approval_audit"
    __table_args__ = (
        Index(
            "ix_agents_approval_audit_channel",
            "channel_id",
            "requested_at",
        ),
    )

    request_id: UUID = Field(primary_key=True, nullable=False)
    channel_id: UUID = Field(
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("chat_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    message_id: UUID = Field(
        sa_column=Column(PG_UUID(as_uuid=True), nullable=False),
    )
    agent_id: UUID = Field(
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("agents_agents.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    tool_name: str = Field(
        sa_column=Column(Text(), nullable=False),
    )
    args_json: dict = Field(
        default_factory=dict,
        sa_column=Column(PG_JSONB, nullable=False),
    )
    status: str = Field(
        sa_column=Column(Text(), nullable=False),
    )
    decided_by: UUID | None = Field(
        default=None,
        sa_column=Column(
            PG_UUID(as_uuid=True),
            ForeignKey("login_users.id"),
            nullable=True,
        ),
    )
    decided_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    requested_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<AgentApprovalAudit(request_id={self.request_id}, "
            f"tool={self.tool_name!r}, status={self.status!r})>"
        )
