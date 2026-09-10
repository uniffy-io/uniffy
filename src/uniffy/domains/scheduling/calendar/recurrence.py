"""Pure recurrence expansion logic for calendar events.

This module generates virtual event occurrences from a recurrence config
within a given date range. It has no database dependency.
"""

import calendar as cal_mod
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from uniffy.core.models.shared import DayOfWeek, RecurrencePattern

OCCURRENCE_ID_SEPARATOR = "__occurrence__"

# Map DayOfWeek enum values to Python weekday numbers (Monday=0, Sunday=6)
_DAY_OF_WEEK_TO_INT: dict[str, int] = {
    DayOfWeek.MONDAY.value: 0,
    DayOfWeek.TUESDAY.value: 1,
    DayOfWeek.WEDNESDAY.value: 2,
    DayOfWeek.THURSDAY.value: 3,
    DayOfWeek.FRIDAY.value: 4,
    DayOfWeek.SATURDAY.value: 5,
    DayOfWeek.SUNDAY.value: 6,
}


@dataclass
class OccurrenceInstance:
    """A single expanded occurrence of a recurring event."""

    occurrence_date: date
    start_time: datetime
    end_time: datetime


def resolve_event_zone(timezone: str) -> ZoneInfo:
    """Invalid stored zones degrade to UTC instead of failing every expansion."""
    try:
        return ZoneInfo(timezone)
    except KeyError, ValueError:
        return ZoneInfo("UTC")


def recurrence_end_date(recurrence_config: dict | None, timezone: str) -> date | None:
    """Resolve the series end bound to a date in the EVENT's timezone.

    The bound is stored as an instant (isoformat string) but compared against
    occurrence dates computed in the event's own zone; reading the instant's
    UTC date instead shifts the cut by a day near a UTC date boundary.
    Date-only and naive values are taken verbatim.
    """
    raw_end = (recurrence_config or {}).get("end_date")
    if not raw_end:
        return None
    if isinstance(raw_end, str):
        raw_end = datetime.fromisoformat(raw_end)
    if isinstance(raw_end, datetime):
        if raw_end.tzinfo is not None:
            return raw_end.astimezone(resolve_event_zone(timezone)).date()
        return raw_end.date()
    if isinstance(raw_end, date):
        return raw_end
    return None


def series_end_bound(occurrence_date: date, timezone: str) -> str:
    """Instant closing a series immediately before ``occurrence_date``.

    The last instant of the preceding day in the event's zone, so
    ``recurrence_end_date`` resolves it back to ``occurrence_date - 1`` and
    clients render the intended local day rather than a UTC-midnight shift.
    """
    tz = resolve_event_zone(timezone)
    cut_local = datetime(
        occurrence_date.year, occurrence_date.month, occurrence_date.day, tzinfo=tz
    ) - timedelta(seconds=1)
    return cut_local.astimezone(ZoneInfo("UTC")).isoformat()


def count_occurrences_through(
    event_start_date: date,
    pattern: RecurrencePattern,
    recurrence_config: dict | None,
    through: date,
) -> int:
    """Occurrences the series spends on or before ``through``, the master's own
    date included. Mirrors the expander's max-occurrence accounting, so
    cancelled exceptions still count.
    """
    config = recurrence_config or {}
    dates = _generate_occurrence_dates(
        event_start_date=event_start_date,
        pattern=pattern,
        interval=max(1, config.get("interval", 1)),
        days_of_week=config.get("days_of_week"),
        day_of_month=config.get("day_of_month"),
        end_date=None,
        max_occurrences=config.get("max_occurrences"),
        range_start=event_start_date,
        range_end=through,
    )
    return len(dates)


def occurrence_start_for_date(
    start_time: datetime, timezone: str, occurrence_date: date
) -> datetime:
    """Rebuild a start instant on ``occurrence_date`` preserving the event's
    LOCAL wall clock, so occurrences keep their hour across DST transitions.
    """
    tz = resolve_event_zone(timezone)
    local_start = start_time.astimezone(tz)
    occ_local = datetime(
        occurrence_date.year,
        occurrence_date.month,
        occurrence_date.day,
        local_start.hour,
        local_start.minute,
        local_start.second,
        tzinfo=tz,
    )
    return occ_local.astimezone(ZoneInfo("UTC"))


