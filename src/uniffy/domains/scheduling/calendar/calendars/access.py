"""The access a calendar confers on the events filed on it."""

from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.auth.permissions.roles import ROLE_ORDINAL, role_can_edit, role_can_view
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import ContentRole, ContentType

# Owning a calendar makes you its keeper, not the organizer of what others filed
# on it: the event's own organizer stays its OWNER and alone can transfer it.
CALENDAR_ROLE_TO_EVENT_ROLE: dict[ContentRole, ContentRole] = {
    ContentRole.VIEWER: ContentRole.VIEWER,
    ContentRole.COMMENTER: ContentRole.COMMENTER,
    ContentRole.EDITOR: ContentRole.EDITOR,
    ContentRole.ADMIN: ContentRole.ADMIN,
    ContentRole.OWNER: ContentRole.ADMIN,
}


def event_role_from_calendar(role: ContentRole | None) -> ContentRole | None:
    if role is None:
        return None
    return CALENDAR_ROLE_TO_EVENT_ROLE.get(role)


def higher_role(a: ContentRole | None, b: ContentRole | None) -> ContentRole | None:
    if a is None:
        return b
    if b is None:
        return a
    return a if ROLE_ORDINAL[a] >= ROLE_ORDINAL[b] else b


async def calendar_role(
    session: AsyncSession,
    checker: PermissionChecker,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
    *,
    hold: bool = False,
) -> ContentRole | None:
    query = select(Calendar.owner_id, Calendar.access_mode, Calendar.baseline_role).where(
        Calendar.id == calendar_id,
        Calendar.organization_id == organization_id,
        Calendar.is_deleted == False,  # noqa: E712
    )
    if hold:
        # KEY SHARE waits only for a delete's FOR UPDATE, never for a rename.
        query = query.with_for_update(read=True, key_share=True)
    row = (await session.execute(query)).one_or_none()
    if row is None:
        return None
    return await checker.effective_role(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.CALENDAR,
        content_id=calendar_id,
        owner_id=row.owner_id,
        access_mode=row.access_mode,
        baseline_role=row.baseline_role,
    )


async def require_calendar_view(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
    *,
    hold: bool = False,
) -> ContentRole:
    """A calendar the member cannot see answers exactly like one that does not exist."""
    role = await calendar_role(
        session, PermissionChecker(session), user_id, organization_id, calendar_id, hold=hold
    )
    if not role_can_view(role):
        raise NotFoundError("Calendar", calendar_id)
    return role


async def require_calendar_edit(
    session: AsyncSession,
    user_id: UUID,
    organization_id: UUID,
    calendar_id: UUID,
) -> ContentRole:
    """Filing an event on a calendar, or importing into it, takes EDITOR on the calendar.

    The row stays held until the caller commits, so a concurrent delete cannot
    retire the calendar under the event being filed.
    """
    role = await require_calendar_view(session, user_id, organization_id, calendar_id, hold=True)
    if not role_can_edit(role):
        raise PermissionDeniedError("edit", ContentType.CALENDAR.value)
    return role


async def event_calendar_id(session: AsyncSession, event: CalendarEvent) -> UUID:
    """Access follows the series: an override row resolves through its master's calendar."""
    if event.recurrence_id is None:
        return event.calendar_id
    master_calendar = await session.scalar(
        select(CalendarEvent.calendar_id).where(CalendarEvent.id == event.recurrence_id)
    )
    return master_calendar or event.calendar_id


async def accessible_calendar_ids(
    access_query: ContentAccessQuery,
    user_id: UUID,
    organization_id: UUID,
) -> Select:
    """Ids of the live calendars the user can view, as a subquery for event filters."""
    access_filter = await access_query.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.CALENDAR,
        content_id_column=Calendar.id,
        owner_id_column=Calendar.owner_id,
        access_mode_column=Calendar.access_mode,
        baseline_role_column=Calendar.baseline_role,
    )
    return select(Calendar.id).where(
        Calendar.organization_id == organization_id,
        Calendar.is_deleted == False,  # noqa: E712
        access_filter,
    )
