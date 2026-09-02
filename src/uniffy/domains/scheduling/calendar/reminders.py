"""Occurrence-aware reminder anchoring for calendar events.

A reminder row is one `(event, user, minutes_before)` and its `scheduled_at`
always points at the NEXT occurrence that should remind. For recurring
masters the row rolls forward after firing instead of being marked sent, so
the row count stays flat while every occurrence reminds.
"""

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.types import RecurrencePattern
from uniffy.domains.scheduling.calendar.recurrence import expand_recurrence, resolve_event_zone

# Expansion window that is guaranteed to contain the next occurrence, in days
# per configured interval unit.
_WINDOW_DAYS_PER_INTERVAL = {
    RecurrencePattern.DAILY: 7,
    RecurrencePattern.WEEKLY: 7,
    RecurrencePattern.BIWEEKLY: 14,
    RecurrencePattern.MONTHLY: 31,
    RecurrencePattern.YEARLY: 366,
}


def is_recurring_master(event: CalendarEvent) -> bool:
    return event.recurrence_pattern != RecurrencePattern.NONE and event.recurrence_id is None


async def load_exception_dates(session: AsyncSession, event_id: UUID) -> set[date]:
    result = await session.execute(
        select(RecurrenceException.original_date).where(RecurrenceException.event_id == event_id)
    )
    return {row[0] for row in result.all()}


def next_reminder_start(
    event: CalendarEvent,
    exception_dates: set[date],
    minutes_before: int,
    now: datetime,
    after_start: datetime | None = None,
) -> datetime | None:
    """Earliest occurrence start whose reminder instant is still in the future.

    ``after_start`` additionally requires the occurrence to start strictly
    after that instant, which rolls the row past the occurrence just reminded.
    None means the series has no further occurrence to remind for.
    """
    lead = timedelta(minutes=minutes_before)

    def qualifies(start: datetime) -> bool:
        return start - lead > now and (after_start is None or start > after_start)

    if not is_recurring_master(event):
        return event.start_time if qualifies(event.start_time) else None

    tz = resolve_event_zone(event.timezone or "UTC")
    if qualifies(event.start_time) and event.start_time.astimezone(tz).date() not in exception_dates:
        return event.start_time

    interval = max(1, (event.recurrence_config or {}).get("interval", 1))
    per_interval = _WINDOW_DAYS_PER_INTERVAL.get(event.recurrence_pattern, 31)
    window = timedelta(days=per_interval * (interval + 1))

    floor = max(now, event.start_time.astimezone(UTC), after_start or now)
    range_start = floor - timedelta(days=1)
    occurrences = expand_recurrence(
        start_time=event.start_time,
        end_time=event.end_time,
        recurrence_pattern=event.recurrence_pattern,
        recurrence_config=event.recurrence_config,
        range_start=range_start,
        range_end=floor + window + lead,
        exception_dates=exception_dates,
        timezone=event.timezone or "UTC",
    )
    occurrences.sort(key=lambda occ: occ.start_time)
    for occ in occurrences:
        if qualifies(occ.start_time):
            return occ.start_time
    return None
