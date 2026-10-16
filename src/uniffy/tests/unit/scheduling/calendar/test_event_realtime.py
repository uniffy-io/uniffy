from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pycrdt
import pytest

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.realtime.adapter import RealtimeRenderSuperseded
from uniffy.core.types import EventVisibility, RecurrencePattern, generate_id
from uniffy.domains.scheduling.calendar.events.realtime import EventRealtimePersistence
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter


def _event(visibility: EventVisibility = EventVisibility.PRIVATE) -> CalendarEvent:
    now = datetime.now(UTC)
    return CalendarEvent(
        id=generate_id(),
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Private agenda",
        description="Agenda",
        visibility=visibility,
        start_time=now,
        end_time=now + timedelta(hours=1),
    )


async def test_recurring_master_cannot_bypass_scope_selection() -> None:
    event = _event()
    event.recurrence_pattern = RecurrencePattern.DAILY
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: event))
    assert (
        await EventRealtimeAdapter(MagicMock()).authorize(
            session, event.organizer_id, event.organization_id, event.id
        )
        is None
    )


async def test_hydration_and_external_replacement() -> None:
    event = _event()
    adapter = EventRealtimeAdapter(MagicMock())
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: event))
    doc = pycrdt.Doc()
    await adapter.hydrate_ydoc(session, doc, event.id, event.organization_id)
    assert str(doc.get("markdown", type=pycrdt.Text)) == "Agenda"
    assert adapter.apply_external_content(doc, "Merged agenda")
    assert not adapter.apply_external_content(doc, "Merged agenda")


async def test_render_of_missing_event_returns_none() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    assert (
        await EventRealtimePersistence(session, MagicMock()).save(
            generate_id(), generate_id(), "Gone"
        )
        is None
    )


async def test_render_refuses_to_overwrite_a_later_plain_write() -> None:
    event = _event()
    event.updated_at = datetime.now(UTC)
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: event))
    session.commit = AsyncMock()
    session.flush = AsyncMock()
    with pytest.raises(RealtimeRenderSuperseded):
        await EventRealtimePersistence(session, MagicMock()).save(
            event.organization_id,
            event.id,
            "Stale live agenda",
            supersede_after=event.updated_at - timedelta(seconds=5),
        )
    session.commit.assert_not_awaited()
    assert event.description == "Agenda"
