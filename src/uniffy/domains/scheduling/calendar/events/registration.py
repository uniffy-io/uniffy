"""Content-loader registration for calendars and their events."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.registry import (
    register_access_mode_guard,
    register_child_acl_refresh_hook,
    register_content_loader,
    register_role_resolver,
    register_transfer_guard,
)
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.scheduling.calendar.calendars.guards import (
    guard_calendar_access_mode,
    guard_calendar_transfer,
    guard_event_access_mode,
)
from uniffy.domains.scheduling.calendar.calendars.search import (
    enqueue_calendar_search_acl_refresh,
    record_calendar_search_acl_refresh,
)
from uniffy.domains.scheduling.calendar.events.content import EventContentOperations

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


async def _load_calendar(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Calendar | None:
    result = await session.execute(
        select(Calendar).where(
            Calendar.id == content_id,
            Calendar.organization_id == organization_id,
            Calendar.is_deleted == False,  # noqa: E712
        )
    )
    return result.scalar_one_or_none()


async def _resolve_event_role(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    content: object,
) -> ContentRole | None:
    # A calendar's admins manage who can see the events filed on it, as they
    # already edit, move and delete them; an event BLOCKED still wins.
    if not isinstance(content, CalendarEvent):
        return None
    return await EventContentOperations(session)._resolve_role(user_id, organization_id, content)


def register_calendar_content() -> None:
    global _registered
    if _registered:
        return
    register_content_loader(ContentType.CALENDAR_EVENT, _load_calendar_event)
    register_content_loader(ContentType.CALENDAR, _load_calendar)
    register_access_mode_guard(ContentType.CALENDAR_EVENT, guard_event_access_mode)
    register_role_resolver(ContentType.CALENDAR_EVENT, _resolve_event_role)
    register_access_mode_guard(ContentType.CALENDAR, guard_calendar_access_mode)
    register_transfer_guard(ContentType.CALENDAR, guard_calendar_transfer)
    register_child_acl_refresh_hook(
        ContentType.CALENDAR,
        record_calendar_search_acl_refresh,
        enqueue_calendar_search_acl_refresh,
    )
    _registered = True
