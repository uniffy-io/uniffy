"""Unit tests for free/busy computation."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import AccessMode, RecurrencePattern, generate_id
from uniffy.domains.calendar.availability import (
    MAX_FREE_BUSY_USERS,
    BusyInterval,
    get_busy_intervals,
    merge_intervals,
    occupancy,
)


def _dt(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, day, hour, minute, tzinfo=UTC)


class TestMergeIntervals:
    def test_empty(self) -> None:
        assert merge_intervals([]) == []

    def test_disjoint_sorted(self) -> None:
        a = (_dt(3, 9), _dt(3, 10))
        b = (_dt(3, 11), _dt(3, 12))
        assert merge_intervals([b, a]) == [a, b]

    def test_overlap_and_touching_merge(self) -> None:
        merged = merge_intervals([
            (_dt(3, 9), _dt(3, 10)),
            (_dt(3, 9, 30), _dt(3, 11)),
            (_dt(3, 11), _dt(3, 12)),
        ])
        assert merged == [(_dt(3, 9), _dt(3, 12))]


class TestOccupancy:
    def test_flattens_across_kinds(self) -> None:
        merged = occupancy([
            BusyInterval(_dt(3, 9), _dt(3, 10)),
            BusyInterval(_dt(3, 9, 30), _dt(3, 11), out_of_office=True),
        ])
        assert merged == [(_dt(3, 9), _dt(3, 11))]


def _make_event(
    *,
    start: datetime,
    end: datetime,
    pattern: RecurrencePattern = RecurrencePattern.NONE,
    config: dict | None = None,
    is_all_day: bool = False,
) -> CalendarEvent:
    return CalendarEvent(
        organization_id=generate_id(),
        organizer_id=generate_id(),
        calendar_id=generate_id(),
        title="Busy",
        start_time=start,
        end_time=end,
        access_mode=AccessMode.OWNER_ONLY,
        recurrence_pattern=pattern,
        recurrence_config=config,
        is_all_day=is_all_day,
    )


def _session_returning(rows: list, exception_rows: list | None = None) -> MagicMock:
    """Session whose execute answers membership, event join, then exceptions."""
    session = MagicMock()
    membership = MagicMock()
    membership.all = MagicMock()
    events = MagicMock()
    events.all = MagicMock(return_value=rows)
    exceptions = MagicMock()
    exceptions.scalars = MagicMock(
        return_value=MagicMock(all=MagicMock(return_value=exception_rows or []))
    )
    session.execute = AsyncMock(side_effect=[membership, events, exceptions])
    return session


class TestGetBusyIntervals:
    async def test_bounds_rejected_before_any_query(self) -> None:
        session = MagicMock()
        too_many = [generate_id() for _ in range(MAX_FREE_BUSY_USERS + 1)]
        with pytest.raises(ValidationError):
            await get_busy_intervals(session, generate_id(), too_many, _dt(3, 0), _dt(4, 0))
        with pytest.raises(ValidationError):
            await get_busy_intervals(session, generate_id(), [generate_id()], _dt(4, 0), _dt(3, 0))
        with pytest.raises(ValidationError):
            await get_busy_intervals(
                session, generate_id(), [generate_id()], _dt(1, 0), _dt(1, 0) + timedelta(days=90)
            )

    async def test_plain_event_clipped_and_merged(self) -> None:
        user = generate_id()
        early = _make_event(start=_dt(2, 23), end=_dt(3, 1))
        overlapping = _make_event(start=_dt(3, 0, 30), end=_dt(3, 2))
        session = _session_returning([(early, user), (overlapping, user)])
        session.execute.side_effect = [
            MagicMock(all=MagicMock(return_value=[(user,)])),
            MagicMock(all=MagicMock(return_value=[(early, user), (overlapping, user)])),
        ]

        busy = await get_busy_intervals(session, generate_id(), [user], _dt(3, 0), _dt(4, 0))
        assert busy[user] == [BusyInterval(_dt(3, 0), _dt(3, 2))]

    async def test_out_of_office_events_come_back_flagged(self) -> None:
        user = generate_id()
        ooo = _make_event(start=_dt(3, 9), end=_dt(3, 17))
        ooo.is_out_of_office = True
        session = MagicMock()
        session.execute = AsyncMock(
            side_effect=[
                MagicMock(all=MagicMock(return_value=[(user,)])),
                MagicMock(all=MagicMock(return_value=[(ooo, user)])),
            ]
        )

        busy = await get_busy_intervals(session, generate_id(), [user], _dt(3, 0), _dt(4, 0))
        assert busy[user] == [BusyInterval(_dt(3, 9), _dt(3, 17), out_of_office=True)]

    async def test_weekly_recurring_master_expands_into_range(self) -> None:
        user = generate_id()
        master = _make_event(
            start=datetime(2026, 7, 6, 9, tzinfo=UTC),
            end=datetime(2026, 7, 6, 9, 30, tzinfo=UTC),
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 1, "days_of_week": ["MONDAY"]},
        )
        session = MagicMock()
        session.execute = AsyncMock(
            side_effect=[
                MagicMock(all=MagicMock(return_value=[(user,)])),
                MagicMock(all=MagicMock(return_value=[(master, user)])),
                MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))),
            ]
        )

        busy = await get_busy_intervals(session, generate_id(), [user], _dt(3, 0), _dt(10, 0))
        assert BusyInterval(_dt(3, 9), _dt(3, 9, 30)) in busy[user]