def expand_recurrence(
    start_time: datetime,
    end_time: datetime,
    recurrence_pattern: RecurrencePattern,
    recurrence_config: dict | None,
    range_start: datetime,
    range_end: datetime,
    exception_dates: set[date] | None = None,
    timezone: str = "UTC",
) -> list[OccurrenceInstance]:
    """Expand a recurring event into the virtual instances whose ``[start, end)``
    instants overlap ``[range_start, range_end)``, preserving the event's local
    wall clock across DST.
    """
    if recurrence_pattern == RecurrencePattern.NONE:
        return []

    if not recurrence_config:
        return []

    config = recurrence_config
    interval = max(1, config.get("interval", 1))

    end_date = recurrence_end_date(config, timezone)
    max_occurrences: int | None = config.get("max_occurrences")

    tz = resolve_event_zone(timezone)
    event_start_date = start_time.astimezone(tz).date()
    duration = end_time - start_time

    # Occurrence dates live in the event's LOCAL zone while the range bounds
    # are UTC instants: a boundary occurrence can sit on the neighbouring
    # local date. Widen the date window by a day each side and clip on
    # instants below.
    occurrence_dates = _generate_occurrence_dates(
        event_start_date=event_start_date,
        pattern=recurrence_pattern,
        interval=interval,
        days_of_week=config.get("days_of_week"),
        day_of_month=config.get("day_of_month"),
        end_date=end_date,
        max_occurrences=max_occurrences,
        range_start=range_start.date() - timedelta(days=1),
        range_end=range_end.date() + timedelta(days=1),
    )

    exceptions = exception_dates or set()
    results: list[OccurrenceInstance] = []

    for occ_date in occurrence_dates:
        # The master event's own date is already in results as a real event.
        if occ_date == event_start_date:
            continue

        if occ_date in exceptions:
            continue

        occ_start = occurrence_start_for_date(start_time, timezone, occ_date)
        occ_end = occ_start + duration

        if occ_start >= range_end or occ_end <= range_start:
            continue

        results.append(
            OccurrenceInstance(
                occurrence_date=occ_date,
                start_time=occ_start,
                end_time=occ_end,
            )
        )

    return results


