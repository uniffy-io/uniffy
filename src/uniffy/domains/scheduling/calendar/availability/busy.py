"""Free/busy computation across org members."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import (
    AttendeeStatus,
    EventStatus,
    EventTransparency,
    RecurrencePattern,
)
from uniffy.domains.scheduling.calendar.recurrence import expand_recurrence
from uniffy.domains.scheduling.intervals import Interval, merge_intervals

MAX_FREE_BUSY_USERS = 20
MAX_WINDOW_DAYS = 62


@dataclass(frozen=True, order=True)
class BusyInterval:
    """A blocked span; out-of-office spans are distinguishable but equally blocking."""

    start: datetime
    end: datetime
    out_of_office: bool = False


def occupancy(intervals: list[BusyInterval]) -> list[Interval]:
    """Flatten to merged (start, end) spans - kind is irrelevant to occupancy."""
    return merge_intervals([(item.start, item.end) for item in intervals])


async def _require_active_members(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
) -> None:
    result = await session.execute(
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id.in_(user_ids),
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
            Organization.deleted_at.is_(None),
            Organization.is_suspended.is_(False),
        )
    )
    active = {row[0] for row in result.all()}
    missing = [str(uid) for uid in user_ids if uid not in active]
    if missing:
        raise ValidationError(
            "user_ids",
            f"Not active members of this organization: {', '.join(missing)}",
        )


async def get_busy_intervals(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
    range_start: datetime,
    range_end: datetime,
) -> dict[UUID, list[BusyInterval]]:
    """Busy time per user, clipped to the range and merged per kind.

    This deliberately reads events the CALLER may not be allowed to view:
    only (start, end, out_of_office) intervals ever leave this function - no
    titles, no details - and only for active members of the caller's own org.
    Declined invitations, transparent (free) events, and cancelled events do
    not count as busy. Callers are responsible for gating WHO may ask.
    """
    if not user_ids:
        return {}
    if len(user_ids) > MAX_FREE_BUSY_USERS:
        raise ValidationError("user_ids", f"At most {MAX_FREE_BUSY_USERS} users per free/busy query")
    if range_end <= range_start:
        raise ValidationError("range", "range_end must be after range_start")
    if range_end - range_start > timedelta(days=MAX_WINDOW_DAYS):
        raise ValidationError("range", f"Window is capped at {MAX_WINDOW_DAYS} days")

    await _require_active_members(session, organization_id, user_ids)

    is_master = and_(
        CalendarEvent.recurrence_pattern != RecurrencePattern.NONE,
        CalendarEvent.recurrence_id.is_(None),
    )
    result = await session.execute(
        select(CalendarEvent, EventAttendee.user_id)
        .join(EventAttendee, EventAttendee.event_id == CalendarEvent.id)
        .where(
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.is_deleted == False,  # noqa: E712
            CalendarEvent.transparency == EventTransparency.OPAQUE,
            CalendarEvent.status != EventStatus.CANCELLED,
            EventAttendee.user_id.in_(user_ids),
            EventAttendee.status != AttendeeStatus.DECLINED,
            or_(
                and_(
                    CalendarEvent.start_time < range_end,
                    CalendarEvent.end_time > range_start,
                ),
                and_(is_master, CalendarEvent.start_time < range_end),
            ),
        )
    )
    rows = list(result.all())

    master_ids = {
        event.id
        for event, _ in rows
        if event.recurrence_pattern != RecurrencePattern.NONE and event.recurrence_id is None
    }
    exceptions_by_event: dict[UUID, set[date]] = {}
    if master_ids:
        exc_result = await session.execute(
            select(RecurrenceException).where(RecurrenceException.event_id.in_(master_ids))
        )
        for exc in exc_result.scalars().all():
            exceptions_by_event.setdefault(exc.event_id, set()).add(exc.original_date)

    # Occurrence overrides carry their own attendee rows, so a user removed
    # from one occurrence is covered: the exception date drops it from the
    # expansion and no override row joins back in for them.
    expanded_cache: dict[UUID, list[Interval]] = {}

    def _master_intervals(event: CalendarEvent) -> list[Interval]:
        cached = expanded_cache.get(event.id)
        if cached is not None:
            return cached
        occurrences = expand_recurrence(
            start_time=event.start_time,
            end_time=event.end_time,
            recurrence_pattern=event.recurrence_pattern,
            recurrence_config=event.recurrence_config,
            range_start=range_start,
            range_end=range_end,
            exception_dates=exceptions_by_event.get(event.id, set()),
            timezone=event.timezone or "UTC",
        )
        intervals = [(o.start_time, o.end_time) for o in occurrences]
        if event.start_time < range_end and event.end_time > range_start:
            intervals.append((event.start_time, event.end_time))
        expanded_cache[event.id] = intervals
        return intervals

    busy: dict[UUID, dict[bool, list[Interval]]] = {uid: {False: [], True: []} for uid in user_ids}
    for event, user_id in rows:
        if event.recurrence_pattern != RecurrencePattern.NONE and event.recurrence_id is None:
            intervals = _master_intervals(event)
        else:
            intervals = [(event.start_time, event.end_time)]
        for start, end in intervals:
            clipped = (max(start, range_start), min(end, range_end))
            if clipped[0] < clipped[1]:
                busy[user_id][event.is_out_of_office].append(clipped)

    merged: dict[UUID, list[BusyInterval]] = {}
    for uid, by_kind in busy.items():
        merged[uid] = sorted(
            BusyInterval(start, end, out_of_office=ooo)
            for ooo, intervals in by_kind.items()
            for start, end in merge_intervals(intervals)
        )
    return merged
