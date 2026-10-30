from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.types import EventStatus
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden


async def resolve_meeting_title(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    channel_id: UUID,
    event_id: str,
) -> str:
    """Resolve an authorized event or occurrence title for its bound channel."""
    reader = CalendarEventReader(session)
    event, attendees = await reader.get_event_with_attendees(user_id, organization_id, event_id)
    role = await reader._resolve_role(user_id, organization_id, event)
    if event_details_hidden(
        event, user_id, role, any(attendee.user_id == user_id for attendee, _ in attendees)
    ):
        raise PermissionDeniedError("view", "Calendar event details")
    if event.channel_id != channel_id:
        raise ValidationError("calendar_event_id", "Event is not linked to this channel")
    if event.status == EventStatus.CANCELLED:
        raise ValidationError("calendar_event_id", "Event is cancelled")
    return event.title
