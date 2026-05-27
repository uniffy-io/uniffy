"""EventReminder model for tracking individual reminder instances."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class EventReminder(SQLModel, table=True):
    """A single pre-scheduled reminder for one user and one event."""

    __tablename__ = "calendar_event_reminders"

    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "user_id",
            "minutes_before",
            name="uq_event_user_minutes",
        ),
        Index(
            "ix_reminders_pending",
            "sent_at",
            "scheduled_at",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    event_id: UUID = Field(foreign_key="calendar_events.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    minutes_before: int = Field(sa_column=Column(Integer, nullable=False))
    scheduled_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    sent_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        return (
            f"<EventReminder(id={self.id}, event_id={self.event_id}, "
            f"user_id={self.user_id}, minutes_before={self.minutes_before})>"
        )
