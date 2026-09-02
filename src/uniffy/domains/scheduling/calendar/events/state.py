"""Shared event state helpers used across calendar workflows."""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from uuid import UUID

from uniffy.core.auth.permissions import role_can_edit
from uniffy.core.models.calendar.event import CalendarEvent, EventVisibility
from uniffy.core.types import ContentRole
from uniffy.domains.scheduling.calendar.recurrence import OCCURRENCE_ID_SEPARATOR
from uniffy.domains.tags.operations import StagedManualTagReplacement

_ACTIVITY_VALUE_LIMIT = 500


@dataclass(frozen=True)
class _StagedCalendarEventCreate:
    event: CalendarEvent
    tags: StagedManualTagReplacement | None
    attendee_ids: tuple[UUID, ...]


def _activity_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, list):
        return ",".join(str(item) for item in value) or None
    return str(value)[:_ACTIVITY_VALUE_LIMIT]


def event_details_hidden(
    event: CalendarEvent,
    viewer_id: UUID,
    role: ContentRole | None,
    is_attendee: bool,
) -> bool:
    """Private details stay limited to organizers, attendees, and editors."""
    if event.visibility != EventVisibility.PRIVATE:
        return False
    if event.organizer_id == viewer_id or is_attendee:
        return False
    return not role_can_edit(role)


def _master_event_id(event: CalendarEvent) -> UUID:
    raw = str(event.id)
    if OCCURRENCE_ID_SEPARATOR in raw:
        return UUID(raw.split(OCCURRENCE_ID_SEPARATOR)[0])
    return event.id if isinstance(event.id, UUID) else UUID(raw)
