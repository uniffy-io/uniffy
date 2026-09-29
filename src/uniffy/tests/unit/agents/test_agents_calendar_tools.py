from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.content.references import MENTION_PATTERN, extract_urns_from_content, parse_urn
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import ContentType, EventVisibility, RecurrencePattern, generate_id
from uniffy.domains.agents.tools.builtin.calendar import (
    _event_mention,
    _execute_list_events,
    _format_event_result,
)
from uniffy.domains.agents.tools.definitions import ToolContext


def _context() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        user_timezone="UTC",
    )


def _event(ctx: ToolContext) -> CalendarEvent:
    return CalendarEvent(
        organization_id=ctx.organization_id,
        organizer_id=ctx.user_id,
        calendar_id=generate_id(),
        title="Daily standup",
        start_time=datetime(2026, 9, 21, 6, tzinfo=UTC),
        end_time=datetime(2026, 9, 21, 6, 30, tzinfo=UTC),
        recurrence_pattern=RecurrencePattern.DAILY,
    )


def _occurrence(event: CalendarEvent) -> CalendarEvent:
    return event.model_copy(
        update={
            "id": f"{event.id}__occurrence__2026-09-28",
            "start_time": event.start_time + timedelta(days=7),
            "end_time": event.end_time + timedelta(days=7),
        },
    )


async def test_list_uses_stored_event_references_and_keeps_occurrence_times() -> None:
    ctx = _context()
    series = _event(ctx)
    standalone = _event(ctx)
    standalone.title = "Hack day"
    standalone.recurrence_pattern = RecurrencePattern.NONE
    with patch(
        "uniffy.domains.scheduling.calendar.operations.CalendarEventReader.get_events_in_range",
        new=AsyncMock(return_value=[_occurrence(series), standalone]),
    ):
        result = await _execute_list_events(
            ctx, {"start_date": "2026-09-27", "end_date": "2026-10-04"},
        )

    assert result.success
    assert {parse_urn(urn) for urn in extract_urns_from_content(result.data)} == {
        (ContentType.CALENDAR_EVENT, series.id),
        (ContentType.CALENDAR_EVENT, standalone.id),
    }
    assert "__occurrence__" not in result.data
    assert "2026-09-28 06:00 to 2026-09-28 06:30" in result.data
    assert "Hack day" in result.data


async def test_formatted_occurrence_links_series_and_keeps_its_own_time() -> None:
    event = _event(_context())

    result = await _format_event_result("Event", _occurrence(event))

    assert extract_urns_from_content(result) == [event.urn]
    assert "2026-09-28 06:00 to 2026-09-28 06:30" in result


def test_saved_override_keeps_its_own_reference() -> None:
    event = _event(_context())
    event.recurrence_id = generate_id()

    assert extract_urns_from_content(_event_mention(event)) == [event.urn]


def test_event_title_cannot_inject_mentions() -> None:
    event = _event(_context())
    event.title = f"Planning | [review] ]]] [[[Someone|urn:uniffy:content:USER:{generate_id()}]]]"

    result = _event_mention(event)

    assert extract_urns_from_content(result) == [event.urn]
    assert len(MENTION_PATTERN.findall(result)) == 1


async def test_shared_private_occurrence_does_not_disclose_title_or_reference() -> None:
    ctx = _context()
    event = _event(ctx)
    event.visibility = EventVisibility.PRIVATE
    event.organizer_id = generate_id()
    attendees = MagicMock()
    attendees.scalars.return_value.all.return_value = []
    ctx.session.execute = AsyncMock(return_value=attendees)
    with patch(
        "uniffy.domains.scheduling.calendar.operations.CalendarEventReader.get_events_in_range",
        new=AsyncMock(return_value=[_occurrence(event)]),
    ):
        result = await _execute_list_events(
            ctx, {"start_date": "2026-09-27", "end_date": "2026-10-04"},
        )

    assert result.success
    assert "Busy (2026-09-28 06:00 to 2026-09-28 06:30) [private]" in result.data
    assert event.title not in result.data
    assert extract_urns_from_content(result.data) == []
