"""RRULE mapping: equivalence with an independent RFC 5545 engine in both
directions, and refusal of the rules the in-house vocabulary cannot express."""

from datetime import date, datetime, timedelta

import pytest
from dateutil.rrule import rrulestr

from uniffy.core.models.shared import DayOfWeek, RecurrencePattern
from uniffy.domains.scheduling.calendar.ical.rrule import (
    RecurrenceMapping,
    RecurrenceRejection,
    UnsupportedRule,
    config_to_rrule,
    rrule_to_config,
)
from uniffy.domains.scheduling.calendar.recurrence import _generate_occurrence_dates

MONDAY = DayOfWeek.MONDAY.value
TUESDAY = DayOfWeek.TUESDAY.value
WEDNESDAY = DayOfWeek.WEDNESDAY.value
FRIDAY = DayOfWeek.FRIDAY.value

HORIZON_DAYS = 800


def _our_dates(
    start: date,
    pattern: RecurrencePattern,
    config: dict,
    horizon: date,
) -> list[date]:
    return _generate_occurrence_dates(
        event_start_date=start,
        pattern=pattern,
        interval=max(1, config.get("interval", 1)),
        days_of_week=config.get("days_of_week"),
        day_of_month=config.get("day_of_month"),
        end_date=None,
        max_occurrences=config.get("max_occurrences"),
        range_start=start,
        range_end=horizon,
    )


def _rfc_dates(rrule: str, start: date, horizon: date) -> list[date]:
    """Expand the emitted rule with dateutil, which owes nothing to our expander."""
    rule = rrulestr(f"RRULE:{rrule}", dtstart=datetime(start.year, start.month, start.day))
    return [
        moment.date()
        for moment in rule.between(
            datetime(start.year, start.month, start.day),
            datetime(horizon.year, horizon.month, horizon.day),
            inc=True,
        )
    ]


def _scenarios() -> list[tuple[str, date, RecurrencePattern, dict]]:
    jan_first = date(2026, 1, 1)
    mid_month = date(2026, 3, 18)
    cases: list[tuple[str, date, RecurrencePattern, dict]] = []

    for interval in (1, 2, 5):
        cases.append((f"daily-{interval}", mid_month, RecurrencePattern.DAILY, {
            "interval": interval,
        }))
    cases.append(("daily-weekday-filter", mid_month, RecurrencePattern.DAILY, {
        "interval": 1,
        "days_of_week": [MONDAY, WEDNESDAY, FRIDAY],
    }))

    for interval in (1, 2, 3):
        cases.append((f"weekly-{interval}", mid_month, RecurrencePattern.WEEKLY, {
            "interval": interval,
            "days_of_week": [TUESDAY],
        }))
    cases.append(("weekly-multi-day", mid_month, RecurrencePattern.WEEKLY, {
        "interval": 1,
        "days_of_week": [MONDAY, WEDNESDAY, FRIDAY],
    }))
    cases.append(("weekly-implicit-day", mid_month, RecurrencePattern.WEEKLY, {"interval": 1}))
    cases.append(("biweekly", mid_month, RecurrencePattern.BIWEEKLY, {
        "interval": 1,
        "days_of_week": [WEDNESDAY],
    }))

    # Every day-of-month, so the clamped 29th/30th/31st are covered against a
    # February in the window rather than only in principle.
    for day in (1, 15, 28, 29, 30, 31):
        cases.append((f"monthly-day-{day}", jan_first, RecurrencePattern.MONTHLY, {
            "interval": 1,
            "day_of_month": day,
        }))
    cases.append(("monthly-interval", jan_first, RecurrencePattern.MONTHLY, {
        "interval": 3,
        "day_of_month": 10,
    }))

    cases.append(("yearly", date(2024, 2, 29), RecurrencePattern.YEARLY, {"interval": 1}))
    cases.append(("yearly-interval", jan_first, RecurrencePattern.YEARLY, {"interval": 2}))

    cases.append(("counted", mid_month, RecurrencePattern.DAILY, {
        "interval": 2,
        "max_occurrences": 9,
    }))
    cases.append(("counted-weekly", mid_month, RecurrencePattern.WEEKLY, {
        "interval": 1,
        "days_of_week": [MONDAY, FRIDAY],
        "max_occurrences": 7,
    }))

    return cases


@pytest.mark.parametrize(("name", "start", "pattern", "config"), _scenarios())
def test_emitted_rule_expands_the_way_the_expander_does(
    name: str, start: date, pattern: RecurrencePattern, config: dict
) -> None:
    horizon = start + timedelta(days=HORIZON_DAYS)
    rrule = config_to_rrule(pattern=pattern, config=config, timezone="UTC", start_date=start)
    assert rrule is not None

    assert _rfc_dates(rrule, start, horizon) == _our_dates(start, pattern, config, horizon)


