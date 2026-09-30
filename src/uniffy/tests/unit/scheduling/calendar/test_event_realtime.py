from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest

from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import (
    ContentRole,
    ContentType,
    EventVisibility,
    RecurrencePattern,
    generate_id,
)
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter


def _event() -> CalendarEvent:
    now = datetime.now(UTC)
    return CalendarEvent(
        id=generate_id(),
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Private agenda",
        description="Agenda",
        visibility=EventVisibility.PRIVATE,
        start_time=now,
        end_time=now + timedelta(hours=1),
    )


@pytest.mark.parametrize(
    ("role", "attendee", "allowed"),
    [
        (ContentRole.VIEWER, False, False),
        (ContentRole.VIEWER, True, True),
        (ContentRole.EDITOR, False, True),
        (ContentRole.OWNER, False, True),
        (None, True, False),
    ],
)
async def test_private_details_require_attendance_or_editor_role(role, attendee, allowed) -> None:
    event = _event()
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: event))
    with patch("uniffy.domains.scheduling.calendar.realtime.EventContentOperations") as operations:
        operations.return_value._resolve_role = AsyncMock(return_value=role)
        operations.return_value._is_attendee = AsyncMock(return_value=attendee)
        result = await EventRealtimeAdapter(MagicMock()).authorize(
            session, generate_id(), event.organization_id, event.id
        )
    assert result == (role if allowed else None)


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


async def test_override_uses_master_policy() -> None:
    master = _event()
    master.recurrence_pattern = RecurrencePattern.DAILY
    override = _event()
    override.organization_id = master.organization_id
    override.recurrence_id = master.id
    adapter = EventRealtimeAdapter(MagicMock())
    adapter._load = AsyncMock(side_effect=[override, master, override])
    with patch("uniffy.domains.scheduling.calendar.realtime.EventContentOperations") as operations:
        operations.return_value._resolve_role = AsyncMock(return_value=ContentRole.EDITOR)
        operations.return_value._is_attendee = AsyncMock(return_value=False)
        user_id = generate_id()
        assert (
            await adapter.authorize(MagicMock(), user_id, master.organization_id, override.id)
            == ContentRole.EDITOR
        )
        operations.return_value._resolve_role.assert_awaited_once_with(
            user_id, master.organization_id, master
        )
        assert await adapter.policy_key(MagicMock(), override.id, master.organization_id) == (
            ContentType.CALENDAR_EVENT,
            master.id,
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
