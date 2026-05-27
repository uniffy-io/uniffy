"""EventAttendee model for event attendees."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import AttendeeRole, AttendeeStatus
from uniffy.core.types import generate_id


class EventAttendee(SQLModel, table=True):
    """An attendee row linking a user to a calendar event with response status and role."""

    __tablename__ = "calendar_event_attendees"

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    event_id: UUID = Field(foreign_key="calendar_events.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    status: AttendeeStatus = Field(
        default=AttendeeStatus.PENDING,
        sa_column=Column(
            Enum(
                AttendeeStatus,
                name="attendeestatus",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    role: AttendeeRole = Field(
        default=AttendeeRole.REQUIRED,
        sa_column=Column(
            Enum(
                AttendeeRole,
                name="attendeerole",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    responded_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )

    def __repr__(self) -> str:
        return (
            f"<EventAttendee(id={self.id}, event_id={self.event_id}, "
            f"user_id={self.user_id}, status={self.status})>"
        )
