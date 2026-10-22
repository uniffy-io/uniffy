"""Pure period math for time tracking: calendar dates in, calendar dates out, no I/O."""

from datetime import date, timedelta

from uniffy.domains.projects.time.policy import PeriodType, ResolvedTimePolicy
from uniffy.domains.settings.preferences import WEEK_START_WEEKDAYS

DAYS_PER_WEEK = 7


def week_start_for(day: date, week_start: str) -> date:
    first_weekday = WEEK_START_WEEKDAYS.get(week_start, 0)
    return day - timedelta(days=(day.weekday() - first_weekday) % DAYS_PER_WEEK)


def _month_period_start(day: date, start_day: int) -> date:
    if day.day >= start_day:
        return day.replace(day=start_day)
    previous_month_end = day.replace(day=1) - timedelta(days=1)
    return previous_month_end.replace(day=start_day)


def _next_month_start(start: date, start_day: int) -> date:
    if start.month == 12:  # noqa: PLR2004 - December rolls into the next year
        return date(start.year + 1, 1, start_day)
    return date(start.year, start.month + 1, start_day)


def period_for(day: date, policy: ResolvedTimePolicy) -> tuple[date, date]:
    """Inclusive start and end of the period containing ``day``."""
    if policy.period_type == PeriodType.MONTHLY:
        start = _month_period_start(day, policy.month_start_day)
        return start, _next_month_start(start, policy.month_start_day) - timedelta(days=1)
    start = week_start_for(day, policy.week_start)
    return start, start + timedelta(days=DAYS_PER_WEEK - 1)


def periods_between(start: date, end: date, policy: ResolvedTimePolicy) -> list[tuple[date, date]]:
    """Every period touching the inclusive range, in order."""
    periods: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        period = period_for(cursor, policy)
        periods.append(period)
        cursor = period[1] + timedelta(days=1)
    return periods


def period_lock_date(period_end: date, policy: ResolvedTimePolicy) -> date:
    """First day on which the open sheets of an ended period are locked."""
    return period_end + timedelta(days=policy.period_lock_delay_days + 1)
