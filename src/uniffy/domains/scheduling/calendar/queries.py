"""Calendar-specific database queries."""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

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
    """
    Get events within a date range.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    start_date : datetime
        Start of the range.
    end_date : datetime
        End of the range.
    calendar_ids : list[UUID] | None
        Filter by calendars (None = all).
    category_ids : list[UUID] | None
        Filter by categories (None = all).
    include_deleted : bool
        Include soft-deleted events.

    Returns
    -------
    list[CalendarEvent]
        Events in the date range.

    """
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
    """Attendees with their user information for many events in one query,
    keyed by event. An event with no attendees is absent.
    """
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
    """
    Get all categories for an organization.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    list[Category]
        Categories ordered by sort_order.

    """
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
    """
    Get the user's default calendar.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    owner_id : UUID
        Owner user ID.

    Returns
    -------
    Calendar | None
        Default calendar or None if not found.

    """
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
    """
    Get events that reference the given event via URN links.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    event_id : UUID
        Target event ID.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    list[CalendarEvent]
        Events that reference the target event.

    """
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
    """
    Ensure user has a default calendar, creating one if needed.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.
    owner_id : UUID
        Owner user ID.

    Returns
    -------
    Calendar
        The default calendar.

    """
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
    """
    Ensure organization has default categories, creating them if needed.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    organization_id : UUID
        Organization ID.

    Returns
    -------
    list[Category]
        The categories (existing or newly created).

    """
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


async def soft_delete_event(
    session: AsyncSession,
    event: CalendarEvent,
) -> CalendarEvent:
    """
    Soft delete a calendar event.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    event : CalendarEvent
        Event to delete.

    Returns
    -------
    CalendarEvent
        The soft-deleted event.

    """
    event.is_deleted = True
    event.deleted_at = datetime.now(UTC)
    event.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(event)
    return event


async def permanent_delete_event(
    session: AsyncSession,
    event: CalendarEvent,
) -> None:
    """
    Permanently delete a calendar event.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    event : CalendarEvent
        Event to delete.

    """
    # Delete attendees first
    await session.execute(select(EventAttendee).where(EventAttendee.event_id == event.id))
    result = await session.execute(select(EventAttendee).where(EventAttendee.event_id == event.id))
    for attendee in result.scalars().all():
        await session.delete(attendee)

    await session.delete(event)
    await session.commit()
