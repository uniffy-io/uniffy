"""The access a calendar confers on the events filed on it."""

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.queries import ContentAccessQuery
from uniffy.core.auth.permissions.roles import ROLE_ORDINAL, role_can_edit, role_can_view
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.connection import (
    WRITABLE_ROLES,
    ConnectedCalendar,
    SyncDirection,
)
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.link import CalendarEventLink
from uniffy.core.types import CalendarType, ContentRole, ContentType
from uniffy.domains.scheduling.calendar.policy import resolve_calendar_policy

# Owning a calendar makes you its keeper, not the organizer of what others filed
# on it: the event's own organizer stays its OWNER and alone can transfer it.
CALENDAR_ROLE_TO_EVENT_ROLE: dict[ContentRole, ContentRole] = {
    ContentRole.VIEWER: ContentRole.VIEWER,
    ContentRole.COMMENTER: ContentRole.COMMENTER,
    ContentRole.EDITOR: ContentRole.EDITOR,
    ContentRole.ADMIN: ContentRole.ADMIN,
    ContentRole.OWNER: ContentRole.ADMIN,
}


# Calendars whose content arrives from outside; only these can be read-only by type.
PROVIDER_CALENDAR_TYPES = frozenset({CalendarType.SUBSCRIBED, CalendarType.CONNECTED})


def event_role_from_calendar(role: ContentRole | None) -> ContentRole | None:
    if role is None:
        return None
    return CALENDAR_ROLE_TO_EVENT_ROLE.get(role)


def cap_read_only(role: ContentRole | None, read_only: bool) -> ContentRole | None:
    """A feed's events change only through the feed, so nobody holds more than VIEWER on them."""
    if role is None or not read_only:
        return role
    if ROLE_ORDINAL[role] > ROLE_ORDINAL[ContentRole.VIEWER]:
        return ContentRole.VIEWER
    return role


async def calendar_is_read_only(session: AsyncSession, calendar_id: UUID) -> bool:
    return calendar_id in await read_only_calendar_ids(session, [calendar_id])


async def read_only_calendar_ids(session: AsyncSession, calendar_ids: Collection[UUID]) -> set[UUID]:
    """Feeds, and provider calendars whose changes cannot flow back to the provider."""
    if not calendar_ids:
        return set()
    rows = (
        await session.execute(
            select(
                Calendar.id,
                Calendar.calendar_type,
                Calendar.organization_id,
                ConnectedCalendar.direction,
                ConnectedCalendar.access_role,
            )
            .outerjoin(ConnectedCalendar, ConnectedCalendar.calendar_id == Calendar.id)
            .where(
                Calendar.id.in_(list(calendar_ids)),
                Calendar.calendar_type.in_(PROVIDER_CALENDAR_TYPES),
            )
        )
    ).all()
    read_only: set[UUID] = set()
    writes: dict[UUID, bool] = {}
    for row in rows:
        if row.calendar_type == CalendarType.SUBSCRIBED:
            read_only.add(row.id)
            continue
        if row.direction != SyncDirection.TWO_WAY or row.access_role not in WRITABLE_ROLES:
            read_only.add(row.id)
            continue
        if row.organization_id not in writes:
            policy = await resolve_calendar_policy(session, row.organization_id)
            writes[row.organization_id] = policy.provider_writes_enabled()
        if not writes[row.organization_id]:
            read_only.add(row.id)
    return read_only


async def read_only_event_ids(session: AsyncSession, event_ids: Collection[UUID]) -> set[UUID]:
    """Series changed only in their provider: rules Uniffy cannot express, or an attendee's copy."""
    if not event_ids:
        return set()
    attendee_copy = (
        select(CalendarEventLink.event_id)
        .where(
            CalendarEventLink.event_id == CalendarEvent.id,
            CalendarEventLink.is_owner_link.is_(True),
            CalendarEventLink.is_organizer_copy.is_(False),
        )
        .exists()
    )
    return set(
        (
            await session.execute(
                select(CalendarEvent.id).where(
                    CalendarEvent.id.in_(list(event_ids)),
                    or_(CalendarEvent.is_mirrored_occurrence.is_(True), attendee_copy),
                )
            )
        ).scalars()
    )


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
    if await calendar_is_read_only(session, calendar_id):
        raise ValidationError(
            "calendar_id",
            "Events on this calendar come from its source and cannot be added here.",
        )
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
