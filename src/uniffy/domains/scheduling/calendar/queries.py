"""Calendar-specific database queries."""

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.category import Category
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.login.user import User


async def get_events_in_range(
    session: AsyncSession,
    organization_id: UUID,
    start_date: datetime,
    end_date: datetime,
    calendar_ids: list[UUID] | None = None,
    category_ids: list[UUID] | None = None,
    include_deleted: bool = False,
) -> list[CalendarEvent]:
    query = select(CalendarEvent).where(
        and_(
            CalendarEvent.organization_id == organization_id,
            # Event overlaps with range if it starts before range ends
            # and ends after range starts
            CalendarEvent.start_time < end_date,
            CalendarEvent.end_time > start_date,
        )
    )

    if not include_deleted:
        query = query.where(CalendarEvent.is_deleted == False)  # noqa: E712

    if calendar_ids:
        query = query.where(CalendarEvent.calendar_id.in_(calendar_ids))

    if category_ids:
        query = query.where(CalendarEvent.category_id.in_(category_ids))

    query = query.order_by(CalendarEvent.start_time.asc())

    result = await session.execute(query)
    return list(result.scalars().all())


def _attendee_user_info(user: User) -> dict:
    return {
        "name": user.full_name or user.email,
        "email": user.email,
        "initials": _get_initials(user.full_name or user.email),
        "avatar_url": None,  # User model doesn't have avatar_url yet
        "timezone": None,  # User model doesn't have timezone yet
    }


async def get_attendees_for_events(
    session: AsyncSession,
    event_ids: Sequence[UUID],
) -> dict[UUID, list[tuple[EventAttendee, dict]]]:
    if not event_ids:
        return {}

    result = await session.execute(
        select(EventAttendee, User)
        .join(User, EventAttendee.user_id == User.id)
        .where(EventAttendee.event_id.in_(event_ids))
    )

    by_event: dict[UUID, list[tuple[EventAttendee, dict]]] = {}
    for attendee, user in result.all():
        by_event.setdefault(attendee.event_id, []).append((attendee, _attendee_user_info(user)))
    return by_event


async def get_event_attendees(
    session: AsyncSession,
    event_id: UUID,
) -> list[tuple[EventAttendee, dict]]:
    """Attendees for an event with their user information."""
    return (await get_attendees_for_events(session, [event_id])).get(event_id, [])


def _get_initials(name: str) -> str:
    """Get initials from a name."""
    if not name:
        return "?"
    parts = name.split()
    if len(parts) >= 2:
        return (parts[0][0] + parts[-1][0]).upper()
    return name[0].upper()


async def get_categories(
    session: AsyncSession,
    organization_id: UUID,
) -> list[Category]:
    result = await session.execute(
        select(Category)
        .where(Category.organization_id == organization_id)
        .order_by(Category.sort_order.asc(), Category.name.asc())
    )
    return list(result.scalars().all())


async def get_default_calendar(
    session: AsyncSession,
    organization_id: UUID,
    owner_id: UUID,
) -> Calendar | None:
    result = await session.execute(
        select(Calendar)
        .where(
            and_(
                Calendar.organization_id == organization_id,
                Calendar.owner_id == owner_id,
                Calendar.is_default == True,  # noqa: E712
            )
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_backlinks(
    session: AsyncSession,
    event_id: UUID,
    organization_id: UUID,
) -> list[CalendarEvent]:
    target_urn = f"urn:uniffy:content:CALENDAR_EVENT:{event_id}"
    result = await session.execute(
        select(CalendarEvent).where(
            and_(
                CalendarEvent.organization_id == organization_id,
                CalendarEvent.is_deleted == False,  # noqa: E712
                CalendarEvent.outgoing_references.contains([target_urn]),
            )
        )
    )
    return list(result.scalars().all())


async def ensure_default_calendar(
    session: AsyncSession,
    organization_id: UUID,
    owner_id: UUID,
) -> Calendar:
    calendar = await get_default_calendar(session, organization_id, owner_id)
    if calendar:
        return calendar

    # Create default calendar
    from uniffy.core.models.shared import CalendarType

    calendar = Calendar(
        organization_id=organization_id,
        owner_id=owner_id,
        name="My Calendar",
        color="#3b82f6",  # Blue
        is_visible=True,
        is_default=True,
        calendar_type=CalendarType.PERSONAL,
    )
    session.add(calendar)
    await session.commit()
    await session.refresh(calendar)
    return calendar


async def ensure_default_categories(
    session: AsyncSession,
    organization_id: UUID,
) -> list[Category]:
    existing = await get_categories(session, organization_id)
    if existing:
        return existing

    # Create default categories
    defaults = [
        {"name": "Meeting", "color": "#3b82f6", "icon": "calendar", "sort_order": 0},
        {"name": "Focus Time", "color": "#8b5cf6", "icon": "clock", "sort_order": 1},
        {"name": "Personal", "color": "#10b981", "icon": "user", "sort_order": 2},
        {"name": "Event", "color": "#f59e0b", "icon": "star", "sort_order": 3},
    ]

    categories = []
    for default in defaults:
        category = Category(
            organization_id=organization_id,
            name=default["name"],
            color=default["color"],
            icon=default["icon"],
            is_default=True,
            sort_order=default["sort_order"],
        )
        session.add(category)
        categories.append(category)

    await session.commit()
    for cat in categories:
        await session.refresh(cat)

    return categories


async def get_event_for_update(
    session: AsyncSession, event_id: UUID, organization_id: UUID
) -> CalendarEvent | None:
    return await session.scalar(
        select(CalendarEvent)
        .where(CalendarEvent.id == event_id, CalendarEvent.organization_id == organization_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def require_own_calendar(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
) -> None:
    """Calendar containers admit only their active owner."""
    owner = await session.scalar(
        select(Calendar.owner_id).where(
            Calendar.id == calendar_id,
            Calendar.organization_id == organization_id,
        )
    )
    if owner is None or owner != user_id:
        raise NotFoundError("Calendar", calendar_id)
