"""Read-side resolution of calendar delegation.

Delegation is a calendar-domain grant: it never enters ``effective_role``, and it confers at most
EDITOR on the events of the grantor's personal calendars.
"""

from collections.abc import Collection
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.calendar_delegation import (
    DELEGABLE_CALENDAR_TYPES,
    delegated_calendar_ids,
    delegated_grantor_ids,
    live_delegation_clause,
)
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.calendar import Calendar
from uniffy.core.models.calendar.delegation import CalendarDelegation, CalendarDelegationLevel
from uniffy.core.types import AttendeeRole, CalendarType, ContentRole

DELEGATED_CALENDAR_ROLE = ContentRole.EDITOR


def is_delegable(calendar_type: CalendarType) -> bool:
    return calendar_type in DELEGABLE_CALENDAR_TYPES


async def delegation_levels(
    session: AsyncSession,
    delegate_id: UUID,
    organization_id: UUID,
    calendar_ids: Collection[UUID],
) -> dict[UUID, CalendarDelegationLevel]:
    """The level the delegate holds on each of ``calendar_ids`` they reach by delegation."""
    if not calendar_ids:
        return {}
    rows = (
        await session.execute(
            select(Calendar.id, CalendarDelegation.level)
            .join(CalendarDelegation, CalendarDelegation.grantor_id == Calendar.owner_id)
            .where(
                Calendar.id.in_(calendar_ids),
                Calendar.id.in_(delegated_calendar_ids(delegate_id, organization_id)),
                CalendarDelegation.delegate_id == delegate_id,
                CalendarDelegation.organization_id == organization_id,
            )
        )
    ).all()
    return {calendar_id: level for calendar_id, level in rows}


async def active_delegation(
    session: AsyncSession,
    organization_id: UUID,
    grantor_id: UUID,
    delegate_id: UUID,
) -> CalendarDelegation | None:
    if grantor_id == delegate_id:
        return None
    return (
        await session.execute(
            select(CalendarDelegation).where(
                CalendarDelegation.grantor_id == grantor_id,
                CalendarDelegation.delegate_id == delegate_id,
                live_delegation_clause(organization_id),
            )
        )
    ).scalar_one_or_none()


async def active_delegate_ids(
    session: AsyncSession, organization_id: UUID, grantor_id: UUID
) -> list[UUID]:
    return list(
        (
            await session.execute(
                select(CalendarDelegation.delegate_id).where(
                    CalendarDelegation.grantor_id == grantor_id,
                    live_delegation_clause(organization_id),
                )
            )
        ).scalars()
    )


async def booking_organizer(
    session: AsyncSession, actor_id: UUID, organization_id: UUID, calendar_id: UUID
) -> UUID:
    """A delegate booking on the grantor's personal calendar books it in the grantor's name."""
    row = (
        await session.execute(
            select(Calendar.owner_id, Calendar.calendar_type).where(
                Calendar.id == calendar_id,
                Calendar.organization_id == organization_id,
            )
        )
    ).one_or_none()
    if row is None or row.owner_id == actor_id or not is_delegable(row.calendar_type):
        return actor_id
    if await active_delegation(session, organization_id, row.owner_id, actor_id) is None:
        return actor_id
    return row.owner_id


async def delegation_grantors(
    session: AsyncSession, delegate_id: UUID, organization_id: UUID
) -> dict[UUID, CalendarDelegationLevel]:
    """Everyone the member is a live delegate for, with the level each granted."""
    rows = (
        await session.execute(
            select(CalendarDelegation.grantor_id, CalendarDelegation.level).where(
                CalendarDelegation.delegate_id == delegate_id,
                live_delegation_clause(organization_id),
            )
        )
    ).all()
    return {grantor_id: level for grantor_id, level in rows}


async def invited_grantors(
    session: AsyncSession,
    delegate_id: UUID,
    organization_id: UUID,
    event_ids: Collection[UUID],
) -> dict[UUID, set[UUID]]:
    """For each event, the delegate's grantors invited to it; a delegate answers for them."""
    if not event_ids:
        return {}
    rows = (
        await session.execute(
            select(EventAttendee.event_id, EventAttendee.user_id).where(
                EventAttendee.event_id.in_(event_ids),
                EventAttendee.user_id.in_(delegated_grantor_ids(delegate_id, organization_id)),
                EventAttendee.role != AttendeeRole.ORGANIZER,
            )
        )
    ).all()
    invited: dict[UUID, set[UUID]] = {}
    for event_id, grantor_id in rows:
        invited.setdefault(event_id, set()).add(grantor_id)
    return invited


def delegated_event_role(
    level: CalendarDelegationLevel | None,
    organizer_id: UUID,
    viewer_id: UUID,
    *,
    private: bool,
    is_attendee: bool,
    arranged_by_id: UUID | None = None,
) -> ContentRole | None:
    """The event role a delegation confers; private events stay busy-only below the full level.

    ``private`` covers the row and its series master, so an occurrence made private on its own
    and an occurrence of a private series are capped alike. A delegate keeps what they booked.
    """
    if level is None:
        return None
    if (
        level == CalendarDelegationLevel.EVENTS
        and private
        and viewer_id not in (organizer_id, arranged_by_id)
        and not is_attendee
    ):
        return ContentRole.VIEWER
    return DELEGATED_CALENDAR_ROLE


async def private_detail_stand_ins(
    session: AsyncSession, viewer_id: UUID, organization_id: UUID
) -> frozenset[UUID]:
    """The viewer plus every grantor who let them see private details.

    A private event's details show to its attendees; a full-level delegate reads
    them wherever their grantor attends.
    """
    grantors = await delegation_grantors(session, viewer_id, organization_id)
    return frozenset(
        {viewer_id}
        | {
            grantor_id
            for grantor_id, level in grantors.items()
            if level == CalendarDelegationLevel.EVENTS_AND_PRIVATE
        }
    )
