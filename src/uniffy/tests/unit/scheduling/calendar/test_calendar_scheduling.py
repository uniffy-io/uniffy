"""Unit tests for meeting-time suggestions across working hours and timezones."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.types import generate_id
from uniffy.domains.scheduling.calendar.availability import (
    BusyInterval,
    Suggestion,
    intersect_intervals,
    subtract_intervals,
    suggest_meeting_times,
    working_windows,
)
from uniffy.domains.settings.defaults import WORKDAY_NAMES
from uniffy.domains.settings.operations import SchedulingContext


def _dt(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 8, day, hour, minute, tzinfo=UTC)


def _ctx(
    timezone: str = "UTC",
    start: str = "09:00",
    end: str = "18:00",
    workdays: tuple[str, ...] = WORKDAY_NAMES[:5],
) -> SchedulingContext:
    return SchedulingContext(
        timezone=timezone, workday_start=start, workday_end=end, workdays=workdays
    )


def _suggest(
    required: dict[UUID, SchedulingContext],
    busy: dict[UUID, list[BusyInterval]] | None = None,
    optional: dict[UUID, SchedulingContext] | None = None,
    room_busy: list | None = None,
    window: tuple[datetime, datetime] = (_dt(3, 0), _dt(4, 0)),
    minutes: int = 30,
    **kwargs,
) -> list[Suggestion]:
    optional = optional or {}
    return suggest_meeting_times(
        busy or {},
        {**required, **optional},
        required_ids=list(required),
        optional_ids=list(optional),
        room_busy=room_busy or [],
        window_start=window[0],
        window_end=window[1],
        duration=timedelta(minutes=minutes),
        **kwargs,
    )


class TestIntervalMath:
    def test_intersect(self) -> None:
        a = [(_dt(3, 9), _dt(3, 12)), (_dt(3, 14), _dt(3, 18))]
        b = [(_dt(3, 11), _dt(3, 15))]
        assert intersect_intervals(a, b) == [(_dt(3, 11), _dt(3, 12)), (_dt(3, 14), _dt(3, 15))]

    def test_subtract(self) -> None:
        base = [(_dt(3, 9), _dt(3, 18))]
        remove = [(_dt(3, 10), _dt(3, 11)), (_dt(3, 17), _dt(3, 19))]
        assert subtract_intervals(base, remove) == [
            (_dt(3, 9), _dt(3, 10)),
            (_dt(3, 11), _dt(3, 17)),
        ]


class TestWorkingWindows:
    # 2026-08-03 is a Monday; 2026-08-08 a Saturday.

    def test_follows_the_users_own_timezone(self) -> None:
        # 09:00 Sofia (UTC+3 in August) = 06:00 UTC.
        windows = working_windows(_ctx("Europe/Sofia"), _dt(3, 0), _dt(3, 23))
        assert windows == [(_dt(3, 6), _dt(3, 15))]

    def test_workday_mask_excludes_saturday(self) -> None:
        assert working_windows(_ctx(), _dt(8, 0), _dt(8, 23)) == []
        widened = working_windows(_ctx(), _dt(8, 0), _dt(8, 23), extra_workdays=True)
        assert widened == [(_dt(8, 9), _dt(8, 18))]

    def test_custom_workdays(self) -> None:
        windows = working_windows(
            _ctx(workdays=("saturday",)), _dt(3, 0), _dt(9, 23)
        )
        assert windows == [(_dt(8, 9), _dt(8, 18))]

    def test_hour_override_replaces_stored_hours(self) -> None:
        # latest_hour=24 runs to midnight, clipped to the requested window end.
        windows = working_windows(_ctx(), _dt(3, 0), _dt(3, 23), hour_override=(7, 24))
        assert windows == [(_dt(3, 7), _dt(3, 23))]
        full_day = working_windows(_ctx(), _dt(3, 0), _dt(4, 1), hour_override=(7, 24))
        assert full_day[0] == (_dt(3, 7), _dt(4, 0))

    def test_invalid_override_rejected(self) -> None:
        with pytest.raises(ValidationError):
            working_windows(_ctx(), _dt(3, 0), _dt(3, 23), hour_override=(18, 9))


class TestSuggestMeetingTimes:
    def test_first_slot_opens_the_workday(self) -> None:
        user = generate_id()
        suggestions = _suggest({user: _ctx()})
        assert suggestions
        assert (suggestions[0].start, suggestions[0].end) == (_dt(3, 9), _dt(3, 9, 30))
        assert suggestions[0].unavailable_optional_ids == ()

    def test_busy_block_pushes_the_first_slot(self) -> None:
        user = generate_id()
        suggestions = _suggest(
            {user: _ctx()},
            busy={user: [BusyInterval(_dt(3, 9), _dt(3, 10, 15))]},
            max_results=1,
        )
        assert (suggestions[0].start, suggestions[0].end) == (_dt(3, 10, 30), _dt(3, 11))

    def test_out_of_office_blocks_like_busy(self) -> None:
        user = generate_id()
        suggestions = _suggest(
            {user: _ctx()},
            busy={user: [BusyInterval(_dt(3, 9), _dt(3, 12), out_of_office=True)]},
            max_results=1,
        )
        assert suggestions[0].start == _dt(3, 12)

    def test_three_attendees_three_timezones_intersect(self) -> None:
        # New York 9-18 = 13-22 UTC; Sofia 9-18 = 6-15 UTC; UTC 9-18.
        # The only common span is 13:00-15:00 UTC.
        ny, sofia, utc = generate_id(), generate_id(), generate_id()
        suggestions = _suggest(
            {ny: _ctx("America/New_York"), sofia: _ctx("Europe/Sofia"), utc: _ctx("UTC")},
        )
        assert suggestions
        assert all(s.start >= _dt(3, 13) and s.end <= _dt(3, 15) for s in suggestions)

    def test_required_without_common_hours_yields_nothing(self) -> None:
        # Tokyo 9-18 = 0-9 UTC; Los Angeles 9-18 = 16:00-01:00 UTC. No overlap.
        tokyo, la = generate_id(), generate_id()
        suggestions = _suggest(
            {tokyo: _ctx("Asia/Tokyo", end="17:00"), la: _ctx("America/Los_Angeles")},
        )
        assert suggestions == []

    def test_room_is_a_hard_constraint(self) -> None:
        user = generate_id()
        suggestions = _suggest(
            {user: _ctx()},
            room_busy=[(_dt(3, 9), _dt(3, 14))],
            max_results=1,
        )
        assert suggestions[0].start == _dt(3, 14)

    def test_optional_attendees_rank_but_never_block(self) -> None:
        required, optional = generate_id(), generate_id()
        # Optional is busy all morning; afternoon slots must rank first.
        suggestions = _suggest(
            {required: _ctx()},
            optional={optional: _ctx()},
            busy={optional: [BusyInterval(_dt(3, 9), _dt(3, 13))]},
            max_results=3,
        )
        assert suggestions[0].start >= _dt(3, 13)
        assert suggestions[0].unavailable_optional_ids == ()
        morning = [s for s in suggestions if s.start < _dt(3, 13)]
        assert all(s.unavailable_optional_ids == (optional,) for s in morning)

    def test_optional_outside_working_hours_counts_unavailable(self) -> None:
        required, optional = generate_id(), generate_id()
        # Optional works Sofia hours (6-15 UTC); a 16:00 UTC slot is outside them.
        suggestions = _suggest(
            {required: _ctx()},
            optional={optional: _ctx("Europe/Sofia")},
            busy={required: [BusyInterval(_dt(3, 9), _dt(3, 16))]},
            max_results=1,
        )
        assert suggestions[0].start == _dt(3, 16)
        assert suggestions[0].unavailable_optional_ids == (optional,)

    def test_non_positive_duration_rejected(self) -> None:
        with pytest.raises(ValidationError):
            _suggest({generate_id(): _ctx()}, minutes=0)

    def test_results_are_chronological_within_equal_rank(self) -> None:
        user = generate_id()
        suggestions = _suggest({user: _ctx()}, max_results=5)
        starts = [s.start for s in suggestions]
        assert starts == sorted(starts)
