from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.calendar.exception import RecurrenceException
from uniffy.core.types import RecurrencePattern, generate_id
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.occurrences import (
    OccurrenceReference,
    OccurrenceTarget,
    load_occurrence_targets,
    parse_occurrence_reference,
    project_occurrence,
)


def _event() -> CalendarEvent:
    return CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Standup",
        start_time=datetime(2026, 9, 21, 6, tzinfo=UTC),
        end_time=datetime(2026, 9, 21, 6, 30, tzinfo=UTC),
        timezone="Europe/Sofia",
        recurrence_pattern=RecurrencePattern.DAILY,
        recurrence_config={
            "interval": 1,
            "days_of_week": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
        },
    )


def _session(event: CalendarEvent, exceptions: list[RecurrenceException] | None = None) -> MagicMock:
    masters = MagicMock()
    masters.scalars.return_value.all.return_value = [event]
    exception_rows = MagicMock()
    exception_rows.scalars.return_value.all.return_value = exceptions or []
    return MagicMock(execute=AsyncMock(side_effect=[masters, exception_rows]))


@pytest.mark.parametrize(
    "suffix", ["2026-02-30", "20260928", "2026-9-28", "2026-09-28__occurrence__2026-09-29", ""]
)
def test_occurrence_parser_rejects_malformed_dates(suffix: str) -> None:
    assert parse_occurrence_reference(f"{generate_id()}__occurrence__{suffix}") is None


async def test_occurrences_have_distinct_times_without_mutating_master() -> None:
    event = _event()
    refs = [OccurrenceReference(event.id, date(2026, 9, day)) for day in (28, 29)]
    targets = await load_occurrence_targets(_session(event), event.organization_id, refs)

    first = targets[refs[0]]
    second = targets[refs[1]]
    assert first is not None and second is not None
    assert first.start_time == datetime(2026, 9, 28, 6, tzinfo=UTC)
    assert second.start_time == datetime(2026, 9, 29, 6, tzinfo=UTC)
    projected = project_occurrence(event, refs[0], first)
    assert str(projected.id) == refs[0].id
    assert projected.start_time == first.start_time
    assert getattr(projected, "_occurrence_date") == "2026-09-28"
    assert event.start_time == datetime(2026, 9, 21, 6, tzinfo=UTC)
    assert event.id == refs[0].event_id


async def test_occurrence_keeps_local_hour_across_dst() -> None:
    event = _event()
    ref = OccurrenceReference(event.id, date(2026, 10, 26))
    target = (await load_occurrence_targets(_session(event), event.organization_id, [ref]))[ref]
    assert target is not None
    assert target.start_time == datetime(2026, 10, 26, 7, tzinfo=UTC)
    assert target.end_time == datetime(2026, 10, 26, 7, 30, tzinfo=UTC)


@pytest.mark.parametrize("day", [20, 26])
async def test_dates_before_series_or_off_schedule_do_not_resolve(day: int) -> None:
    event = _event()
    ref = OccurrenceReference(event.id, date(2026, 9, day))
    assert (await load_occurrence_targets(_session(event), event.organization_id, [ref]))[
        ref
    ] is None


@pytest.mark.parametrize("config", [{"end_date": "2026-09-27"}, {"max_occurrences": 3}])
async def test_ended_series_does_not_resolve(config: dict) -> None:
    event = _event()
    event.recurrence_config = {**event.recurrence_config, **config}
    ref = OccurrenceReference(event.id, date(2026, 9, 28))
    assert (await load_occurrence_targets(_session(event), event.organization_id, [ref]))[
        ref
    ] is None


async def test_cancellation_and_override_use_exact_occurrence_identity() -> None:
    event = _event()
    cancelled = OccurrenceReference(event.id, date(2026, 9, 28))
    moved = OccurrenceReference(event.id, date(2026, 9, 29))
    override_id = generate_id()
    session = _session(
        event,
        [
            RecurrenceException(
                event_id=event.id, original_date=cancelled.occurrence_date, is_cancelled=True
            ),
            RecurrenceException(
                event_id=event.id, original_date=moved.occurrence_date, override_event_id=override_id
            ),
        ],
    )
    targets = await load_occurrence_targets(session, event.organization_id, [cancelled, moved])
    assert targets[cancelled] is None
    assert targets[moved] == OccurrenceTarget(override_id)


async def test_reader_returns_occurrence_dates_and_checks_override_access() -> None:
    event = _event()
    ref = OccurrenceReference(event.id, date(2026, 9, 28))
    reader = CalendarEventReader(MagicMock())
    read = AsyncMock(return_value=(event, []))
    target = OccurrenceTarget(
        event.id, event.start_time + timedelta(days=7), event.end_time + timedelta(days=7)
    )
    with (
        patch(
            "uniffy.domains.scheduling.calendar.events.reader.EventQueryOperations.get_event_with_attendees",
            read,
        ),
        patch(
            "uniffy.domains.scheduling.calendar.events.reader.load_occurrence_targets",
            AsyncMock(return_value={ref: target}),
        ),
    ):
        occurrence, _ = await reader.get_event_with_attendees(
            event.organizer_id, event.organization_id, ref.id
        )
    assert str(occurrence.id) == ref.id
    assert occurrence.start_time == target.start_time
    read.assert_awaited_once_with(event.organizer_id, event.organization_id, event.id)

    override_id = generate_id()
    read = AsyncMock(side_effect=[(event, []), PermissionDeniedError("view", "event")])
    with (
        patch(
            "uniffy.domains.scheduling.calendar.events.reader.EventQueryOperations.get_event_with_attendees",
            read,
        ),
        patch(
            "uniffy.domains.scheduling.calendar.events.reader.load_occurrence_targets",
            AsyncMock(return_value={ref: OccurrenceTarget(override_id)}),
        ),
        pytest.raises(PermissionDeniedError),
    ):
        await reader.get_event_with_attendees(event.organizer_id, event.organization_id, ref.id)
    assert read.await_args.args[-1] == override_id


async def test_reader_does_not_open_series_for_cancelled_occurrence() -> None:
    event = _event()
    ref = OccurrenceReference(event.id, date(2026, 9, 28))
    with (
        patch(
            "uniffy.domains.scheduling.calendar.events.reader.EventQueryOperations.get_event_with_attendees",
            AsyncMock(return_value=(event, [])),
        ),
        patch(
            "uniffy.domains.scheduling.calendar.events.reader.load_occurrence_targets",
            AsyncMock(return_value={ref: None}),
        ),
        pytest.raises(NotFoundError),
    ):
        await CalendarEventReader(MagicMock()).get_event_with_attendees(
            event.organizer_id, event.organization_id, ref.id
        )
