"""CalendarEvent model for calendar events."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from uniffy.core.types import (
    AccessMode,
    ContentRole,
    EventStatus,
    EventTransparency,
    EventVisibility,
    RecurrencePattern,
    generate_id,
)


class CalendarEvent(SQLModel, table=True):
    """A calendar event with optional recurrence, attendees, and markdown description."""

    __tablename__ = "calendar_events"
    __table_args__ = (
        Index(
            "ix_calendar_events_org_updated_refs",
            "organization_id",
            "updated_at",
            postgresql_where=text("is_deleted = false AND outgoing_references IS NOT NULL"),
        ),
        # Keyset paging over one calendar's live events (search access refresh).
        Index(
            "ix_calendar_events_calendar_live",
            "calendar_id",
            "id",
            postgresql_where=text("NOT is_deleted"),
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    organizer_id: UUID = Field(foreign_key="login_users.id", nullable=False, index=True)
    calendar_id: UUID = Field(foreign_key="calendar_calendars.id", nullable=False, index=True)
    category_id: UUID | None = Field(default=None, foreign_key="calendar_categories.id", index=True)
    title: str = Field(max_length=500, nullable=False)
    description: str = Field(default="", nullable=False)
    start_time: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True)
    )
    end_time: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False, index=True))
    is_all_day: bool = Field(default=False, nullable=False)
    timezone: str = Field(max_length=100, default="UTC", nullable=False)
    location: str = Field(default="", max_length=500, nullable=False)
    meeting_url: str | None = Field(default=None, max_length=2000)
    channel_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            ForeignKey("chat_channels.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    channel_auto_created: bool = Field(default=False, nullable=False)
    access_mode: AccessMode | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                AccessMode,
                name="accessmode",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
            index=True,
        ),
    )
    baseline_role: ContentRole | None = Field(
        default=None,
        sa_column=Column(
            Enum(
                ContentRole,
                name="contentrole",
                values_callable=lambda x: [e.value for e in x],
                create_type=False,
            ),
            nullable=True,
        ),
    )
    is_focus_time: bool = Field(default=False, nullable=False)
    status: EventStatus = Field(
        default=EventStatus.CONFIRMED,
        sa_column=Column(
            Enum(
                EventStatus,
                name="eventstatus",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    visibility: EventVisibility = Field(
        default=EventVisibility.STANDARD,
        sa_column=Column(
            Enum(
                EventVisibility,
                name="eventvisibility",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    transparency: EventTransparency = Field(
        default=EventTransparency.OPAQUE,
        sa_column=Column(
            Enum(
                EventTransparency,
                name="eventtransparency",
                values_callable=lambda x: [e.value for e in x],
            ),
            nullable=False,
        ),
    )
    is_out_of_office: bool = Field(default=False, nullable=False)
    is_deleted: bool = Field(default=False, nullable=False)
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
    reminders: list[int] | None = Field(default=None, sa_column=Column(JSONB))
    recurrence_id: UUID | None = Field(default=None, foreign_key="calendar_events.id", index=True)
    # Identity carried in from an imported file; re-importing it must not
    # duplicate the event. Rows created in the product leave this NULL.
    ical_uid: str | None = Field(default=None, max_length=500)
    # RFC 5545 revision counter. Clients ignore an update whose sequence has
    # not moved, so every change mail has to advance it.
    ical_sequence: int = Field(default=0, nullable=False)
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
        return f"urn:uniffy:content:CALENDAR_EVENT:{self.id}"

    @property
    def owner_id(self) -> UUID:
        return self.organizer_id

    def __repr__(self) -> str:
        return (
            f"<CalendarEvent(id={self.id}, title={self.title!r}, "
            f"start_time={self.start_time}, organization_id={self.organization_id})>"
        )
