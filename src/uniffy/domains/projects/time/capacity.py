"""Required minutes: the daily requirement over a person's workdays, less holidays and days off."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from fractions import Fraction
from itertools import batched
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.settings.settings_profile import SettingsProfile
from uniffy.domains.projects.time.periods import validate_date_range
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.scheduling.calendar.availability import (
    MAX_FREE_BUSY_USERS,
    MAX_WINDOW_DAYS,
    BusyInterval,
    get_busy_intervals,
)
from uniffy.domains.settings.defaults import SCHEDULING_DEFAULTS, WORKDAY_NAMES

OFF = Fraction(1)
HALF_OFF = Fraction(1, 2)
# Free/busy reads UTC instants; a person's calendar day starts up to a day either side of them.
ZONE_PAD = timedelta(days=1)
FREE_BUSY_WINDOW = timedelta(days=MAX_WINDOW_DAYS)

OffDays = dict[date, Fraction]


def _clock(raw: str, fallback: time) -> time:
    try:
        return time.fromisoformat(raw)
    except ValueError, TypeError:
        return fallback


def _zone(raw: object) -> str:
    if not isinstance(raw, str) or not raw:
        return "UTC"
    try:
        ZoneInfo(raw)
    except KeyError, ValueError:
        return "UTC"
    return raw


@dataclass(frozen=True)
class PersonSchedule:
    """A person's workdays and working window on their own clock."""

    workdays: tuple[str, ...] = SCHEDULING_DEFAULTS.workdays
    workday_start: time = _clock(SCHEDULING_DEFAULTS.workday_start, time(9, 0))
    workday_end: time = _clock(SCHEDULING_DEFAULTS.workday_end, time(18, 0))
    timezone: str = "UTC"


@dataclass(frozen=True)
class DayRequirement:
    day: date
    required_minutes: int
    # A holiday or an out-of-office day; required_minutes already reflects it.
    off: bool


def required_minutes_on(
    day: date,
    policy: ResolvedTimePolicy,
    workdays: tuple[str, ...],
    off: Fraction = Fraction(0),
) -> int:
    if day.isoformat() in policy.holidays:
        return 0
    if WORKDAY_NAMES[day.weekday()] not in workdays:
        return 0
    if off >= OFF:
        return 0
    return int(policy.required_minutes_per_day * (1 - off))


def required_minutes_between(
    start: date,
    end: date,
    policy: ResolvedTimePolicy,
    workdays: tuple[str, ...],
    off_days: OffDays | None = None,
) -> int:
    total = 0
    for day in days_between(start, end):
        total += required_minutes_on(day, policy, workdays, (off_days or {}).get(day, Fraction(0)))
    return total


def days_between(start: date, end: date) -> list[date]:
    validate_date_range(start, end)
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


async def schedules_for_users(
    session: AsyncSession, user_ids: list[UUID]
) -> dict[UUID, PersonSchedule]:
    """Workdays, working window and zone from each default profile, else the scheduling defaults."""
    schedules = {user_id: PersonSchedule() for user_id in user_ids}
    if not user_ids:
        return schedules
    result = await session.execute(
        select(
            SettingsProfile.user_id, SettingsProfile.scheduling, SettingsProfile.appearance
        ).where(
            SettingsProfile.user_id.in_(user_ids),
            SettingsProfile.is_default.is_(True),
        )
    )
    default = PersonSchedule()
    for user_id, scheduling, appearance in result.all():
        scheduling = scheduling or {}
        configured = scheduling.get("workdays")
        workdays = (
            tuple(str(day) for day in configured)
            if isinstance(configured, list) and configured
            else default.workdays
        )
        schedules[user_id] = PersonSchedule(
            workdays=workdays,
            workday_start=_clock(scheduling.get("workday_start"), default.workday_start),
            workday_end=_clock(scheduling.get("workday_end"), default.workday_end),
            timezone=_zone((appearance or {}).get("timezone")),
        )
    return schedules


async def _active_members(
    session: AsyncSession, organization_id: UUID, user_ids: list[UUID]
) -> list[UUID]:
    result = await session.execute(
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id.in_(user_ids),
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
        )
    )
    active = {row[0] for row in result.all()}
    return [user_id for user_id in user_ids if user_id in active]