def _generate_occurrence_dates(
    event_start_date: date,
    pattern: RecurrencePattern,
    interval: int,
    days_of_week: list[str] | None,
    day_of_month: int | None,
    end_date: date | None,
    max_occurrences: int | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """
    Generate all occurrence dates for a recurrence pattern within a range.

    Counts occurrences from the event start date for max_occurrences tracking.
    Only returns dates that fall within [range_start, range_end).
    """
    args = (end_date, max_occurrences, range_start, range_end)
    if pattern == RecurrencePattern.DAILY:
        return _expand_daily(event_start_date, interval, days_of_week, *args)
    elif pattern == RecurrencePattern.WEEKLY:
        return _expand_weekly(
            event_start_date,
            interval,
            days_of_week,
            *args,
        )
    elif pattern == RecurrencePattern.BIWEEKLY:
        return _expand_weekly(
            event_start_date,
            interval * 2,
            days_of_week,
            *args,
        )
    elif pattern == RecurrencePattern.MONTHLY:
        return _expand_monthly(
            event_start_date,
            interval,
            day_of_month,
            *args,
        )
    elif pattern == RecurrencePattern.YEARLY:
        return _expand_yearly(event_start_date, interval, *args)
    return []


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def _month_of(start: date, offset: int) -> tuple[int, int]:
    """Calendar month ``offset`` months after the master's own month."""
    total = start.month - 1 + offset
    return start.year + total // 12, total % 12 + 1


def _clamped_day(year: int, month: int, target_day: int) -> date:
    """The target day pulled back to the last of the month where it overflows."""
    return date(year, month, min(target_day, cal_mod.monthrange(year, month)[1]))


def _advance_month(year: int, month: int, interval: int) -> tuple[int, int]:
    month += interval
    if month > 12:
        year += (month - 1) // 12
        month = (month - 1) % 12 + 1
    return year, month


def _seek_daily(
    start: date,
    interval: int,
    allowed_weekdays: set[int] | None,
    range_start: date,
) -> tuple[date, int]:
    """Cursor at or after ``range_start``, plus the occurrences the series has
    already spent reaching it.

    Candidate dates form an arithmetic progression, so the cursor is computed.
    Walking to it instead would make a one-week request cost one step per
    interval elapsed since the master, which on a years-old series is thousands
    of steps for five dates.
    """
    if range_start <= start:
        return start, 0

    steps = _ceil_div((range_start - start).days, interval)
    cursor = start + timedelta(days=steps * interval)
    if allowed_weekdays is None:
        return cursor, steps
    if interval % 7 == 0:
        # Stepping in whole weeks never leaves the master's own weekday.
        return cursor, steps if start.weekday() in allowed_weekdays else 0

    # 7 is prime and the interval is not a multiple of it, so any seven
    # consecutive candidates cover every weekday exactly once.
    whole_cycles, remainder = divmod(steps, 7)
    spent = whole_cycles * len(allowed_weekdays)
    spent += sum(
        1 for step in range(remainder) if (start.weekday() + step * interval) % 7 in allowed_weekdays
    )
    return cursor, spent


def _seek_weekly(
    week_start: date,
    start: date,
    interval: int,
    target_days: list[int],
    range_start: date,
) -> tuple[date, int]:
    """Cursor week and occurrences already spent, computed rather than walked."""
    stride = 7 * interval
    # A week is worth visiting once its last day reaches the window.
    steps = _ceil_div((range_start - timedelta(days=6) - week_start).days, stride)
    if steps <= 0:
        return week_start, 0

    cursor = week_start + timedelta(days=steps * stride)
    # The master's own week counts only from the master onwards.
    first_week = sum(1 for day in target_days if week_start + timedelta(days=day) >= start)
    return cursor, first_week + (steps - 1) * len(target_days)


def _seek_monthly(
    start: date,
    interval: int,
    target_day: int,
    range_start: date,
) -> tuple[tuple[int, int], int]:
    """Cursor month and occurrences already spent, computed rather than walked."""
    months_ahead = (range_start.year - start.year) * 12 + (range_start.month - start.month)
    index = _ceil_div(months_ahead, interval) if months_ahead > 0 else 0
    if index and _clamped_day(*_month_of(start, index * interval), target_day) < range_start:
        # The cursor landed in the window's own month but before it opens; the
        # month after is already past it, so one step is always enough.
        index += 1
    if index == 0:
        return (start.year, start.month), 0

    # The master's month is skipped without counting when the target day falls
    # before the master itself.
    skipped = _clamped_day(start.year, start.month, target_day) < start
    return _month_of(start, index * interval), index - (1 if skipped else 0)


def _seek_yearly(start: date, interval: int, range_start: date) -> tuple[int, int]:
    """Cursor year and occurrences already spent, computed rather than walked."""
    years_ahead = range_start.year - start.year
    index = _ceil_div(years_ahead, interval) if years_ahead > 0 else 0
    if index and _clamped_day(start.year + index * interval, start.month, start.day) < range_start:
        index += 1
    if index == 0:
        return start.year, 0

    return start.year + index * interval, index


def _expand_daily(
    start: date,
    interval: int,
    days_of_week: list[str] | None,
    end_date: date | None,
    max_occurrences: int | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Expand daily recurrence, optionally filtering by allowed days of the week."""
    # Build a set of allowed Python weekday numbers (0=Monday, 6=Sunday)
    # If all 7 days or no filter specified, allow all days
    allowed_weekdays: set[int] | None = None
    if days_of_week and len(days_of_week) < 7:
        allowed_weekdays = {_DAY_OF_WEEK_TO_INT[d] for d in days_of_week if d in _DAY_OF_WEEK_TO_INT}

    if end_date and end_date < range_start:
        return []

    results: list[date] = []
    current, count = _seek_daily(start, interval, allowed_weekdays, range_start)

    while current <= range_end:
        if end_date and current > end_date:
            break
        if max_occurrences and count >= max_occurrences:
            break

        # Check if this day of week is allowed
        if allowed_weekdays is None or current.weekday() in allowed_weekdays:
            if current >= range_start:
                results.append(current)
            count += 1

        current += timedelta(days=interval)

    return results


def _expand_weekly(
    start: date,
    interval: int,
    days_of_week: list[str] | None,
    end_date: date | None,
    max_occurrences: int | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Expand weekly recurrence with specific days of the week."""
    # Default to the event's start day if no days specified
    if days_of_week:
        target_days = sorted({_DAY_OF_WEEK_TO_INT.get(d, start.weekday()) for d in days_of_week})
    else:
        target_days = [start.weekday()]

    if end_date and end_date < range_start:
        return []

    results: list[date] = []

    # Find the start of the first week (Monday of the event's week)
    week_start = start - timedelta(days=start.weekday())
    current_week, count = _seek_weekly(week_start, start, interval, target_days, range_start)

    while current_week <= range_end + timedelta(days=6):
        if end_date and current_week > end_date + timedelta(days=6):
            break

        for day_num in target_days:
            occ = current_week + timedelta(days=day_num)

            # Must be on or after the event start
            if occ < start:
                continue
            if end_date and occ > end_date:
                break
            if max_occurrences and count >= max_occurrences:
                break

            if occ >= range_start and occ <= range_end:
                results.append(occ)
            count += 1

        if max_occurrences and count >= max_occurrences:
            break

        current_week += timedelta(weeks=interval)

    return results


def _expand_monthly(
    start: date,
    interval: int,
    day_of_month: int | None,
    end_date: date | None,
    max_occurrences: int | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Expand monthly recurrence, clamping to valid day of month."""
    target_day = day_of_month or start.day

    if end_date and end_date < range_start:
        return []

    results: list[date] = []
    (current_year, current_month), count = _seek_monthly(start, interval, target_day, range_start)

    while True:
        occ = _clamped_day(current_year, current_month, target_day)

        if occ < start:
            current_year, current_month = _advance_month(current_year, current_month, interval)
            continue

        if end_date and occ > end_date:
            break
        if max_occurrences and count >= max_occurrences:
            break
        if occ > range_end:
            break

        if occ >= range_start:
            results.append(occ)
        count += 1

        current_year, current_month = _advance_month(current_year, current_month, interval)

    return results


def _expand_yearly(
    start: date,
    interval: int,
    end_date: date | None,
    max_occurrences: int | None,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Expand yearly recurrence, handling Feb 29 gracefully."""
    if end_date and end_date < range_start:
        return []

    results: list[date] = []
    current_year, count = _seek_yearly(start, interval, range_start)

    while True:
        # Handle Feb 29 in non-leap years
        occ = _clamped_day(current_year, start.month, start.day)

        if end_date and occ > end_date:
            break
        if max_occurrences and count >= max_occurrences:
            break
        if occ > range_end:
            break

        if occ >= range_start:
            results.append(occ)
        count += 1

        current_year += interval

    return results
