"""Budget period math.

Budgets roll on a calendar day-of-month (``reset_day``) rather than a
rolling 30-day window. This matches how LLM providers bill and how
finance teams model monthly caps. The helpers here are shared by the
image-quota check and the text-spend preflight check so both surfaces
agree on what "this period" means.
"""

from datetime import UTC, datetime, timedelta


def last_day_of_month(year: int, month: int) -> int:
    """Return the last calendar day of ``(year, month)``."""
    next_first = (
        datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    )
    return (next_first - timedelta(days=1)).day


def month_window(reset_day: int, now: datetime) -> tuple[datetime, datetime]:
    """Return the half-open ``[start, end)`` window of the current period.

    ``reset_day`` is clamped to the last day of the relevant month when
    the calendar runs out (e.g. Feb with ``reset_day=31``). Month
    rollover for year boundaries is handled explicitly.
    """
    day_of_month = min(reset_day, last_day_of_month(now.year, now.month))
    candidate_start = now.replace(
        day=day_of_month, hour=0, minute=0, second=0, microsecond=0
    )
    if now >= candidate_start:
        start = candidate_start
    else:
        if now.month == 1:
            prev_year = now.year - 1
            prev_month = 12
        else:
            prev_year = now.year
            prev_month = now.month - 1
        prev_day = min(reset_day, last_day_of_month(prev_year, prev_month))
        start = datetime(
            prev_year, prev_month, prev_day, tzinfo=now.tzinfo or UTC
        )

    if start.month == 12:
        next_year = start.year + 1
        next_month = 1
    else:
        next_year = start.year
        next_month = start.month + 1
    end_day = min(reset_day, last_day_of_month(next_year, next_month))
    end = datetime(next_year, next_month, end_day, tzinfo=start.tzinfo)
    return start, end


def day_window(now: datetime) -> tuple[datetime, datetime]:
    """Return the half-open ``[start, end)`` UTC day containing ``now``."""
    start = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return start, end
