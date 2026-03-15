"""EventReminder model for tracking individual reminder instances."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Index, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class EventReminder(SQLModel, table=True):
    """
    EventReminder tracks individual reminder instances per user per event.

    Each row represents a single reminder that should fire at a specific time
    before an event starts. The scheduled_at is pre-computed as
    event.start_time - timedelta(minutes=minutes_before).

    Attributes
    ----------
    id : UUID
        Primary key.
    event_id : UUID
        Links to calendar_events.
    user_id : UUID
        Links to login_users.
    minutes_before : int
        Reminder interval (e.g., 15, 30, 60, 1440).
    scheduled_at : datetime
        Pre-computed time when the reminder should fire.
    sent_at : datetime | None
        Set when the reminder is actually sent (dedup guard).
    created_at : datetime
        Creation timestamp.

    """

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
        """Return string representation."""
        return (
            f"<EventReminder(id={self.id}, event_id={self.event_id}, "
            f"user_id={self.user_id}, minutes_before={self.minutes_before})>"
        )
