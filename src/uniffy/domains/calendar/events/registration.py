"""Content-loader registration for calendar events."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.registry import register_content_loader
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import ContentType

_registered = False


async def _load_calendar_event(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> CalendarEvent | None:
    result = await session.execute(
        select(CalendarEvent).where(
            CalendarEvent.id == content_id,
            CalendarEvent.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


def register_calendar_content() -> None:
    global _registered
    if _registered:
        return
    register_content_loader(ContentType.CALENDAR_EVENT, _load_calendar_event)
    _registered = True
