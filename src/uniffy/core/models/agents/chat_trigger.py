"""Persist agent admission so queue replay cannot start the same run twice."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, UniqueConstraint, text
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class ChatTriggerStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    UNCERTAIN = "uncertain"


class AgentChatTrigger(SQLModel, table=True):
    __tablename__ = "agents_chat_triggers"
    __table_args__ = (
        UniqueConstraint("message_id", "agent_id", name="uq_agents_chat_trigger"),
        Index(
            "ix_agents_chat_triggers_due",
            "available_at",
            postgresql_where=text("status IN ('pending', 'running')"),
        ),
        Index("ix_agents_chat_triggers_org_status", "organization_id", "status"),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True)
    organization_id: UUID = Field(foreign_key="login_organizations.id", ondelete="CASCADE")
    message_id: UUID = Field(foreign_key="chat_messages.id", ondelete="CASCADE")
    agent_id: UUID = Field(foreign_key="agents_agents.id", ondelete="CASCADE")
    run_id: UUID = Field(default_factory=generate_id)
    rule: str = Field(max_length=24)
    status: ChatTriggerStatus = Field(
        default=ChatTriggerStatus.PENDING, sa_column=Column(String(24), nullable=False)
    )
    last_error: str | None = Field(default=None, max_length=100)
    dispatches: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    available_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
