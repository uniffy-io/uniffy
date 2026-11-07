"""Graph patterns and Google rule lines against the Uniffy series model."""

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from uniffy.core.models.shared import DayOfWeek, RecurrencePattern
from uniffy.core.types import EventStatus
from uniffy.domains.scheduling.calendar.connections.normalize import ItemKind, ProviderEvent
from uniffy.domains.scheduling.calendar.connections.recurrence import (
    graph_pattern_to_rrule,
    reconcile_instances,
    rrule_to_graph_pattern,
    series_rule,
)

START = date(2026, 11, 10)


def _graph(pattern: dict[str, Any], bound: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "pattern": {
            "type": "daily",
            "interval": 1,
            "month": 0,
            "dayOfMonth": 0,
            "firstDayOfWeek": "sunday",
            "index": "first",
            **pattern,
        },
        "range": {
            "type": "noEnd",
            "startDate": "2026-11-10",
            "endDate": "0001-01-01",
            "recurrenceTimeZone": "UTC",
            "numberOfOccurrences": 0,
            **(bound or {}),
        },
    }


@pytest.mark.parametrize(
    ("pattern", "bound", "rule"),
    [
        ({"type": "daily", "interval": 2}, None, "FREQ=DAILY;INTERVAL=2"),
        (
            {"type": "weekly", "daysOfWeek": ["wednesday", "monday"]},
            {"type": "endDate", "endDate": "2026-12-31"},
            "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;UNTIL=20261231",
        ),
        (
            {"type": "weekly", "interval": 2, "daysOfWeek": ["tuesday"], "firstDayOfWeek": "monday"},
            None,
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=MO",
        ),
        (
            {"type": "absoluteMonthly", "dayOfMonth": 15},
            {"type": "numbered", "numberOfOccurrences": 6},
            "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15;COUNT=6",
        ),
        (
            {"type": "relativeMonthly", "daysOfWeek": ["tuesday"], "index": "second"},
            None,
            "FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU",
        ),
        (
            {"type": "relativeMonthly", "daysOfWeek": ["friday"], "index": "last"},
            None,
            "FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR",
        ),
        (
            {"type": "absoluteYearly", "month": 11, "dayOfMonth": 10},
            None,
            "FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYMONTHDAY=10",
        ),
        (
            {"type": "relativeYearly", "month": 11, "daysOfWeek": ["thursday"], "index": "fourth"},
            None,
            "FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYDAY=4TH",
        ),
    ],
)
def test_graph_patterns_round_trip(
    pattern: dict[str, Any], bound: dict[str, Any] | None, rule: str
) -> None:
    assert graph_pattern_to_rrule(_graph(pattern, bound), start_date=START) == rule

    back = rrule_to_graph_pattern(f"RRULE:{rule}", start_date=START, time_zone="Europe/Sofia")
    assert back is not None
    assert back["range"]["startDate"] == "2026-11-10"
    assert back["range"]["recurrenceTimeZone"] == "Europe/Sofia"
    assert graph_pattern_to_rrule(back, start_date=START) == rule


@pytest.mark.parametrize(
    "recurrence",
    [
        None,
        _graph({"type": "relativeMonthly", "daysOfWeek": ["monday", "friday"], "index": "first"}),
        _graph({"type": "weekly", "daysOfWeek": []}),
        _graph({"type": "absoluteMonthly", "dayOfMonth": 0}),
        _graph({"type": "hourly"}),
        _graph({"type": "daily"}, {"type": "mystery"}),
    ],
)
def test_graph_patterns_without_equivalent(recurrence: dict[str, Any] | None) -> None:
    assert graph_pattern_to_rrule(recurrence, start_date=START) is None


@pytest.mark.parametrize(
    "rule",
    [
        "FREQ=HOURLY",
        "FREQ=MONTHLY;BYMONTHDAY=30,-1;BYSETPOS=1",
        "FREQ=MONTHLY;BYDAY=1MO,3MO",
        "FREQ=MONTHLY;BYDAY=5MO",
        "FREQ=WEEKLY;BYDAY=1MO",
        "FREQ=DAILY;INTERVAL=2;BYDAY=MO",
        "FREQ=DAILY;COUNT=3;UNTIL=20261231",
        "not a rule",
    ],
)
def test_rules_graph_cannot_express(rule: str) -> None:
    assert rrule_to_graph_pattern(rule, start_date=START, time_zone="UTC") is None


