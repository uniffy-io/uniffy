"""RecurrenceException model for tracking cancelled or rescheduled occurrences."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, Date, DateTime, UniqueConstraint
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class RecurrenceException(SQLModel, table=True):
    """
    RecurrenceException tracks individual occurrences that are cancelled or rescheduled.

    Each row represents a single exception to a recurring event series.
    An occurrence can be cancelled (skipped) or overridden with a different event.

    Attributes
    ----------
    id : UUID
        Primary key.
    event_id : UUID
        The master recurring event this exception belongs to.
    original_date : date
        The specific occurrence date being modified.
    is_cancelled : bool
        If True, this occurrence is skipped entirely.
    override_event_id : UUID | None
        If set, points to a standalone CalendarEvent that replaces this occurrence.
    created_at : datetime
        Creation timestamp.
    updated_at : datetime
        Last update timestamp.

    """

    __tablename__ = "calendar_recurrence_exceptions"

    __table_args__ = (
        UniqueConstraint(
            "event_id",
            "original_date",
            name="uq_recurrence_exception_event_date",
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    event_id: UUID = Field(foreign_key="calendar_events.id", nullable=False, index=True)
    original_date: datetime = Field(sa_column=Column(Date, nullable=False, index=True))
    is_cancelled: bool = Field(default=False, nullable=False)
    override_event_id: UUID | None = Field(default=None, foreign_key="calendar_events.id")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )

    def __repr__(self) -> str:
        """Return string representation."""
        return (
            f"<RecurrenceException(id={self.id}, event_id={self.event_id}, "
            f"original_date={self.original_date}, is_cancelled={self.is_cancelled})>"
        )