@pytest.mark.parametrize(("name", "start", "pattern", "config"), _scenarios())
def test_rule_round_trips_back_to_an_equivalent_series(
    name: str, start: date, pattern: RecurrencePattern, config: dict
) -> None:
    """The stored shape may differ - BIWEEKLY returns as weekly with a doubled
    interval - so equivalence is asserted on the dates, not on the config.
    """
    horizon = start + timedelta(days=HORIZON_DAYS)
    rrule = config_to_rrule(pattern=pattern, config=config, timezone="UTC", start_date=start)
    assert rrule is not None

    mapped = rrule_to_config(rrule, dtstart=start)
    assert isinstance(mapped, RecurrenceMapping)

    assert _our_dates(start, mapped.pattern, mapped.config, horizon) == _our_dates(
        start, pattern, config, horizon
    )


class TestEmission:
    def test_biweekly_doubles_the_interval(self) -> None:
        rrule = config_to_rrule(
            pattern=RecurrencePattern.BIWEEKLY,
            config={"interval": 1, "days_of_week": [WEDNESDAY]},
            timezone="UTC",
            start_date=date(2026, 3, 18),
        )
        assert "FREQ=WEEKLY" in rrule
        assert "INTERVAL=2" in rrule

    def test_interval_above_one_states_the_week_start(self) -> None:
        """The expander anchors weeks to Monday; a client defaulting to Sunday
        would otherwise land on different weeks."""
        rrule = config_to_rrule(
            pattern=RecurrencePattern.WEEKLY,
            config={"interval": 2, "days_of_week": [MONDAY]},
            timezone="UTC",
            start_date=date(2026, 3, 16),
        )
        assert "WKST=MO" in rrule

    def test_last_day_series_uses_the_negative_month_day(self) -> None:
        rrule = config_to_rrule(
            pattern=RecurrencePattern.MONTHLY,
            config={"interval": 1, "day_of_month": 31},
            timezone="UTC",
            start_date=date(2026, 1, 31),
        )
        assert "BYMONTHDAY=-1" in rrule

    @pytest.mark.parametrize("day", [29, 30])
    def test_clamped_day_keeps_february(self, day: int) -> None:
        """A bare BYMONTHDAY=30 skips February outright, where the expander
        pulls the occurrence back to the last day."""
        start = date(2026, 1, day)
        config = {"interval": 1, "day_of_month": day}
        rrule = config_to_rrule(
            pattern=RecurrencePattern.MONTHLY, config=config, timezone="UTC", start_date=start
        )
        horizon = date(2026, 12, 31)

        emitted = _rfc_dates(rrule, start, horizon)

        assert any(occ.month == 2 for occ in emitted)  # noqa: PLR2004
        assert emitted == _our_dates(start, RecurrencePattern.MONTHLY, config, horizon)

    def test_leap_day_series_still_recurs_in_common_years(self) -> None:
        """RFC 5545 recurs a February 29 start in leap years alone; the expander
        clamps it to the 28th, so the emitted rule has to say so."""
        start = date(2024, 2, 29)
        config = {"interval": 1}
        rrule = config_to_rrule(
            pattern=RecurrencePattern.YEARLY, config=config, timezone="UTC", start_date=start
        )
        horizon = date(2028, 12, 31)

        emitted = _rfc_dates(rrule, start, horizon)

        assert date(2025, 2, 28) in emitted
        assert date(2028, 2, 29) in emitted
        assert emitted == _our_dates(start, RecurrencePattern.YEARLY, config, horizon)

    def test_an_ordinary_yearly_series_needs_no_by_parts(self) -> None:
        rrule = config_to_rrule(
            pattern=RecurrencePattern.YEARLY,
            config={"interval": 1},
            timezone="UTC",
            start_date=date(2026, 6, 10),
        )
        assert rrule == "FREQ=YEARLY"

    def test_end_date_becomes_a_utc_until(self) -> None:
        rrule = config_to_rrule(
            pattern=RecurrencePattern.DAILY,
            config={"interval": 1, "end_date": "2026-04-10T00:00:00+00:00"},
            timezone="UTC",
            start_date=date(2026, 4, 1),
        )
        assert "UNTIL=20260410T235959Z" in rrule

    def test_both_bounds_resolve_to_the_one_that_binds_first(self) -> None:
        """RFC 5545 forbids carrying COUNT and UNTIL together, so the export
        states the count the expander itself would reach."""
        rrule = config_to_rrule(
            pattern=RecurrencePattern.DAILY,
            config={
                "interval": 1,
                "max_occurrences": 100,
                "end_date": "2026-04-05T00:00:00+00:00",
            },
            timezone="UTC",
            start_date=date(2026, 4, 1),
        )
        assert "COUNT=5" in rrule
        assert "UNTIL" not in rrule

    def test_a_non_repeating_event_has_no_rule(self) -> None:
        assert (
            config_to_rrule(
                pattern=RecurrencePattern.NONE,
                config=None,
                timezone="UTC",
                start_date=date(2026, 4, 1),
            )
            is None
        )


