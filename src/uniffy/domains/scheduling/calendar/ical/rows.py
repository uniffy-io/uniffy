"""The event row a parsed VEVENT becomes, shared by one-off import and feed sync."""

from uuid import UUID

from uniffy.core.content.references import extract_all_outgoing_references
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import AccessMode, EventTransparency
from uniffy.domains.scheduling.calendar.ical.parse import ParsedEvent


def build_event(
    parsed: ParsedEvent,
    *,
    organization_id: UUID,
    organizer_id: UUID,
    calendar_id: UUID,
    recurrence_id: UUID | None = None,
    ical_uid: str | None,
    with_references: bool,
) -> CalendarEvent:
    return CalendarEvent(
        organization_id=organization_id,
        organizer_id=organizer_id,
        calendar_id=calendar_id,
        title=parsed.title,
        description=parsed.description,
        start_time=parsed.start_time,
        end_time=parsed.end_time,
        is_all_day=parsed.is_all_day,
        timezone=parsed.timezone,
        location=parsed.location,
        meeting_url=parsed.meeting_url,
        access_mode=AccessMode.OWNER_ONLY,
        status=parsed.status,
        visibility=parsed.visibility,
        # An all-day entry is a marker (a holiday, a trip), not time spent busy.
        transparency=(EventTransparency.TRANSPARENT if parsed.is_all_day else parsed.transparency),
        recurrence_pattern=parsed.recurrence_pattern,
        recurrence_config=parsed.recurrence_config,
        recurrence_id=recurrence_id,
        ical_uid=ical_uid,
        outgoing_references=(
            extract_all_outgoing_references(parsed.description, organization_id)
            if with_references and parsed.description
            else None
        ),
    )
