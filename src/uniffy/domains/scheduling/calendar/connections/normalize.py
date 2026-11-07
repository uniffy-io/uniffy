"""Provider events in one shape, so the sync engine never reads Google or Graph JSON."""

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import StrEnum

from uniffy.core.models.calendar.participant import ParticipantResponse
from uniffy.core.types import EventStatus, EventTransparency, EventVisibility


class ItemKind(StrEnum):
    # A one-off event.
    SINGLE = "SINGLE"
    # The series itself; ``recurrence`` holds its rule lines.
    MASTER = "MASTER"
    # One instance of a series that differs from the rule (moved, retitled).
    OCCURRENCE = "OCCURRENCE"
    # One instance of a series the provider removed.
    CANCELLED_OCCURRENCE = "CANCELLED_OCCURRENCE"
    # The event or series is gone from this calendar.
    REMOVED = "REMOVED"


class SkipReason(StrEnum):
    MISSING_START = "MISSING_START"
    UNREADABLE_DATE = "UNREADABLE_DATE"
    MISSING_ID = "MISSING_ID"


@dataclass(frozen=True)
class ProviderAttendee:
    email: str
    display_name: str | None = None
    response: ParticipantResponse = ParticipantResponse.PENDING
    is_organizer: bool = False
    is_optional: bool = False
    # The connected account itself.
    is_self: bool = False


@dataclass(frozen=True)
class ProviderEvent:
    provider_event_id: str
    kind: ItemKind
    ical_uid: str | None = None
    etag: str | None = None
    updated_at: datetime | None = None
    sequence: int | None = None
    # The series an OCCURRENCE or CANCELLED_OCCURRENCE belongs to.
    series_id: str | None = None
    # The date the rule put this instance on, before any move.
    original_date: date | None = None
    title: str = ""
    description: str = ""
    start_time: datetime | None = None
    end_time: datetime | None = None
    timezone: str = "UTC"
    is_all_day: bool = False
    location: str = ""
    meeting_url: str | None = None
    # The provider runs its own meeting link; Uniffy must not append one to the description.
    has_conference: bool = False
    status: EventStatus = EventStatus.CONFIRMED
    visibility: EventVisibility = EventVisibility.STANDARD
    transparency: EventTransparency = EventTransparency.OPAQUE
    # RFC 5545 property lines: ``RRULE:...``, ``EXDATE...``, ``RDATE...``.
    recurrence: tuple[str, ...] = ()
    attendees: tuple[ProviderAttendee, ...] = ()
    organizer_email: str | None = None
    organizer_name: str | None = None
    # The connected account organizes this event (its copy is the authoritative one).
    is_organizer: bool = True
    # The organizer keeps the guest list from guests, so this copy cannot say who left.
    guests_hidden: bool = False
    is_out_of_office: bool = False
    is_focus_time: bool = False


@dataclass(frozen=True)
class SkippedItem:
    provider_event_id: str
    reason: SkipReason


@dataclass(frozen=True)
class ChangeBatch:
    """One sync round: every page read, the cursor to keep, and whether it covered everything."""

    items: tuple[ProviderEvent, ...]
    skipped: tuple[SkippedItem, ...] = ()
    cursor: str | None = None
    # A full snapshot: anything linked but not seen in it is gone.
    full_scan: bool = False
    # Series instances fetched for rules Uniffy cannot express, keyed by series id.
    mirrored: dict[str, tuple[ProviderEvent, ...]] = field(default_factory=dict)
    # Series whose every exception is in ``items``; anything else stored for them is stale.
    complete_series: frozenset[str] = frozenset()