class TestRejection:
    @pytest.mark.parametrize(
        ("rrule", "expected"),
        [
            ("INTERVAL=1", RecurrenceRejection.MISSING_FREQUENCY),
            ("FREQ=HOURLY", RecurrenceRejection.UNSUPPORTED_FREQUENCY),
            ("FREQ=MINUTELY", RecurrenceRejection.UNSUPPORTED_FREQUENCY),
            ("FREQ=DAILY;COUNT=3;UNTIL=20260410T000000Z", RecurrenceRejection.COUNT_AND_UNTIL),
            ("FREQ=MONTHLY;BYDAY=3TU", RecurrenceRejection.MONTHLY_BY_WEEKDAY),
            ("FREQ=WEEKLY;BYDAY=2MO", RecurrenceRejection.ORDINAL_WEEKDAY),
            ("FREQ=MONTHLY;BYMONTHDAY=1,15", RecurrenceRejection.MULTIPLE_MONTH_DAYS),
            ("FREQ=YEARLY;BYWEEKNO=20", RecurrenceRejection.UNSUPPORTED_PART),
            ("FREQ=DAILY;BYYEARDAY=100", RecurrenceRejection.UNSUPPORTED_PART),
            ("FREQ=MONTHLY;BYMONTH=3;BYMONTHDAY=1", RecurrenceRejection.UNSUPPORTED_PART),
        ],
    )
    def test_unsupported_rules_are_refused_with_a_reason(
        self, rrule: str, expected: RecurrenceRejection
    ) -> None:
        result = rrule_to_config(rrule, dtstart=date(2026, 3, 18))

        assert isinstance(result, UnsupportedRule)
        assert result.rejection is expected
        assert result.message

    def test_every_rejection_carries_a_human_message(self) -> None:
        for rejection in RecurrenceRejection:
            assert UnsupportedRule(rejection).message


class TestImport:
    def test_negative_month_day_reads_back_as_the_clamped_last_day(self) -> None:
        mapped = rrule_to_config("FREQ=MONTHLY;BYMONTHDAY=-1", dtstart=date(2026, 1, 31))

        assert isinstance(mapped, RecurrenceMapping)
        assert mapped.config["day_of_month"] == 31  # noqa: PLR2004

    def test_monthly_without_a_month_day_takes_the_start_day(self) -> None:
        mapped = rrule_to_config("FREQ=MONTHLY", dtstart=date(2026, 1, 12))

        assert isinstance(mapped, RecurrenceMapping)
        assert mapped.config["day_of_month"] == 12  # noqa: PLR2004

    def test_until_lands_in_the_config_as_an_instant(self) -> None:
        mapped = rrule_to_config("FREQ=DAILY;UNTIL=20260410T235959Z", dtstart=date(2026, 4, 1))

        assert isinstance(mapped, RecurrenceMapping)
        assert mapped.config["end_date"].startswith("2026-04-10T23:59:59")

    def test_yearly_by_parts_restating_the_start_are_accepted(self) -> None:
        mapped = rrule_to_config(
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29,-1;BYSETPOS=1", dtstart=date(2024, 2, 29)
        )

        assert isinstance(mapped, RecurrenceMapping)
        assert mapped.pattern is RecurrencePattern.YEARLY

    def test_yearly_moved_off_its_start_month_is_refused(self) -> None:
        """Nothing in the vocabulary expresses a yearly series on a month other
        than the one its start sits in."""
        result = rrule_to_config("FREQ=YEARLY;BYMONTH=7", dtstart=date(2026, 2, 10))

        assert isinstance(result, UnsupportedRule)
        assert result.rejection is RecurrenceRejection.UNSUPPORTED_PART

    def test_weekly_days_map_back_to_the_in_house_names(self) -> None:
        mapped = rrule_to_config("FREQ=WEEKLY;BYDAY=MO,FR", dtstart=date(2026, 3, 16))

        assert isinstance(mapped, RecurrenceMapping)
        assert mapped.config["days_of_week"] == [MONDAY, FRIDAY]
