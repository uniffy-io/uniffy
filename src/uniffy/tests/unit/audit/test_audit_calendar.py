"""Destructive-action audit emissions for calendar events.

Soft and permanent delete plus the ``calendar_event.moved`` row that
fires when an event's ``calendar_id`` shifts between calendars.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.audit.actions import Action
from uniffy.core.types import generate_id


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _build_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    return session


async def test_calendar_event_moved_payload_carries_previous_and_new_calendar() -> None:
    from uniffy.core.audit import write_audit_event

    session = _build_session()
    event_id = generate_id()
    prev_cal = generate_id()
    new_cal = generate_id()

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.CALENDAR_EVENT_MOVED,
        resource_type="CALENDAR_EVENT",
        resource_id=event_id,
        details={
            "previous_calendar_id": str(prev_cal),
            "new_calendar_id": str(new_cal),
        },
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].action == Action.CALENDAR_EVENT_MOVED
    assert rows[0].details["previous_calendar_id"] == str(prev_cal)
    assert rows[0].details["new_calendar_id"] == str(new_cal)


async def test_calendar_event_deleted_records_title_and_start_time() -> None:
    from uniffy.core.audit import write_audit_event

    session = _build_session()
    event_id = generate_id()
    start = datetime(2026, 6, 1, 14, 0, tzinfo=UTC)

    await write_audit_event(
        session,
        organization_id=generate_id(),
        actor_user_id=generate_id(),
        action=Action.CALENDAR_EVENT_DELETED,
        resource_type="CALENDAR_EVENT",
        resource_id=event_id,
        details={"title": "Standup", "start_time": start.isoformat()},
    )

    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].details["title"] == "Standup"
    assert rows[0].details["start_time"] == start.isoformat()
