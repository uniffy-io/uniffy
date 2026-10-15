"""Notification events committed with their originating content mutation."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Text
from sqlmodel import Field, SQLModel


class NotificationOutbox(SQLModel, table=True):
    __tablename__ = "notification_outbox"

    event_id: UUID = Field(primary_key=True)
    organization_id: UUID = Field(
        foreign_key="login_organizations.id", ondelete="CASCADE", index=True
    )
    payload: str = Field(sa_column=Column(Text, nullable=False))
    attempted_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
