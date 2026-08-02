"""Unit tests for the calendar event activity log.

Field edits, attendee changes and RSVP responses each land as their own entry,
occurrence ids resolve to the series master, and long or structured values are
recorded without a before/after pair.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.models.calendar.activity import EventActivity
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import AccessMode, AttendeeStatus, generate_id
from uniffy.domains.calendar.operations import (
    CalendarEventOperations,
    _activity_value,
)


def _make_event(**overrides: object) -> CalendarEvent:
    now = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)
    defaults: dict = {
        "organization_id": generate_id(),
        "organizer_id": generate_id(),
        "calendar_id": generate_id(),
        "title": "Weekly sync",
        "description": "",
        "start_time": now,
        "end_time": now + timedelta(hours=1),
        "location": "",
        "access_mode": AccessMode.OWNER_ONLY,
    }
    defaults.update(overrides)
    return CalendarEvent(**defaults)


def _make_ops() -> tuple[CalendarEventOperations, list[EventActivity]]:
    """Ops whose session records every added row so assertions read the log directly."""
    added: list[EventActivity] = []

    ops = CalendarEventOperations.__new__(CalendarEventOperations)
    ops.session = MagicMock()
    ops.session.add = added.append
    ops.session.flush = AsyncMock()

    return ops, added


class TestActivityValue:
    def test_datetime_renders_iso(self) -> None:
        moment = datetime(2026, 8, 1, 9, 30, tzinfo=UTC)
        assert _activity_value(moment) == moment.isoformat()

    def test_list_renders_comma_joined(self) -> None:
        assert _activity_value([10, 30]) == "10,30"

    def test_empty_list_is_none(self) -> None:
        assert _activity_value([]) is None

    def test_none_stays_none(self) -> None:
        assert _activity_value(None) is None

    def test_long_value_is_truncated(self) -> None:
        assert len(_activity_value("x" * 5000)) == 500


class TestLogActivity:
    async def test_records_action_and_values(self) -> None:
        ops, added = _make_ops()
        event_id = generate_id()
        actor_id = generate_id()

        await ops._log_activity(
            event_id,
            actor_id,
            "response_changed",
            field_id="status",
            previous_value="PENDING",
            new_value="ACCEPTED",
        )

        assert len(added) == 1
        entry = added[0]
        assert entry.event_id == event_id
        assert entry.actor_id == actor_id
        assert entry.action == "response_changed"
        assert entry.field_id == "status"
        assert entry.previous_value == "PENDING"
        assert entry.new_value == "ACCEPTED"

    async def test_occurrence_id_resolves_to_series_master(self) -> None:
        ops, added = _make_ops()
        master_id = generate_id()

        await ops._log_activity(f"{master_id}__occurrence__2026-08-05", generate_id(), "created")

        assert added[0].event_id == master_id


class TestLogFieldChanges:
    async def test_only_changed_fields_are_recorded(self) -> None:
        ops, added = _make_ops()
        event = _make_event()
        before = ops._activity_snapshot(event)

        event.title = "Weekly sync (moved)"

        await ops._log_field_changes(event, generate_id(), before)

        assert [(a.action, a.field_id) for a in added] == [("title_changed", "title")]
        assert added[0].previous_value == "Weekly sync"
        assert added[0].new_value == "Weekly sync (moved)"

    async def test_unchanged_event_logs_nothing(self) -> None:
        ops, added = _make_ops()
        event = _make_event()

        await ops._log_field_changes(event, generate_id(), ops._activity_snapshot(event))

        assert added == []

    async def test_start_and_end_each_get_an_entry(self) -> None:
        ops, added = _make_ops()
        event = _make_event()
        before = ops._activity_snapshot(event)

        event.start_time = event.start_time + timedelta(hours=2)
        event.end_time = event.end_time + timedelta(hours=2)

        await ops._log_field_changes(event, generate_id(), before)

        assert {a.field_id for a in added} == {"start_time", "end_time"}
        assert {a.action for a in added} == {"schedule_changed"}

    async def test_description_is_recorded_without_its_body(self) -> None:
        ops, added = _make_ops()
        event = _make_event()
        before = ops._activity_snapshot(event)

        event.description = "a very long meeting agenda " * 100

        await ops._log_field_changes(event, generate_id(), before)

        assert len(added) == 1
        assert added[0].action == "description_changed"
        assert added[0].previous_value is None
        assert added[0].new_value is None

    async def test_fields_absent_from_the_snapshot_are_skipped(self) -> None:
        """Recurrence edits diff only the explicitly requested fields."""
        ops, added = _make_ops()
        event = _make_event()

        event.title = "Renamed"
        event.location = "Room 4"

        await ops._log_field_changes(event, generate_id(), {"location": ""})

        assert [a.field_id for a in added] == ["location"]

    async def test_reminders_keep_their_values(self) -> None:
        ops, added = _make_ops()
        event = _make_event(reminders=[10])
        before = ops._activity_snapshot(event)

        event.reminders = [10, 30]

        await ops._log_field_changes(event, generate_id(), before)

        assert added[0].action == "reminders_changed"
        assert added[0].previous_value == "10"
        assert added[0].new_value == "10,30"

    async def test_snapshot_is_detached_from_the_event(self) -> None:
        """A snapshot must not alias mutable fields, or the diff sees no change."""
        ops, added = _make_ops()
        event = _make_event(reminders=[10])
        before = ops._activity_snapshot(event)

        event.reminders.append(30)

        await ops._log_field_changes(event, generate_id(), before)

        assert [a.action for a in added] == ["reminders_changed"]


class TestUpdateAttendeeStatus:
    async def _run(
        self,
        old_status: AttendeeStatus,
        new_status: AttendeeStatus,
    ) -> list[EventActivity]:
        ops, added = _make_ops()
        event = _make_event(reminders=None)
        event_id = event.id

        attendee = MagicMock()
        attendee.status = old_status

        result = MagicMock()
        result.scalar_one_or_none.return_value = attendee

        ops._fetch_by_id = AsyncMock(return_value=event)
        ops.session.execute = AsyncMock(return_value=result)
        ops.session.commit = AsyncMock()
        ops._delete_reminder_rows = AsyncMock()
        ops._create_reminder_rows = AsyncMock()

        await ops.update_attendee_status(
            user_id=event.organizer_id,
            organization_id=event.organization_id,
            event_id=event_id,
            status=new_status,
        )

        return added

    async def test_accepting_records_who_and_what(self) -> None:
        added = await self._run(AttendeeStatus.PENDING, AttendeeStatus.ACCEPTED)

        assert len(added) == 1
        assert added[0].action == "response_changed"
        assert added[0].previous_value == AttendeeStatus.PENDING.value
        assert added[0].new_value == AttendeeStatus.ACCEPTED.value

    async def test_declining_records_the_flip(self) -> None:
        added = await self._run(AttendeeStatus.ACCEPTED, AttendeeStatus.DECLINED)

        assert added[0].previous_value == AttendeeStatus.ACCEPTED.value
        assert added[0].new_value == AttendeeStatus.DECLINED.value

    async def test_resubmitting_the_same_answer_logs_nothing(self) -> None:
        assert await self._run(AttendeeStatus.ACCEPTED, AttendeeStatus.ACCEPTED) == []
