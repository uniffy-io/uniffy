"""Cursor paging over accessible events: what a page costs and what it returns."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import true

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.pagination import decode_time_cursor, encode_time_cursor
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.events.queries import (
    MAX_PAGE_SIZE,
    EventQueryOperations,
)

START = datetime(2026, 9, 7, 9, tzinfo=UTC)


def _event(offset_minutes: int) -> CalendarEvent:
    start = START + timedelta(minutes=offset_minutes)
    return CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title=f"Event {offset_minutes}",
        start_time=start,
        end_time=start + timedelta(minutes=30),
    )


def _operations(rows: list[CalendarEvent]) -> EventQueryOperations:
    events = MagicMock()
    # The access filter lands in a WHERE clause, so it has to be real SQL.
    events.event_access_filter = AsyncMock(return_value=true())
    events.session.execute = AsyncMock(
        return_value=MagicMock(scalars=MagicMock(return_value=MagicMock(all=lambda: rows)))
    )
    return EventQueryOperations(events)


async def test_a_full_page_hands_back_a_cursor_for_the_next() -> None:
    rows = [_event(index * 30) for index in range(4)]
    operations = _operations(rows)

    page = await operations.list_events_page(
        generate_id(), generate_id(), page_size=3, page_token=None
    )

    assert [event.title for event in page.events] == ["Event 0", "Event 30", "Event 60"]
    assert page.next_page_token is not None
    # The cursor points at the last row handed out, not the one peeked at.
    assert decode_time_cursor(page.next_page_token) == (rows[2].start_time, rows[2].id)


async def test_a_short_page_ends_the_walk() -> None:
    operations = _operations([_event(0), _event(30)])

    page = await operations.list_events_page(generate_id(), generate_id(), page_size=10)

    assert len(page.events) == 2
    assert page.next_page_token is None


async def test_page_size_is_capped_however_much_the_caller_asks_for() -> None:
    operations = _operations([_event(index) for index in range(MAX_PAGE_SIZE + 2)])

    page = await operations.list_events_page(generate_id(), generate_id(), page_size=10_000)

    assert len(page.events) == MAX_PAGE_SIZE
    assert page.next_page_token is not None


async def test_a_tampered_cursor_is_refused() -> None:
    operations = _operations([])

    with pytest.raises(ValidationError):
        await operations.list_events_page(
            generate_id(), generate_id(), page_token="not-a-real-cursor"
        )

    operations.session.execute.assert_not_awaited()


async def test_a_cursor_round_trips_through_its_encoding() -> None:
    event_id = generate_id()

    assert decode_time_cursor(encode_time_cursor(START, event_id)) == (START, event_id)
