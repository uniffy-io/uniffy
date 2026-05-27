"""Notification model for user notifications."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import NotificationType
from uniffy.core.types import generate_id


class Notification(SQLModel, table=True):
    """In-app notification addressed to one user within one organization."""

    __tablename__ = "notifications"
    __table_args__ = (
        Index(
            "ix_notifications_user_org_unread",
            "user_id",
            "organization_id",
            "is_read",
            "created_at",
        ),
        Index(
            "ix_notifications_user_unread_count",
            "user_id",
            "is_read",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    notification_type: NotificationType = Field(
        sa_column=Column(
            String(50),
            nullable=False,
        )
    )
    title: str = Field(max_length=500, nullable=False)
    body: str = Field(
        default="",
        sa_column=Column(Text, nullable=False, server_default=""),
    )
    source_urn: str | None = Field(default=None, max_length=500, index=True)
    actor_id: UUID | None = Field(default=None, foreign_key="login_users.id", nullable=True)
    is_read: bool = Field(default=False, nullable=False)
    read_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    notification_metadata: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    expires_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    def __repr__(self) -> str:
        return (
            f"<Notification(id={self.id}, user_id={self.user_id}, type={self.notification_type!r})>"
        )
