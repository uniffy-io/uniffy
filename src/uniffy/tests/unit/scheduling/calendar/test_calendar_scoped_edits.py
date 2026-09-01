"""Occurrence-scoped event edits refuse fields they cannot honor.

A scoped save that silently drops part of the request taught users the app
was unreliable; the operation now refuses instead, and routes the fields a
scope CAN honor (reminders on both scopes, the recurrence rule on
"this and following") to the scoped editors.
"""

from datetime import date

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import RecurrenceEditScope, generate_id
from uniffy.domains.scheduling.calendar.operations import CalendarEventOperations

from unittest.mock import AsyncMock

OCCURRENCE = date(2026, 3, 10)


def _ops() -> CalendarEventOperations:
    return CalendarEventOperations.__new__(CalendarEventOperations)


async def _scoped_update(ops: CalendarEventOperations, scope: RecurrenceEditScope, **kwargs):
    return await ops.update(
        user_id=generate_id(),
        organization_id=generate_id(),
        event_id=generate_id(),
        recurrence_edit_scope=scope,
        occurrence_date=OCCURRENCE,
        call_lifecycle=AsyncMock(),
        **kwargs,
    )


class TestScopedRefusals:
    async def test_series_level_fields_are_refused_for_a_single_occurrence(self) -> None:
        with pytest.raises(ValidationError) as exc:
            await _scoped_update(
                _ops(),
                RecurrenceEditScope.THIS_EVENT,
                tag_ids=[generate_id()],
                attendee_ids=[generate_id()],
                channel_id=str(generate_id()),
            )

        message = str(exc.value)
        assert "attendee_ids" in message
        assert "channel_id" in message
        assert "tag_ids" in message

    async def test_recurrence_rule_is_refused_for_a_single_occurrence(self) -> None:
        with pytest.raises(ValidationError) as exc:
            await _scoped_update(
                _ops(),
                RecurrenceEditScope.THIS_EVENT,
                recurrence_config={"pattern": "WEEKLY", "interval": 1},
            )

        assert "recurrence_config" in str(exc.value)

    async def test_clearing_a_room_cannot_be_scoped(self) -> None:
        with pytest.raises(ValidationError) as exc:
            await _scoped_update(_ops(), RecurrenceEditScope.THIS_AND_FOLLOWING, room_id="")

        assert "room_id" in str(exc.value)

    async def test_refusal_happens_before_any_scoped_write(self) -> None:
        ops = _ops()
        ops.edit_single_occurrence = AsyncMock()
        ops.edit_this_and_following = AsyncMock()

        with pytest.raises(ValidationError):
            await _scoped_update(ops, RecurrenceEditScope.THIS_EVENT, calendar_id=generate_id())

        ops.edit_single_occurrence.assert_not_awaited()
        ops.edit_this_and_following.assert_not_awaited()


class TestScopedRouting:
    async def test_reminders_reach_the_single_occurrence_editor(self) -> None:
        ops = _ops()
        ops.edit_single_occurrence = AsyncMock(return_value="override")

        result = await _scoped_update(
            ops, RecurrenceEditScope.THIS_EVENT, title="Standup", reminders=[10, 30]
        )

        assert result == "override"
        kwargs = ops.edit_single_occurrence.await_args.kwargs
        assert kwargs["title"] == "Standup"
        assert kwargs["reminders"] == [10, 30]

    async def test_recurrence_rule_reaches_the_series_split(self) -> None:
        ops = _ops()
        ops.edit_this_and_following = AsyncMock(return_value="new-series")
        new_rule = {"pattern": "WEEKLY", "interval": 2}

        result = await _scoped_update(
            ops, RecurrenceEditScope.THIS_AND_FOLLOWING, recurrence_config=new_rule
        )

        assert result == "new-series"
        assert ops.edit_this_and_following.await_args.kwargs["recurrence_config"] == new_rule
