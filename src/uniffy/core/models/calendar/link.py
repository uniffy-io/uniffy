"""Where a Uniffy event lives on a provider calendar; one event may have a copy per member."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlmodel import Field, SQLModel

from uniffy.core.models.calendar.columns import utc_now
from uniffy.core.types import generate_id


class CalendarEventLink(SQLModel, table=True):
    """The provider's copy of an event as last seen; the owner link decides the event's content."""

    __tablename__ = "calendar_event_links"
    __table_args__ = (
        Index(
            "uq_calendar_event_links_provider_event",
            "connected_calendar_id",
            "provider_event_id",
            unique=True,
        ),
    )

    id: UUID = Field(default_factory=generate_id, primary_key=True, nullable=False)
    organization_id: UUID = Field(foreign_key="login_organizations.id", nullable=False, index=True)
    connected_calendar_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_connected_calendars.id", ondelete="CASCADE"), nullable=False
        )
    )
    event_id: UUID = Field(
        sa_column=Column(
            ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    provider_event_id: str = Field(max_length=500, nullable=False)
    provider_series_id: str | None = Field(default=None, max_length=500)
    # Set on occurrences mirrored one by one because the series does not fit Uniffy's model.
    occurrence_key: str | None = Field(default=None, max_length=100)
    ical_uid: str | None = Field(default=None, max_length=500)
    etag: str | None = Field(default=None, max_length=500)
    provider_updated_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    provider_sequence: int | None = Field(default=None)
    content_fingerprint: str | None = Field(default=None, sa_column=Column(String(64)))
    is_owner_link: bool = Field(default=False, nullable=False)
    is_organizer_copy: bool = Field(default=True, nullable=False)
    last_scan_id: UUID | None = Field(default=None)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )
