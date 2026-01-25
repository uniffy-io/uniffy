"""EventAttendee model for event attendees."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Enum
from sqlmodel import Field, SQLModel

from uwos.core.models.shared import AttendeeRole, AttendeeStatus


class EventAttendee(SQLModel, table=True):
    """
    EventAttendee model representing an attendee of a calendar event.

    This is a junction table linking events to users with additional
    metadata about their attendance status and role.

    Attributes
    ----------
    id : UUID
        Unique identifier for the attendee record (primary key).
    event_id : UUID
        Event this attendee is linked to (foreign key).
    user_id : UUID
        User who is attending (foreign key to login_users).
    status : AttendeeStatus
        Response status (PENDING, ACCEPTED, TENTATIVE, DECLINED).
    role : AttendeeRole
        Role in the event (ORGANIZER, REQUIRED, OPTIONAL).
    responded_at : datetime | None
        Timestamp when the attendee responded.
    created_at : datetime
        Timestamp when the attendee was added.
    updated_at : datetime
        Timestamp when the record was last updated.

    """

    __tablename__ = "calendar_event_attendees"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
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
        """Return string representation of EventAttendee."""
        return (
            f"<EventAttendee(id={self.id}, event_id={self.event_id}, "
            f"user_id={self.user_id}, status={self.status})>"
        )
