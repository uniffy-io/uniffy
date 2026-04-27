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
    """Thin durable audit of destructive tool confirmations.

    Hot approval state lives in Valkey (`approval:<request_id>`, TTL 300s).
    This table records the FINAL resolution only, written once when the
    approval resolves (approved / denied / expired). Writes are best-effort
    and non-blocking on the tool loop -- the audit is for analytics and
    post-hoc forensics, not for state machine correctness.

    `message_id` is a soft reference: the originating agent message may be
    hard-deleted later and we don't want audit rows cascaded away.
    """

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
        """Return string representation of AgentApprovalAudit."""
        return (
            f"<AgentApprovalAudit(request_id={self.request_id}, "
            f"tool={self.tool_name!r}, status={self.status!r})>"
        )
