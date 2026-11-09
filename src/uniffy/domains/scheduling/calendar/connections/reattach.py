"""Taking a detached calendar back into sync, unless someone else may now see or own it."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.connection import ConnectedCalendar
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.types import AccessMode, CalendarType, ContentType
from uniffy.domains.scheduling.calendar.calendars.subscribed import stage_connected_calendar

# A provider calendar without a colour of its own.
DEFAULT_COLOR = "#4285f4"


async def reattach_calendar(
    session: AsyncSession, row: ConnectedCalendar, owner_id: UUID, organization_id: UUID
) -> None:
    """Reuse the old calendar while it is still private to its owner, else start a new one.

    While detached it was an ordinary calendar that could be shared or handed over; syncing
    into it again would publish the owner's provider events to whoever holds it now.
    """
    calendar = None
    if row.calendar_id is not None:
        calendar = await session.scalar(select(Calendar).where(Calendar.id == row.calendar_id))
    if calendar is not None and await _still_private(session, calendar, owner_id):
        # The same calendar as before, so its events and their links match again.
        calendar.calendar_type = CalendarType.CONNECTED
        return
    # The old events stay where they are; the next snapshot mirrors them afresh.
    await session.execute(
        delete(CalendarEventLink).where(CalendarEventLink.connected_calendar_id == row.id)
    )
    fresh = await stage_connected_calendar(
        session, owner_id, organization_id, row.name, row.provider_color or DEFAULT_COLOR
    )
    row.calendar_id = fresh.id


async def _still_private(session: AsyncSession, calendar: Calendar, owner_id: UUID) -> bool:
    if (
        calendar.is_deleted
        or calendar.owner_id != owner_id
        or calendar.access_mode != AccessMode.OWNER_ONLY
    ):
        return False
    shared = await session.scalar(
        select(ContentMember.id)
        .where(
            ContentMember.content_type == ContentType.CALENDAR,
            ContentMember.content_id == calendar.id,
        )
        .limit(1)
    )
    return shared is None
