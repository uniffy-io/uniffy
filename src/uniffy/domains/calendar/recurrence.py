"""Pure recurrence expansion logic for calendar events.

This module generates virtual event occurrences from a recurrence config
within a given date range. It has no database dependency.
"""

import calendar as cal_mod
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from uniffy.core.models.shared import DayOfWeek, RecurrencePattern

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
    """
    Expand a recurring event into virtual instances within a date range.

    Parameters
    ----------
    start_time : datetime
        The master event's start time.
    end_time : datetime
        The master event's end time.
    recurrence_pattern : RecurrencePattern
        The recurrence pattern (DAILY, WEEKLY, etc.).
    recurrence_config : dict | None
        Full recurrence configuration (interval, days_of_week, etc.).
    range_start : datetime
        Start of the query range.
    range_end : datetime
        End of the query range.
    exception_dates : set[date] | None
        Dates to exclude (cancelled or overridden occurrences).
    timezone : str
        IANA timezone for the event (e.g., 'Europe/Sofia'). Used to
        preserve wall-clock time across DST transitions.

    Returns
    -------
    list[OccurrenceInstance]
        List of expanded occurrences within the range.

    """
    if recurrence_pattern == RecurrencePattern.NONE:
        return []

    if not recurrence_config:
        return []

    config = recurrence_config
    interval = max(1, config.get("interval", 1))

    # Determine end conditions
    end_date: date | None = None
    raw_end = config.get("end_date")
    if raw_end:
        if isinstance(raw_end, str):
            end_date = datetime.fromisoformat(raw_end).date()
        elif isinstance(raw_end, datetime):
            end_date = raw_end.date()
        elif isinstance(raw_end, date):
            end_date = raw_end

    max_occurrences: int | None = config.get("max_occurrences")

    # Resolve the event's local timezone to preserve wall-clock time across DST
    try:
        tz = ZoneInfo(timezone)
    except (KeyError, ValueError):
        tz = ZoneInfo("UTC")

    # Convert master start/end to local time to extract wall-clock hour/minute
    local_start = start_time.astimezone(tz)
    local_end = end_time.astimezone(tz)

    event_start_date = local_start.date()
    duration = local_end - local_start

    # Generate occurrence dates
    occurrence_dates = _generate_occurrence_dates(
        event_start_date=event_start_date,
        pattern=recurrence_pattern,
        interval=interval,
        days_of_week=config.get("days_of_week"),
        day_of_month=config.get("day_of_month"),
        end_date=end_date,
        max_occurrences=max_occurrences,
        range_start=range_start.date(),
        range_end=range_end.date(),
    )

    exceptions = exception_dates or set()
    results: list[OccurrenceInstance] = []

    for occ_date in occurrence_dates:
        # Skip the master event's own date (it's already in the results as a real event)
        if occ_date == event_start_date:
            continue

        # Skip exception dates
        if occ_date in exceptions:
            continue

        # Build occurrence in local timezone to preserve wall-clock time,
        # then convert to UTC so the rest of the system works consistently.
        occ_local = datetime(
            occ_date.year,
            occ_date.month,
            occ_date.day,
            local_start.hour,
            local_start.minute,
            local_start.second,
            tzinfo=tz,
        )
        occ_start = occ_local.astimezone(ZoneInfo("UTC"))
        occ_end = occ_start + duration

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

    results: list[date] = []
    count = 0
    current = start

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

    results: list[date] = []
    count = 0

    # Find the start of the first week (Monday of the event's week)
    week_start = start - timedelta(days=start.weekday())
    current_week = week_start

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
    results: list[date] = []
    count = 0

    current_year = start.year
    current_month = start.month

    while True:
        # Clamp day to valid range for this month
        max_day = cal_mod.monthrange(current_year, current_month)[1]
        clamped_day = min(target_day, max_day)
        occ = date(current_year, current_month, clamped_day)

        if occ < start:
            current_month += interval
            if current_month > 12:
                current_year += (current_month - 1) // 12
                current_month = (current_month - 1) % 12 + 1
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

        current_month += interval
        if current_month > 12:
            current_year += (current_month - 1) // 12
            current_month = (current_month - 1) % 12 + 1

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
    target_month = start.month
    target_day = start.day
    results: list[date] = []
    count = 0
    current_year = start.year

    while True:
        # Handle Feb 29 in non-leap years
        max_day = cal_mod.monthrange(current_year, target_month)[1]
        clamped_day = min(target_day, max_day)
        occ = date(current_year, target_month, clamped_day)

        if occ < start:
            current_year += interval
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

        current_year += interval

    return results
