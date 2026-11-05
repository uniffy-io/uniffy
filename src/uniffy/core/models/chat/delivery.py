"""Independent delivery checkpoints committed with each chat message."""

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, text
from sqlmodel import Field, SQLModel


class ChatDeliveryEffect(StrEnum):
    INDEX = "index"
    NOTIFICATIONS = "notifications"
    RESOURCES = "resources"
    AGENTS = "agents"


class ChatDeliveryStatus(StrEnum):
    PENDING = "pending"
    FAILED = "failed"


class ChatDelivery(SQLModel, table=True):
    __tablename__ = "chat_deliveries"
    __table_args__ = (
        Index("ix_chat_deliveries_due", "available_at", postgresql_where=text("status = 'pending'")),
        Index("ix_chat_deliveries_org_status", "organization_id", "status", "created_at"),
    )

    message_id: UUID = Field(foreign_key="chat_messages.id", ondelete="CASCADE", primary_key=True)
    effect: ChatDeliveryEffect = Field(sa_column=Column(String(24), primary_key=True))
    organization_id: UUID = Field(foreign_key="login_organizations.id", ondelete="CASCADE")
    status: ChatDeliveryStatus = Field(
        default=ChatDeliveryStatus.PENDING, sa_column=Column(String(24), nullable=False)
    )
    dispatched_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    attempts: int = Field(default=0)
    last_error: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    available_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
