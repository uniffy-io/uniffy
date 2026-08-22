"""Durable outbox rows for user notification email."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import ContentType, NotificationType, generate_id


class NotificationEmailStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    SENT = "sent"
    SUPPRESSED = "suppressed"
    SKIPPED = "skipped"
    FAILED = "failed"


class NotificationEmailDelivery(SQLModel, table=True):
    """One recipient's durable email copy of a notification event."""

    __tablename__ = "notification_email_deliveries"
    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "user_id",
            name="uq_notification_email_deliveries_event_user",
        ),
        Index(
            "ix_notification_email_deliveries_due",
            "status",
            "scheduled_for",
        ),
        Index(
            "ix_notification_email_deliveries_digest",
            "organization_id",
            "user_id",
            "frequency",
            "scheduled_for",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    event_id: UUID = Field(nullable=False)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id",
        nullable=False,
        index=True,
    )
    user_id: UUID = Field(
        foreign_key="login_users.id",
        nullable=False,
        index=True,
    )
    actor_id: UUID | None = Field(
        default=None,
        foreign_key="login_users.id",
        nullable=True,
    )
    notification_type: NotificationType = Field(sa_column=Column(String(50), nullable=False))
    title: str = Field(max_length=500, nullable=False)
    body: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    source_urn: str | None = Field(default=None, max_length=500)
    content_type: ContentType | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
    content_id: UUID | None = Field(default=None, nullable=True)
    notification_metadata: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    frequency: str = Field(max_length=16, nullable=False)
    status: NotificationEmailStatus = Field(
        default=NotificationEmailStatus.PENDING,
        sa_column=Column(String(20), nullable=False),
    )
    scheduled_for: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    lease_expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    attempt_count: int = Field(default=0, nullable=False)
    sent_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    provider_message_id: str | None = Field(default=None, max_length=500)
    terminal_reason: str | None = Field(default=None, max_length=100)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
