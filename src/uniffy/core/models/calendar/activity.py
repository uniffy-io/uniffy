"""Activity model for calendar event history."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel

from uniffy.core.types import generate_id


class EventActivity(SQLModel, table=True):
    """Activity entry for a calendar event: field edits, attendee changes, RSVP responses."""

    __tablename__ = "calendar_activities"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    event_id: UUID = Field(foreign_key="calendar_events.id", nullable=False, index=True)
    actor_id: UUID = Field(foreign_key="login_users.id", nullable=False)
    action: str = Field(max_length=50, nullable=False)
    field_id: str | None = Field(default=None, max_length=100)
    previous_value: str | None = Field(default=None)
    new_value: str | None = Field(default=None)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