def test_rule_defaults_come_from_the_start_date() -> None:
    weekly = rrule_to_graph_pattern("FREQ=WEEKLY", start_date=START, time_zone="UTC")
    monthly = rrule_to_graph_pattern("FREQ=MONTHLY", start_date=START, time_zone="UTC")
    yearly = rrule_to_graph_pattern("FREQ=YEARLY", start_date=START, time_zone="UTC")

    assert weekly is not None
    assert weekly["pattern"]["daysOfWeek"] == ["tuesday"]
    assert monthly is not None
    assert monthly["pattern"] == {"type": "absoluteMonthly", "interval": 1, "dayOfMonth": 10}
    assert yearly is not None
    assert yearly["pattern"]["month"] == 11
    assert yearly["pattern"]["dayOfMonth"] == 10


def test_weekday_daily_rule_becomes_weekly_pattern() -> None:
    graph = rrule_to_graph_pattern(
        "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", start_date=START, time_zone="UTC"
    )

    assert graph is not None
    assert graph["pattern"]["type"] == "weekly"
    assert graph["pattern"]["daysOfWeek"] == ["monday", "tuesday", "wednesday", "thursday", "friday"]


def test_until_instant_resolves_to_the_local_day() -> None:
    graph = rrule_to_graph_pattern(
        "FREQ=DAILY;UNTIL=20261231T215959Z", start_date=START, time_zone="Europe/Sofia"
    )

    assert graph is not None
    assert graph["range"] == {
        "type": "endDate",
        "startDate": "2026-11-10",
        "recurrenceTimeZone": "Europe/Sofia",
        "endDate": "2026-12-31",
    }


def _master(**overrides: Any) -> ProviderEvent:
    fields: dict[str, Any] = {
        "provider_event_id": "series",
        "kind": ItemKind.MASTER,
        "title": "Weekly planning",
        "start_time": datetime(2026, 11, 10, 7, tzinfo=UTC),
        "end_time": datetime(2026, 11, 10, 8, tzinfo=UTC),
        "timezone": "Europe/Sofia",
        "recurrence": ("RRULE:FREQ=WEEKLY;BYDAY=TU",),
    }
    fields.update(overrides)
    return ProviderEvent(**fields)


def test_series_rule_maps_rule_and_exdates() -> None:
    master = _master(
        recurrence=(
            "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T215959Z",
            "EXDATE;TZID=Europe/Sofia:20261124T090000,20261201T090000",
            "EXDATE:20261208T070000Z",
        )
    )

    result = series_rule(master)

    assert result is not None
    mapping, cancelled = result
    assert mapping.pattern == RecurrencePattern.WEEKLY
    assert mapping.config["days_of_week"] == [DayOfWeek.TUESDAY.value]
    assert cancelled == (date(2026, 11, 24), date(2026, 12, 1), date(2026, 12, 8))


def test_series_rule_all_day_exdates() -> None:
    master = _master(
        start_time=datetime(2026, 11, 12, tzinfo=UTC),
        end_time=datetime(2026, 11, 13, tzinfo=UTC),
        timezone="America/New_York",
        is_all_day=True,
        recurrence=("RRULE:FREQ=WEEKLY;BYDAY=TH", "EXDATE;VALUE=DATE:20261126"),
    )

    result = series_rule(master)

    assert result is not None
    assert result[1] == (date(2026, 11, 26),)


@pytest.mark.parametrize(
    "recurrence",
    [
        (),
        ("EXDATE:20261124T070000Z",),
        ("RRULE:FREQ=WEEKLY;BYDAY=TU", "RRULE:FREQ=MONTHLY"),
        ("RRULE:FREQ=WEEKLY;BYDAY=TU", "RDATE:20261126T070000Z"),
        ("RRULE:FREQ=WEEKLY;BYDAY=TU", "EXRULE:FREQ=MONTHLY"),
        ("X-UNSUPPORTED",),
        ("RRULE:FREQ=MONTHLY;BYDAY=2TU",),
        ("RRULE:FREQ=WEEKLY;BYDAY=TU", "EXDATE:garbage"),
    ],
)
def test_series_rule_refuses_what_must_be_mirrored(recurrence: tuple[str, ...]) -> None:
    assert series_rule(_master(recurrence=recurrence)) is None


