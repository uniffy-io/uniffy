"""Notification model for user notifications."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import NotificationType
from uniffy.core.types import generate_id


class Notification(SQLModel, table=True):
    """
    Notification model representing a notification sent to a user.

    Notifications are user-scoped and organization-scoped. Each notification
    has a type, title, body, and optional reference to the source content.

    Attributes
    ----------
    id : UUID
        Unique identifier for the notification (primary key).
    organization_id : UUID
        Organization context (foreign key to login_organizations).
    user_id : UUID
        Recipient user (foreign key to login_users).
    notification_type : NotificationType
        Type of notification.
    title : str
        Short notification title (max 500 chars).
    body : str
        Notification body content, supports Markdown with URN mentions (max 2000 chars).
    source_urn : str | None
        URN of the related content that triggered this notification.
    actor_id : UUID | None
        User who triggered the notification (foreign key to login_users).
    is_read : bool
        Whether the notification has been read.
    read_at : datetime | None
        Timestamp when the notification was read.
    notification_metadata : dict | None
        JSONB metadata for adapter-specific data.
    created_at : datetime
        Timestamp when the notification was created.
    expires_at : datetime | None
        Optional expiration timestamp.

    """

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
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", nullable=False, index=True
    )
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
    actor_id: UUID | None = Field(
        default=None, foreign_key="login_users.id", nullable=True
    )
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
        """Return string representation of Notification."""
        return (
            f"<Notification(id={self.id}, user_id={self.user_id}, "
            f"type={self.notification_type!r})>"
        )