def _covered(intervals: list[BusyInterval], start: datetime, end: datetime) -> timedelta:
    covered = timedelta(0)
    for interval in intervals:
        overlap = min(interval.end, end) - max(interval.start, start)
        if overlap > timedelta(0):
            covered += overlap
    return covered


def off_fraction(day: date, intervals: list[BusyInterval], schedule: PersonSchedule) -> Fraction:
    """Whole day or whole working window away is off; at least half the window is a half day."""
    zone = ZoneInfo(schedule.timezone)
    day_start = datetime.combine(day, time.min, tzinfo=zone).astimezone(UTC)
    day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)
    if _covered(intervals, day_start, day_end) >= day_end - day_start:
        return OFF
    work_start = datetime.combine(day, schedule.workday_start, tzinfo=zone).astimezone(UTC)
    work_end = datetime.combine(day, schedule.workday_end, tzinfo=zone).astimezone(UTC)
    window = work_end - work_start
    if window <= timedelta(0):
        return Fraction(0)
    covered = _covered(intervals, work_start, work_end)
    if covered >= window:
        return OFF
    if covered * 2 >= window:
        return HALF_OFF
    return Fraction(0)


def _windows(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        window_end = cursor + min(FREE_BUSY_WINDOW, end - cursor)
        windows.append((cursor, window_end))
        cursor = window_end
    return windows


async def out_of_office_intervals(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
    from_date: date,
    to_date: date,
) -> dict[UUID, list[BusyInterval]]:
    """Out-of-office spans per active member, read in free/busy sized chunks and windows."""
    validate_date_range(from_date, to_date)
    intervals: dict[UUID, list[BusyInterval]] = {}
    active = await _active_members(session, organization_id, user_ids)
    if not active:
        return intervals
    range_start = datetime.combine(from_date, time.min, tzinfo=UTC) - ZONE_PAD
    range_end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=UTC) + ZONE_PAD
    for chunk in batched(active, MAX_FREE_BUSY_USERS, strict=False):
        for window_start, window_end in _windows(range_start, range_end):
            busy = await get_busy_intervals(
                session, organization_id, list(chunk), window_start, window_end
            )
            for user_id, items in busy.items():
                away = [item for item in items if item.out_of_office]
                if away:
                    intervals.setdefault(user_id, []).extend(away)
    return intervals


async def off_days_for(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
    from_date: date,
    to_date: date,
    policy: ResolvedTimePolicy,
    schedules: dict[UUID, PersonSchedule],
) -> dict[UUID, OffDays]:
    """Holidays count as whole days off; out-of-office events add whole and half days per person."""
    off: dict[UUID, OffDays] = {user_id: {} for user_id in user_ids}
    for raw in policy.holidays:
        try:
            holiday = date.fromisoformat(raw)
        except ValueError:
            continue
        if from_date <= holiday <= to_date:
            for user_id in user_ids:
                off[user_id][holiday] = OFF
    if not user_ids or from_date > to_date:
        return off
    away = await out_of_office_intervals(session, organization_id, user_ids, from_date, to_date)
    days = days_between(from_date, to_date)
    for user_id, intervals in away.items():
        schedule = schedules.get(user_id, PersonSchedule())
        for day in days:
            if off[user_id].get(day) == OFF:
                continue
            fraction = off_fraction(day, intervals, schedule)
            if fraction > 0:
                off[user_id][day] = fraction
    return off


async def day_requirements_for(
    session: AsyncSession,
    organization_id: UUID,
    user_ids: list[UUID],
    from_date: date,
    to_date: date,
    policy: ResolvedTimePolicy,
) -> dict[UUID, list[DayRequirement]]:
    """Per person and day: the minutes the policy expects once their days off are taken out."""
    validate_date_range(from_date, to_date)
    schedules = await schedules_for_users(session, user_ids)
    off = await off_days_for(
        session, organization_id, user_ids, from_date, to_date, policy, schedules
    )
    requirements: dict[UUID, list[DayRequirement]] = {}
    for user_id in user_ids:
        workdays = schedules[user_id].workdays
        requirements[user_id] = [
            DayRequirement(
                day=day,
                required_minutes=required_minutes_on(
                    day, policy, workdays, off[user_id].get(day, Fraction(0))
                ),
                off=off[user_id].get(day, Fraction(0)) >= HALF_OFF,
            )
            for day in days_between(from_date, to_date)
        ]
    return requirements
