"""Load the rows a VCALENDAR needs and shape them for the serializer."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.login.user import User
from uniffy.core.types import ContentType, EventVisibility, RecurrencePattern
from uniffy.domains.permissions.access import (
    MAX_RESOURCE_PAGE,
    ResourceAccessResolver,
    ResourceKey,
)
from uniffy.domains.scheduling.calendar.events.state import event_details_hidden
from uniffy.domains.scheduling.calendar.ical.emit import (
    EventExport,
    IcalAttendee,
    IcalPerson,
)


async def build_exports(
    session: AsyncSession,
    events: Sequence[CalendarEvent],
    *,
    viewer_id: UUID,
    organization_id: UUID,
) -> list[EventExport]:
    """Assemble exports for ``events`` as ``viewer_id`` is allowed to see them.

    Each series pulls its exceptions and moved occurrences so the document is
    self-contained, and a private event the viewer is not on publishes as a
    busy block. The reads are batched across the whole set rather than per
    event, so a calendar export costs a fixed number of queries.
    """
    if not events:
        return []

    masters = [event for event in events if event.recurrence_id is None]
    series_ids = [
        event.id for event in masters if event.recurrence_pattern != RecurrencePattern.NONE
    ]

    exceptions = await _exceptions_for(session, series_ids)
    overrides = await _overrides_for(session, series_ids)

    hydrated = list(masters) + [row for rows in overrides.values() for row in rows]
    attendees, rosters = await _attendees_for(session, [event.id for event in hydrated])
    people = await _people_for(session, {event.organizer_id for event in hydrated})
    hidden = await _hidden_from(
        session,
        hydrated,
        rosters,
        viewer_id=viewer_id,
        organization_id=organization_id,
    )
    replaced = {
        row.override_event_id: row.original_date
        for rows in exceptions.values()
        for row in rows
        if row.override_event_id is not None
    }

    exports: list[EventExport] = []
    for event in masters:
        exports.append(
            EventExport(
                event=event,
                organizer=people.get(event.organizer_id),
                attendees=attendees.get(event.id, ()),
                details_hidden=event.id in hidden,
                cancelled_dates=[
                    row.original_date
                    for row in exceptions.get(event.id, ())
                    if row.is_cancelled and row.override_event_id is None
                ],
                overrides=tuple(
                    EventExport(
                        event=override,
                        organizer=people.get(override.organizer_id),
                        attendees=attendees.get(override.id, ()),
                        details_hidden=override.id in hidden,
                        original_date=replaced.get(override.id),
                    )
                    for override in overrides.get(event.id, ())
                ),
            )
        )
    return exports


async def _hidden_from(
    session: AsyncSession,
    events: Sequence[CalendarEvent],
    rosters: dict[UUID, set[UUID]],
    *,
    viewer_id: UUID,
    organization_id: UUID,
) -> set[UUID]:
    """Which of these events publish as busy for this viewer.

    Only private events can be hidden, so the authorization round trip is paid
    for those alone; everything else is already as public as the calendar it
    sits on.
    """
    private = [event for event in events if event.visibility == EventVisibility.PRIVATE]
    if not private:
        return set()

    resolver = ResourceAccessResolver(session)
    decisions = {}
    for start in range(0, len(private), MAX_RESOURCE_PAGE):
        decisions.update(
            await resolver.resolve_page(
                actor_id=viewer_id,
                organization_id=organization_id,
                keys=[
                    ResourceKey(ContentType.CALENDAR_EVENT, event.id)
                    for event in private[start : start + MAX_RESOURCE_PAGE]
                ],
            )
        )
    return {
        event.id
        for event in private
        if event_details_hidden(
            event,
            viewer_id,
            decisions[ResourceKey(ContentType.CALENDAR_EVENT, event.id)].role,
            viewer_id in rosters.get(event.id, set()),
        )
    }


async def _exceptions_for(
    session: AsyncSession, series_ids: Sequence[UUID]
) -> dict[UUID, list[RecurrenceException]]:
    """Every exception in the series, not just a window's worth - an export
    that dropped the rest would resurrect occurrences the organizer cancelled.
    """
    if not series_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(RecurrenceException).where(RecurrenceException.event_id.in_(series_ids))
            )
        )
        .scalars()
        .all()
    )
    by_event: dict[UUID, list[RecurrenceException]] = {}
    for row in rows:
        by_event.setdefault(row.event_id, []).append(row)
    return by_event


async def _overrides_for(
    session: AsyncSession, series_ids: Sequence[UUID]
) -> dict[UUID, list[CalendarEvent]]:
    if not series_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(CalendarEvent).where(
                    CalendarEvent.recurrence_id.in_(series_ids),
                    CalendarEvent.is_deleted == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    by_series: dict[UUID, list[CalendarEvent]] = {}
    for row in rows:
        by_series.setdefault(row.recurrence_id, []).append(row)
    return by_series


async def _attendees_for(
    session: AsyncSession, event_ids: Sequence[UUID]
) -> tuple[dict[UUID, list[IcalAttendee]], dict[UUID, set[UUID]]]:
    """The roster twice over: as addresses to emit, and as ids to authorize by."""
    if not event_ids:
        return {}, {}
    rows = (
        await session.execute(
            select(EventAttendee, User)
            .join(User, EventAttendee.user_id == User.id)
            .where(EventAttendee.event_id.in_(event_ids))
        )
    ).all()

    by_event: dict[UUID, list[IcalAttendee]] = {}
    rosters: dict[UUID, set[UUID]] = {}
    for attendee, user in rows:
        by_event.setdefault(attendee.event_id, []).append(
            IcalAttendee(
                person=_person(user),
                role=attendee.role,
                status=attendee.status,
            )
        )
        rosters.setdefault(attendee.event_id, set()).add(attendee.user_id)
    return by_event, rosters


async def _people_for(session: AsyncSession, user_ids: set[UUID]) -> dict[UUID, IcalPerson]:
    if not user_ids:
        return {}
    rows = (await session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    return {user.id: _person(user) for user in rows}


def _person(user: User) -> IcalPerson:
    return IcalPerson(email=user.email, name=user.full_name or user.email)
