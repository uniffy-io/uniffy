"""Meeting-time suggestions honoring each attendee's working hours and timezone."""

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from uniffy.core.errors import ValidationError
from uniffy.domains.calendar.availability import BusyInterval, Interval, merge_intervals, occupancy
from uniffy.domains.settings.defaults import WORKDAY_NAMES
from uniffy.domains.settings.operations import SchedulingContext

MAX_SUGGESTIONS = 10
_CANDIDATE_POOL_FACTOR = 8


@dataclass(frozen=True)
class Suggestion:
    start: datetime
    end: datetime
    unavailable_optional_ids: tuple[UUID, ...]


def _parse_clock(value: str) -> time:
    hours, minutes = value.split(":")
    return time(hour=int(hours), minute=int(minutes))


def _align_to_half_hour(value: datetime) -> datetime:
    """Smallest :00 / :30 boundary at or after `value`."""
    floored = value.replace(minute=0, second=0, microsecond=0)
    for candidate in (floored, floored + timedelta(minutes=30), floored + timedelta(hours=1)):
        if candidate >= value:
            return candidate
    return floored + timedelta(hours=1)


def intersect_intervals(a: list[Interval], b: list[Interval]) -> list[Interval]:
    result: list[Interval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        start = max(a[i][0], b[j][0])
        end = min(a[i][1], b[j][1])
        if start < end:
            result.append((start, end))
        if a[i][1] <= b[j][1]:
            i += 1
        else:
            j += 1
    return result


def subtract_intervals(base: list[Interval], remove: list[Interval]) -> list[Interval]:
    result: list[Interval] = []
    remove = merge_intervals(remove)
    for start, end in base:
        cursor = start
        for r_start, r_end in remove:
            if r_end <= cursor:
                continue
            if r_start >= end:
                break
            if r_start > cursor:
                result.append((cursor, r_start))
            cursor = max(cursor, r_end)
            if cursor >= end:
                break
        if cursor < end:
            result.append((cursor, end))
    return result


def working_windows(
    schedule: SchedulingContext,
    window_start: datetime,
    window_end: datetime,
    hour_override: tuple[int, int] | None = None,
    extra_workdays: bool = False,
) -> list[Interval]:
    """The user's workable spans inside the window, on their own clock.

    `hour_override` replaces the stored day window (agent-tool compatibility);
    `extra_workdays` widens the workday set to all seven days.
    """
    tz = ZoneInfo(schedule.timezone)
    if hour_override is not None:
        earliest, latest = hour_override
        if not 0 <= earliest < latest <= 24:
            raise ValidationError("hours", "Need 0 <= earliest_hour < latest_hour <= 24")
        day_start_clock = time(hour=earliest)
        day_end_clock = None if latest == 24 else time(hour=latest)
    else:
        day_start_clock = _parse_clock(schedule.workday_start)
        day_end_clock = _parse_clock(schedule.workday_end)
    workday_indexes = (
        set(range(7))
        if extra_workdays
        else {WORKDAY_NAMES.index(name) for name in schedule.workdays}
    )

    windows: list[Interval] = []
    day = window_start.astimezone(tz).date()
    last_day = window_end.astimezone(tz).date()
    while day <= last_day:
        if day.weekday() in workday_indexes:
            start = datetime.combine(day, day_start_clock, tzinfo=tz)
            if day_end_clock is None:
                end = datetime.combine(day + timedelta(days=1), time(), tzinfo=tz)
            else:
                end = datetime.combine(day, day_end_clock, tzinfo=tz)
            clipped = (max(start, window_start), min(end, window_end))
            if clipped[0] < clipped[1]:
                windows.append(clipped)
        day += timedelta(days=1)
    return merge_intervals(windows)


def _overlaps(start: datetime, end: datetime, intervals: list[Interval]) -> bool:
    return any(i_start < end and i_end > start for i_start, i_end in intervals)


def _within(start: datetime, end: datetime, intervals: list[Interval]) -> bool:
    return any(i_start <= start and i_end >= end for i_start, i_end in intervals)


def suggest_meeting_times(
    busy_by_user: dict[UUID, list[BusyInterval]],
    schedule_by_user: dict[UUID, SchedulingContext],
    required_ids: list[UUID],
    optional_ids: list[UUID],
    room_busy: list[Interval],
    window_start: datetime,
    window_end: datetime,
    duration: timedelta,
    max_results: int = 5,
    hour_override: tuple[int, int] | None = None,
    extra_workdays: bool = False,
) -> list[Suggestion]:
    """Slots where every required attendee and the room are free, ranked by
    how many optional attendees can make it, then chronologically.
    """
    if duration <= timedelta(0):
        raise ValidationError("duration", "Duration must be positive")
    max_results = min(max(1, max_results), MAX_SUGGESTIONS)

    allowed: list[Interval] | None = None
    for uid in required_ids:
        windows = working_windows(
            schedule_by_user[uid], window_start, window_end, hour_override, extra_workdays
        )
        allowed = windows if allowed is None else intersect_intervals(allowed, windows)
        if not allowed:
            return []
    if allowed is None:
        return []

    blocked = list(room_busy)
    for uid in required_ids:
        blocked.extend(occupancy(busy_by_user.get(uid, [])))
    free = subtract_intervals(allowed, blocked)

    optional_busy = {uid: occupancy(busy_by_user.get(uid, [])) for uid in optional_ids}
    optional_windows = {
        uid: working_windows(
            schedule_by_user[uid], window_start, window_end, hour_override, extra_workdays
        )
        for uid in optional_ids
    }

    candidates: list[Suggestion] = []
    pool_cap = max_results * _CANDIDATE_POOL_FACTOR
    for gap_start, gap_end in free:
        cursor = _align_to_half_hour(gap_start)
        if cursor + duration > gap_end:
            cursor = gap_start
        while cursor + duration <= gap_end and len(candidates) < pool_cap:
            end = cursor + duration
            unavailable = tuple(
                uid
                for uid in optional_ids
                if _overlaps(cursor, end, optional_busy[uid])
                or not _within(cursor, end, optional_windows[uid])
            )
            candidates.append(Suggestion(cursor, end, unavailable))
            cursor = _align_to_half_hour(cursor + timedelta(minutes=30))
        if len(candidates) >= pool_cap:
            break

    candidates.sort(key=lambda s: (len(s.unavailable_optional_ids), s.start))
    return candidates[:max_results]