def _instance(original: date, start: datetime, **overrides: Any) -> ProviderEvent:
    fields: dict[str, Any] = {
        "provider_event_id": f"series-{original.isoformat()}",
        "kind": ItemKind.OCCURRENCE,
        "series_id": "series",
        "original_date": original,
        "title": "Weekly planning",
        "start_time": start,
        "end_time": start + timedelta(hours=1),
        "timezone": "Europe/Sofia",
    }
    fields.update(overrides)
    return ProviderEvent(**fields)


def test_reconcile_across_the_dst_change() -> None:
    # Tuesdays 09:00 in Sofia: 06:00Z in summer time, 07:00Z after 25 October.
    master = _master(
        start_time=datetime(2026, 10, 13, 6, tzinfo=UTC),
        end_time=datetime(2026, 10, 13, 7, tzinfo=UTC),
    )
    mapping = series_rule(master)
    assert mapping is not None
    moved = _instance(date(2026, 10, 20), datetime(2026, 10, 21, 6, tzinfo=UTC))
    retitled = _instance(
        date(2026, 11, 10), datetime(2026, 11, 10, 7, tzinfo=UTC), title="Planning (long)"
    )
    instances = [
        _instance(date(2026, 10, 13), datetime(2026, 10, 13, 6, tzinfo=UTC)),
        moved,
        _instance(date(2026, 10, 27), datetime(2026, 10, 27, 7, tzinfo=UTC)),
        retitled,
    ]

    cancelled, overrides = reconcile_instances(
        master,
        mapping[0],
        instances,
        datetime(2026, 10, 12, tzinfo=UTC),
        datetime(2026, 11, 12, tzinfo=UTC),
    )

    assert cancelled == (date(2026, 11, 3),)
    assert overrides == (moved, retitled)


def test_reconcile_counts_cancelled_instances() -> None:
    master = _master()
    mapping = series_rule(master)
    assert mapping is not None
    instances = [
        _instance(date(2026, 11, 10), datetime(2026, 11, 10, 7, tzinfo=UTC)),
        _instance(
            date(2026, 11, 17),
            datetime(2026, 11, 17, 7, tzinfo=UTC),
            status=EventStatus.CANCELLED,
        ),
    ]

    cancelled, overrides = reconcile_instances(
        master,
        mapping[0],
        instances,
        datetime(2026, 11, 9, tzinfo=UTC),
        datetime(2026, 11, 20, tzinfo=UTC),
    )

    assert cancelled == (date(2026, 11, 17),)
    assert overrides == ()


def test_reconcile_all_day_series() -> None:
    master = _master(
        start_time=datetime(2026, 11, 12, tzinfo=UTC),
        end_time=datetime(2026, 11, 13, tzinfo=UTC),
        timezone="America/New_York",
        is_all_day=True,
        recurrence=("RRULE:FREQ=WEEKLY;BYDAY=TH",),
    )
    mapping = series_rule(master)
    assert mapping is not None

    def day(original: date, shown: date | None = None) -> ProviderEvent:
        shown = shown or original
        start = datetime(shown.year, shown.month, shown.day, tzinfo=UTC)
        return replace(
            _instance(original, start, timezone="America/New_York", is_all_day=True),
            end_time=start + timedelta(days=1),
        )

    moved = day(date(2026, 11, 19), date(2026, 11, 20))
    cancelled, overrides = reconcile_instances(
        master,
        mapping[0],
        [day(date(2026, 11, 12)), moved],
        datetime(2026, 11, 10, tzinfo=UTC),
        datetime(2026, 12, 1, tzinfo=UTC),
    )

    assert cancelled == (date(2026, 11, 26),)
    assert overrides == (moved,)
