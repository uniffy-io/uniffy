"""What an event shows about its provider: the guests it lists and where it must be edited."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.connection import (
    CalendarConnection,
    CalendarProvider,
    ConnectedCalendar,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.calendar.participant import CalendarEventParticipant
from uniffy.domains.scheduling.calendar.calendars.access import (
    read_only_calendar_ids,
    read_only_event_ids,
)


@dataclass(frozen=True)
class ProviderDetails:
    participants: list[CalendarEventParticipant]
    edit_hint: CalendarProvider | None


async def provider_details(
    session: AsyncSession, event: CalendarEvent, viewer_id: UUID
) -> ProviderDetails:
    series_id: UUID = event.recurrence_id or event.id
    statement = select(CalendarEventParticipant).where(CalendarEventParticipant.event_id == event.id)
    if event.guest_list_hidden and viewer_id != event.organizer_id:
        statement = statement.where(
            or_(
                CalendarEventParticipant.is_organizer.is_(True),
                CalendarEventParticipant.user_id == viewer_id,
            )
        )
    participants = list(
        (
            await session.execute(
                statement.order_by(
                    CalendarEventParticipant.is_organizer.desc(), CalendarEventParticipant.email
                )
            )
        ).scalars()
    )
    provider = await session.scalar(
        select(CalendarConnection.provider)
        .join(ConnectedCalendar, ConnectedCalendar.connection_id == CalendarConnection.id)
        .join(CalendarEventLink, CalendarEventLink.connected_calendar_id == ConnectedCalendar.id)
        .where(CalendarEventLink.event_id == series_id, CalendarEventLink.is_owner_link.is_(True))
        .limit(1)
    )
    hint = None
    if provider is not None:
        read_only = series_id in await read_only_event_ids(session, [series_id]) or (
            event.calendar_id in await read_only_calendar_ids(session, [event.calendar_id])
        )
        hint = provider if read_only else None
    return ProviderDetails(participants=participants, edit_hint=hint)
