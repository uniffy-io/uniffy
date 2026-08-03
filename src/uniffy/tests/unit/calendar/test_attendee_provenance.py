"""Invited-via provenance: snapshot at insert, first group wins, direct stays bare."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.calendar.attendee import EventAttendee
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import generate_id
from uniffy.domains.calendar.operations import CalendarEventOperations

ORG = generate_id()
ACTOR = generate_id()


def _result(scalar=None, rows=None):
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    result.all = MagicMock(return_value=rows or [])
    return result


def _ops(execute_results) -> CalendarEventOperations:
    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    ops.session.add = MagicMock()
    ops.session.commit = AsyncMock()
    ops.session.refresh = AsyncMock()
    ops.session.execute = AsyncMock(side_effect=execute_results)
    return ops


async def test_user_in_two_invited_groups_keeps_the_first() -> None:
    g1, g2 = generate_id(), generate_id()
    shared, only_g2 = generate_id(), generate_id()
    ops = _ops(
        [
            _result(rows=[(g1, False), (g2, False)]),
            _result(rows=[(g1, shared), (g2, shared), (g2, only_g2)]),
            _result(rows=[(shared,), (only_g2,)]),
        ]
    )
    resolved, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [g1, g2])
    assert resolved == [shared, only_g2]
    assert invited_via == {shared: g1, only_g2: g2}


async def test_first_wins_follows_request_order_not_row_order() -> None:
    g1, g2 = generate_id(), generate_id()
    shared = generate_id()
    ops = _ops(
        [
            _result(rows=[(g1, False), (g2, False)]),
            # Roster rows arrive g2-first; the g2-before-g1 request order rules.
            _result(rows=[(g2, shared), (g1, shared)]),
            _result(rows=[(shared,)]),
        ]
    )
    _, invited_via = await ops._expand_group_attendees(ACTOR, ORG, [g2, g1])
    assert invited_via == {shared: g2}


async def test_direct_invite_beats_group_provenance() -> None:
    group_id = generate_id()
    user = generate_id()
    ops = _ops(
        [
            _result(rows=[(group_id, False)]),
            _result(rows=[(group_id, user)]),
            _result(rows=[(user,)]),
        ]
    )
    resolved, invited_via = await ops._expand_group_attendees(
        ACTOR, ORG, [user, group_id]
    )
    assert resolved == [user]
    assert invited_via == {}


async def test_add_attendees_stamps_new_rows_with_source_group() -> None:
    group_id = generate_id()
    user = generate_id()
    event = CalendarEvent(
        id=generate_id(),
        organization_id=ORG,
        organizer_id=ACTOR,
        calendar_id=generate_id(),
        title="Standup",
    )
    ops = _ops([_result(rows=[])])  # no existing attendee rows
    with (
        patch.object(
            CalendarEventOperations, "_fetch_by_id", AsyncMock(return_value=event)
        ),
        patch.object(CalendarEventOperations, "_require_edit", AsyncMock()),
        patch.object(
            CalendarEventOperations,
            "_expand_group_attendees",
            AsyncMock(return_value=([user], {user: group_id})),
        ),
        patch.object(CalendarEventOperations, "_log_activity", AsyncMock()),
        patch.object(
            CalendarEventOperations, "_refresh_search_attendees", AsyncMock()
        ),
        patch.object(
            CalendarEventOperations, "_sync_auto_created_room_members", AsyncMock()
        ),
        patch("uniffy.domains.calendar.operations.emit_notification", AsyncMock()),
    ):
        await ops.add_attendees(ACTOR, ORG, event.id, [group_id])

    added = [
        call.args[0]
        for call in ops.session.add.call_args_list
        if isinstance(call.args[0], EventAttendee)
    ]
    assert len(added) == 1
    assert added[0].user_id == user
    assert added[0].invited_via_group_id == group_id
