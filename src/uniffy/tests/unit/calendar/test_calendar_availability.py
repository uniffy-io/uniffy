"""Unit tests for free/busy computation and meeting-slot suggestions.

Uses ``asyncio.run`` so it runs without pytest-asyncio, mirroring the rest of
the calendar unit suite.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.types import AccessMode, RecurrencePattern
from uniffy.domains.calendar.availability import (
    MAX_FREE_BUSY_USERS,
    compute_free_slots,
    get_busy_intervals,
    merge_intervals,
)


def _run(coro):
    return asyncio.run(coro)


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
        merged = merge_intervals(
            [
                (_dt(3, 9), _dt(3, 10)),
                (_dt(3, 9, 30), _dt(3, 11)),
                (_dt(3, 11), _dt(3, 12)),
            ]
        )
        assert merged == [(_dt(3, 9), _dt(3, 12))]


class TestComputeFreeSlots:
    # 2026-08-03 is a Monday.

    def test_free_week_yields_one_morning_slot_per_weekday(self) -> None:
        slots = compute_free_slots(
            [],
            _dt(3, 0),
            _dt(10, 0),
            timedelta(minutes=30),
            "UTC",
        )
        assert len(slots) == 5
        assert slots[0] == (_dt(3, 9), _dt(3, 9, 30))
        assert all(s.weekday() < 5 for s, _ in slots)

    def test_busy_block_pushes_slot_after_it(self) -> None:
        slots = compute_free_slots(
            [(_dt(3, 9), _dt(3, 10, 15))],
            _dt(3, 0),
            _dt(3, 23),
            timedelta(minutes=30),
            "UTC",
            max_results=1,
        )
        assert slots == [(_dt(3, 10, 30), _dt(3, 11))]

    def test_window_start_mid_day_aligns_to_half_hour(self) -> None:
        slots = compute_free_slots(
            [],
            _dt(3, 10, 12),
            _dt(3, 23),
            timedelta(minutes=30),
            "UTC",
            max_results=1,
        )
        assert slots == [(_dt(3, 10, 30), _dt(3, 11))]

    def test_slot_never_ends_past_latest_hour(self) -> None:
        slots = compute_free_slots(
            [(_dt(3, 9), _dt(3, 17, 45))],
            _dt(3, 0),
            _dt(3, 23),
            timedelta(minutes=30),
            "UTC",
            max_results=1,
        )
        assert slots == []

    def test_fully_busy_day_skipped(self) -> None:
        slots = compute_free_slots(
            [(_dt(3, 9), _dt(3, 18))],
            _dt(3, 0),
            _dt(4, 23),
            timedelta(minutes=30),
            "UTC",
            max_results=1,
        )
        assert slots == [(_dt(4, 9), _dt(4, 9, 30))]

    def test_weekends_excluded_by_default_and_included_on_request(self) -> None:
        # 2026-08-08 is a Saturday.
        window = (_dt(8, 0), _dt(9, 23))
        assert compute_free_slots([], *window, timedelta(minutes=30), "UTC") == []
        slots = compute_free_slots(
            [], *window, timedelta(minutes=30), "UTC", include_weekends=True
        )
        assert slots[0] == (_dt(8, 9), _dt(8, 9, 30))

    def test_working_hours_follow_timezone(self) -> None:
        # 09:00 Sofia (UTC+3 in August) = 06:00 UTC.
        slots = compute_free_slots(
            [],
            _dt(3, 0),
            _dt(3, 23),
            timedelta(minutes=30),
            "Europe/Sofia",
            max_results=1,
        )
        assert slots == [(_dt(3, 6), _dt(3, 6, 30))]

    def test_invalid_hours_rejected(self) -> None:
        with pytest.raises(ValidationError):
            compute_free_slots(
                [],
                _dt(3, 0),
                _dt(4, 0),
                timedelta(minutes=30),
                "UTC",
                earliest_hour=18,
                latest_hour=9,
            )


def _make_event(
    *,
    start: datetime,
    end: datetime,
    pattern: RecurrencePattern = RecurrencePattern.NONE,
    config: dict | None = None,
    is_all_day: bool = False,
) -> CalendarEvent:
    return CalendarEvent(
        organization_id=uuid4(),
        organizer_id=uuid4(),
        calendar_id=uuid4(),
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
    def test_bounds_rejected_before_any_query(self) -> None:
        session = MagicMock()
        too_many = [uuid4() for _ in range(MAX_FREE_BUSY_USERS + 1)]
        with pytest.raises(ValidationError):
            _run(get_busy_intervals(session, uuid4(), too_many, _dt(3, 0), _dt(4, 0)))
        with pytest.raises(ValidationError):
            _run(get_busy_intervals(session, uuid4(), [uuid4()], _dt(4, 0), _dt(3, 0)))
        with pytest.raises(ValidationError):
            _run(
                get_busy_intervals(
                    session, uuid4(), [uuid4()], _dt(1, 0), _dt(1, 0) + timedelta(days=90)
                )
            )

    def test_plain_event_clipped_and_merged(self) -> None:
        user = uuid4()
        early = _make_event(start=_dt(2, 23), end=_dt(3, 1))
        overlapping = _make_event(start=_dt(3, 0, 30), end=_dt(3, 2))
        session = _session_returning([(early, user), (overlapping, user)])
        session.execute.side_effect = [
            MagicMock(all=MagicMock(return_value=[(user,)])),
            MagicMock(all=MagicMock(return_value=[(early, user), (overlapping, user)])),
        ]

        busy = _run(get_busy_intervals(session, uuid4(), [user], _dt(3, 0), _dt(4, 0)))
        assert busy[user] == [(_dt(3, 0), _dt(3, 2))]

    def test_weekly_recurring_master_expands_into_range(self) -> None:
        user = uuid4()
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
                MagicMock(
                    scalars=MagicMock(
                        return_value=MagicMock(all=MagicMock(return_value=[]))
                    )
                ),
            ]
        )

        busy = _run(get_busy_intervals(session, uuid4(), [user], _dt(3, 0), _dt(10, 0)))
        assert (_dt(3, 9), _dt(3, 9, 30)) in busy[user]
