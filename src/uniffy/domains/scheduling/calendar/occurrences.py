"""Resolve occurrence identities without materializing calendar rows."""

import copy
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.domains.scheduling.calendar.recurrence import (
    OCCURRENCE_ID_SEPARATOR,
    expand_recurrence,
)


@dataclass(frozen=True)
class OccurrenceReference:
    event_id: UUID
    occurrence_date: date

    @property
    def id(self) -> str:
        return f"{self.event_id}{OCCURRENCE_ID_SEPARATOR}{self.occurrence_date.isoformat()}"


def parse_occurrence_reference(value: str) -> OccurrenceReference | None:
    parts = value.split(OCCURRENCE_ID_SEPARATOR)
    if len(parts) != 2:
        return None
    try:
        event_id = UUID(parts[0])
        occurrence_date = date.fromisoformat(parts[1])
    except ValueError:
        return None
    if str(event_id) != parts[0] or occurrence_date.isoformat() != parts[1]:
        return None
    return OccurrenceReference(event_id, occurrence_date)


@dataclass(frozen=True)
class OccurrenceTarget:
    event_id: UUID
    start_time: datetime | None = None
    end_time: datetime | None = None


async def load_occurrence_targets(
    session: AsyncSession,
    organization_id: UUID,
    references: list[OccurrenceReference],
) -> dict[OccurrenceReference, OccurrenceTarget | None]:
    """Callers authorize masters first and independently authorize returned override IDs."""
    if not references:
        return {}
    if len(references) > 100:
        raise ValueError("Maximum 100 occurrence references allowed")
    rows = await session.execute(
        select(CalendarEvent).where(
            CalendarEvent.organization_id == organization_id,
            CalendarEvent.id.in_({ref.event_id for ref in references}),
            CalendarEvent.is_deleted == False,  # noqa: E712
        )
    )
    events = {event.id: event for event in rows.scalars().all()}
    rows = await session.execute(
        select(RecurrenceException).where(
            tuple_(RecurrenceException.event_id, RecurrenceException.original_date).in_([
                (ref.event_id, ref.occurrence_date) for ref in references if ref.event_id in events
            ]),
        )
    )
    exceptions = {
        (exception.event_id, exception.original_date): exception
        for exception in rows.scalars().all()
    }
    targets: dict[OccurrenceReference, OccurrenceTarget | None] = {}
    for ref in references:
        event = events.get(ref.event_id)
        exception = exceptions.get((ref.event_id, ref.occurrence_date))
        if event is None or (exception is not None and exception.is_cancelled):
            targets[ref] = None
        elif exception is not None and exception.override_event_id is not None:
            targets[ref] = OccurrenceTarget(exception.override_event_id)
        else:
            targets[ref] = _expand_target(event, ref)
    return targets


def _expand_target(event: CalendarEvent, ref: OccurrenceReference) -> OccurrenceTarget | None:
    day = datetime.combine(ref.occurrence_date, datetime.min.time(), UTC)
    occurrences = expand_recurrence(
        start_time=event.start_time,
        end_time=event.end_time,
        recurrence_pattern=event.recurrence_pattern,
        recurrence_config=event.recurrence_config,
        range_start=day - timedelta(days=1),
        range_end=day + timedelta(days=2),
        timezone=event.timezone,
    )
    for occurrence in occurrences:
        if occurrence.occurrence_date == ref.occurrence_date:
            return OccurrenceTarget(event.id, occurrence.start_time, occurrence.end_time)
    return None


def project_occurrence(
    event: CalendarEvent, ref: OccurrenceReference, target: OccurrenceTarget
) -> CalendarEvent:
    if target.start_time is None or target.end_time is None:
        return event
    occurrence = copy.copy(event)
    occurrence.id = ref.id  # type: ignore[assignment]
    occurrence.start_time = target.start_time
    occurrence.end_time = target.end_time
    occurrence._occurrence_date = ref.occurrence_date.isoformat()  # type: ignore[attr-defined]
    return occurrence
