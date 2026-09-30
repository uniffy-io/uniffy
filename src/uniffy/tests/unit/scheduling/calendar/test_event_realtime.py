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
from uniffy.domains.scheduling.calendar.events.realtime import EventRealtimePersistence
from uniffy.domains.scheduling.calendar.realtime import EventRealtimeAdapter

ADAPTER_MODULE = "uniffy.domains.scheduling.calendar.realtime"
PERSISTENCE_MODULE = "uniffy.domains.scheduling.calendar.events.realtime"


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


def _override(master: CalendarEvent, visibility: EventVisibility) -> CalendarEvent:
    override = _event(visibility)
    override.organization_id = master.organization_id
    override.recurrence_id = master.id
    return override


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
    with patch(f"{ADAPTER_MODULE}.EventContentOperations") as operations:
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


async def test_override_resolves_grants_and_attendance_on_its_own_row() -> None:
    master = _event(EventVisibility.STANDARD)
    master.recurrence_pattern = RecurrencePattern.DAILY
    override = _override(master, EventVisibility.STANDARD)
    user_id = generate_id()
    checker = MagicMock()
    with (
        patch(f"{ADAPTER_MODULE}.load_live_event", AsyncMock(side_effect=[override, master])),
        patch(f"{ADAPTER_MODULE}.EventContentOperations") as operations,
    ):
        operations.return_value._resolve_role = AsyncMock(return_value=ContentRole.EDITOR)
        operations.return_value._is_attendee = AsyncMock(return_value=False)
        session = MagicMock()
        assert (
            await EventRealtimeAdapter(MagicMock()).authorize(
                session, user_id, master.organization_id, override.id, checker=checker
            )
            == ContentRole.EDITOR
        )
        operations.assert_called_once_with(session, permission_checker=checker)
        operations.return_value._resolve_role.assert_awaited_once_with(
            user_id, master.organization_id, override
        )
        operations.return_value._is_attendee.assert_awaited_once_with(
            user_id, master.organization_id, override.id
        )


async def test_attendee_removed_from_one_occurrence_loses_that_live_doc() -> None:
    master = _event()
    master.recurrence_pattern = RecurrencePattern.DAILY
    override = _override(master, EventVisibility.PRIVATE)
    with (
        patch(f"{ADAPTER_MODULE}.load_live_event", AsyncMock(side_effect=[override, master])),
        patch(f"{ADAPTER_MODULE}.EventContentOperations") as operations,
    ):
        operations.return_value._resolve_role = AsyncMock(return_value=ContentRole.VIEWER)
        operations.return_value._is_attendee = AsyncMock(return_value=False)
        assert (
            await EventRealtimeAdapter(MagicMock()).authorize(
                MagicMock(), generate_id(), master.organization_id, override.id
            )
            is None
        )


async def test_private_master_still_gates_a_public_override() -> None:
    master = _event(EventVisibility.PRIVATE)
    master.recurrence_pattern = RecurrencePattern.DAILY
    override = _override(master, EventVisibility.STANDARD)
    with (
        patch(f"{ADAPTER_MODULE}.load_live_event", AsyncMock(side_effect=[override, master])),
        patch(f"{ADAPTER_MODULE}.EventContentOperations") as operations,
    ):
        operations.return_value._resolve_role = AsyncMock(return_value=ContentRole.VIEWER)
        operations.return_value._is_attendee = AsyncMock(return_value=False)
        assert (
            await EventRealtimeAdapter(MagicMock()).authorize(
                MagicMock(), generate_id(), master.organization_id, override.id
            )
            is None
        )


async def test_override_policy_key_is_its_master() -> None:
    master = _event()
    override = _override(master, EventVisibility.PRIVATE)
    with patch(f"{ADAPTER_MODULE}.load_live_event", AsyncMock(return_value=override)):
        assert await EventRealtimeAdapter(MagicMock()).policy_key(
            MagicMock(), override.id, master.organization_id
        ) == (ContentType.CALENDAR_EVENT, master.id)


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


@pytest.mark.parametrize("editor_known", [True, False])
async def test_render_persists_description_and_attributes_mentions(editor_known: bool) -> None:
    event = _event()
    event.outgoing_references = ["urn:uniffy:content:USER:old"]
    editor = generate_id()
    attendee = generate_id()
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            MagicMock(scalar_one_or_none=lambda: event),
            MagicMock(scalars=lambda: [attendee]),
        ]
    )
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    with (
        patch(f"{PERSISTENCE_MODULE}.EventContentOperations") as operations,
        patch(f"{PERSISTENCE_MODULE}.EventNotifications") as notifications,
    ):
        operations.return_value._index_for_search = AsyncMock()
        notifications.return_value.emit_mention_notifications = AsyncMock()
        saved = await EventRealtimePersistence(session, MagicMock()).save(
            event.organization_id,
            event.id,
            "Merged agenda",
            actor_id=editor if editor_known else None,
        )
    assert saved is event
    assert event.description == "Merged agenda"
    assert event.outgoing_references is None
    session.commit.assert_awaited_once()
    operations.return_value._index_for_search.assert_awaited_once_with(event)
    actor = editor if editor_known else event.organizer_id
    notifications.return_value.emit_mention_notifications.assert_awaited_once_with(
        event,
        actor,
        event.organization_id,
        ["urn:uniffy:content:USER:old"],
        {actor, attendee},
    )


async def test_render_of_missing_event_returns_none() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
    assert (
        await EventRealtimePersistence(session, MagicMock()).save(
            generate_id(), generate_id(), "Gone"
        )
        is None
    )
