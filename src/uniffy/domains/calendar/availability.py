"""Free/busy computation and meeting-slot suggestions across org members."""

from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import AttendeeStatus, RecurrencePattern
from uniffy.domains.calendar.recurrence import expand_recurrence

MAX_FREE_BUSY_USERS = 20
MAX_WINDOW_DAYS = 62

Interval = tuple[datetime, datetime]


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


def merge_intervals(intervals: list[Interval]) -> list[Interval]:
    """Union overlapping/touching intervals into a sorted, disjoint list."""
    if not intervals:
        return []
    merged: list[Interval] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


async def get_busy_intervals(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
    range_start: datetime,
    range_end: datetime,
) -> dict[UUID, list[Interval]]:
    """Busy time per user, clipped to the range and merged.

    This deliberately reads events the CALLER may not be allowed to view:
    only (start, end) intervals ever leave this function - no titles, no
    details - and only for active members of the caller's own org. Declined
    invitations and all-day events do not count as busy.
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
            CalendarEvent.is_all_day == False,  # noqa: E712
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

    busy: dict[UUID, list[Interval]] = {uid: [] for uid in user_ids}
    for event, user_id in rows:
        if event.recurrence_pattern != RecurrencePattern.NONE and event.recurrence_id is None:
            intervals = _master_intervals(event)
        else:
            intervals = [(event.start_time, event.end_time)]
        for start, end in intervals:
            clipped = (max(start, range_start), min(end, range_end))
            if clipped[0] < clipped[1]:
                busy[user_id].append(clipped)

    return {uid: merge_intervals(items) for uid, items in busy.items()}


def _align_to_half_hour(value: datetime) -> datetime:
    """Smallest :00 / :30 boundary at or after `value`."""
    floored = value.replace(minute=0, second=0, microsecond=0)
    for candidate in (floored, floored + timedelta(minutes=30), floored + timedelta(hours=1)):
        if candidate >= value:
            return candidate
    return floored + timedelta(hours=1)


def compute_free_slots(
    busy: list[Interval],
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    timezone: str,
    earliest_hour: int = 9,
    latest_hour: int = 18,
    include_weekends: bool = False,
    max_results: int = 5,
) -> list[Interval]:
    """Open slots of `duration` inside working hours, avoiding all busy time.

    Working hours are interpreted in `timezone`. One slot per free gap,
    aligned to :00/:30 when that still fits, chronological order.
    """
    if not 0 <= earliest_hour < latest_hour <= 24:
        raise ValidationError("hours", "Need 0 <= earliest_hour < latest_hour <= 24")

    tz = ZoneInfo(timezone)
    merged_busy = merge_intervals(busy)
    slots: list[Interval] = []

    day = window_start.astimezone(tz).date()
    last_day = window_end.astimezone(tz).date()
    while day <= last_day and len(slots) < max_results:
        if include_weekends or day.weekday() < 5:
            day_start = datetime.combine(day, time(hour=earliest_hour), tzinfo=tz)
            if latest_hour == 24:
                day_end = datetime.combine(day + timedelta(days=1), time(), tzinfo=tz)
            else:
                day_end = datetime.combine(day, time(hour=latest_hour), tzinfo=tz)
            cursor = max(day_start, window_start)
            hard_end = min(day_end, window_end)

            for busy_start, busy_end in merged_busy:
                if busy_end <= cursor:
                    continue
                if busy_start >= hard_end:
                    break
                _emit_slot(slots, cursor, busy_start, duration, max_results)
                cursor = max(cursor, busy_end)
                if len(slots) >= max_results or cursor >= hard_end:
                    break
            if len(slots) < max_results:
                _emit_slot(slots, cursor, hard_end, duration, max_results)
        day += timedelta(days=1)

    return slots


def _emit_slot(
    slots: list[Interval],
    gap_start: datetime,
    gap_end: datetime,
    duration: timedelta,
    max_results: int,
) -> None:
    if len(slots) >= max_results or gap_start >= gap_end:
        return
    start = _align_to_half_hour(gap_start)
    if start < gap_start or start + duration > gap_end:
        start = gap_start
    if start + duration <= gap_end:
        slots.append((start, start + duration))
