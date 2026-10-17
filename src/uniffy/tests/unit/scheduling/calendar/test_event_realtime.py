from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pycrdt

from uniffy.core.models.calendar.event import CalendarEvent
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


async def test_hydration_seeds_the_description() -> None:
    event = _event()
    adapter = EventRealtimeAdapter(MagicMock())
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: event))
    doc = pycrdt.Doc()
    await adapter.hydrate_ydoc(session, doc, event.id, event.organization_id)
    assert str(doc.get("markdown", type=pycrdt.Text)) == "Agenda"


async def test_render_of_missing_event_returns_none() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    assert (
        await EventRealtimePersistence(session, MagicMock()).stage_save(
            generate_id(), generate_id(), "Gone"
        )
        is None
    )
