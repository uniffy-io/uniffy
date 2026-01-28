"""CalendarEvent model for calendar events."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.models.shared import RecurrencePattern, VisibilityScope


class CalendarEvent(SQLModel, table=True):
    """
    CalendarEvent model representing a calendar event.

    Events are organization-scoped and can be linked to notes, files, and chats
    using the URN system. Supports recurrence, attendees, and markdown descriptions.

    Attributes
    ----------
    id : UUID
        Unique identifier for the event (primary key).
    organization_id : UUID
        Organization this event belongs to (foreign key).
    organizer_id : UUID
        User who created/organizes the event (foreign key to login_users).
    calendar_id : UUID
        Calendar this event belongs to (foreign key).
    category_id : UUID | None
        Category for color coding (foreign key).
    title : str
        Event title.
    description : str
        Event description in markdown format (supports URN mentions).
    start_time : datetime
        Event start time (with timezone).
    end_time : datetime
        Event end time (with timezone).
    is_all_day : bool
        Whether this is an all-day event.
    timezone : str
        Timezone identifier (e.g., 'America/New_York').
    location : str
        Event location (physical or virtual).
    meeting_url : str | None
        Meeting URL (Zoom, Google Meet, etc.).
    visibility : VisibilityScope
        Who can access this event.
    is_focus_time : bool
        Whether this event is marked as focus/deep work time.
    is_deleted : bool
        Soft delete flag.
    tags : list[str] | None
        Tags for categorization.
    linked_resources : list[dict] | None
        Linked resources (URN, type, name, url).
    outgoing_references : list[str] | None
        URNs referenced in this event's description.
    recurrence_pattern : RecurrencePattern
        Recurrence pattern (NONE, DAILY, WEEKLY, etc.).
    recurrence_config : dict | None
        Full recurrence configuration (interval, days, end date, etc.).
    created_at : datetime
        Timestamp when the event was created.
    updated_at : datetime
        Timestamp when the event was last updated.
    deleted_at : datetime | None
        Timestamp when the event was soft-deleted.

    """

    __tablename__ = "calendar_events"

    id: UUID = Field(default_factory=uuid4, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    organizer_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    calendar_id: UUID = Field(foreign_key="calendar_calendars.id", nullable=False, index=True)
    category_id: UUID | None = Field(default=None, foreign_key="calendar_categories.id", index=True)
    title: str = Field(max_length=500, nullable=False)
    description: str = Field(default="", nullable=False)
    start_time: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    end_time: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    is_all_day: bool = Field(default=False, nullable=False)
    timezone: str = Field(max_length=100, default="UTC", nullable=False)
    location: str = Field(default="", max_length=500, nullable=False)
    meeting_url: str | None = Field(default=None, max_length=2000)
    visibility: VisibilityScope = Field(
        default=VisibilityScope.PRIVATE,
        sa_column=Column(
            Enum(
                VisibilityScope,
                name="visibilityscope",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,  # Reuse existing enum from notes
            ),
            nullable=False,
            index=True,
        ),
    )
    is_focus_time: bool = Field(default=False, nullable=False)
    is_deleted: bool = Field(default=False, nullable=False)
    tags: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    linked_resources: list[dict[str, Any]] | None = Field(default=None, sa_column=Column(JSONB))
    outgoing_references: list[str] | None = Field(default=None, sa_column=Column(JSONB))
    recurrence_pattern: RecurrencePattern = Field(
        default=RecurrencePattern.NONE,
        sa_column=Column(
            Enum(
                RecurrencePattern,
                name="recurrencepattern",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    recurrence_config: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB))
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), onupdate=lambda: datetime.now(UTC)),
    )
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    @property
    def urn(self) -> str:
        """Return the URN for this calendar event."""
        return f"urn:uniffy:content:CALENDAR_EVENT:{self.id}"

    @property
    def owner_id(self) -> UUID:
        """Return owner_id (alias for organizer_id) for BaseContentOperations compatibility."""
        return self.organizer_id

    def __repr__(self) -> str:
        """Return string representation of CalendarEvent."""
        return (
            f"<CalendarEvent(id={self.id}, title={self.title!r}, "
            f"start_time={self.start_time}, organization_id={self.organization_id})>"
        )
