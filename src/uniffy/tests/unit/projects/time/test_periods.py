from datetime import date
from uuid import uuid4

import pytest

from uniffy.domains.projects.time.periods import (
    period_for,
    period_lock_date,
    periods_between,
    week_start_for,
)
from uniffy.domains.projects.time.policy import PeriodType, ResolvedTimePolicy

ORG = uuid4()
THURSDAY = date(2026, 10, 22)


def _weekly(week_start: str = "monday") -> ResolvedTimePolicy:
    return ResolvedTimePolicy(organization_id=ORG, week_start=week_start)


def _monthly(start_day: int) -> ResolvedTimePolicy:
    return ResolvedTimePolicy(
        organization_id=ORG, period_type=PeriodType.MONTHLY, month_start_day=start_day
    )


@pytest.mark.parametrize(
    ("week_start", "expected_start"),
    [
        ("monday", date(2026, 10, 19)),
        ("saturday", date(2026, 10, 17)),
        ("sunday", date(2026, 10, 18)),
    ],
)
def test_week_start_for_honours_the_org_week_start(week_start: str, expected_start: date) -> None:
    assert week_start_for(THURSDAY, week_start) == expected_start


def test_week_start_is_identity_on_the_start_day() -> None:
    assert week_start_for(date(2026, 10, 19), "monday") == date(2026, 10, 19)
    assert week_start_for(date(2026, 10, 17), "saturday") == date(2026, 10, 17)


@pytest.mark.parametrize(
    ("week_start", "expected"),
    [
        ("monday", (date(2026, 10, 19), date(2026, 10, 25))),
        ("saturday", (date(2026, 10, 17), date(2026, 10, 23))),
        ("sunday", (date(2026, 10, 18), date(2026, 10, 24))),
    ],
)
def test_weekly_period_spans_seven_days(week_start: str, expected: tuple[date, date]) -> None:
    assert period_for(THURSDAY, _weekly(week_start)) == expected


@pytest.mark.parametrize(
    ("day", "start_day", "expected"),
    [
        (date(2026, 2, 10), 1, (date(2026, 2, 1), date(2026, 2, 28))),
        (date(2028, 2, 10), 1, (date(2028, 2, 1), date(2028, 2, 29))),
        (date(2026, 1, 10), 15, (date(2025, 12, 15), date(2026, 1, 14))),
        (date(2026, 1, 15), 15, (date(2026, 1, 15), date(2026, 2, 14))),
        (date(2026, 12, 31), 1, (date(2026, 12, 1), date(2026, 12, 31))),
        (date(2026, 12, 20), 28, (date(2026, 11, 28), date(2026, 12, 27))),
    ],
)
def test_monthly_period_handles_february_and_year_boundaries(
    day: date, start_day: int, expected: tuple[date, date]
) -> None:
    assert period_for(day, _monthly(start_day)) == expected


def test_periods_between_covers_the_range_in_order_without_gaps() -> None:
    periods = periods_between(date(2026, 1, 1), date(2026, 1, 31), _weekly())

    assert periods[0] == (date(2025, 12, 29), date(2026, 1, 4))
    assert periods[-1] == (date(2026, 1, 26), date(2026, 2, 1))
    assert len(periods) == 5
    for previous, following in zip(periods, periods[1:], strict=False):
        assert following[0] == previous[1].replace(day=previous[1].day) + (
            following[0] - previous[1]
        )
        assert (following[0] - previous[1]).days == 1


def test_periods_between_single_day_yields_one_period() -> None:
    assert periods_between(THURSDAY, THURSDAY, _monthly(1)) == [
        (date(2026, 10, 1), date(2026, 10, 31))
    ]


def test_period_lock_date_is_the_day_after_the_delay() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG, period_lock_delay_days=2)

    assert period_lock_date(date(2026, 10, 4), policy) == date(2026, 10, 7)
    assert period_lock_date(date(2026, 10, 4), _weekly()) == date(2026, 10, 7)
    zero_delay = ResolvedTimePolicy(organization_id=ORG, period_lock_delay_days=0)
    assert period_lock_date(date(2026, 10, 4), zero_delay) == date(2026, 10, 5)


def test_lock_due_and_previous_period_follow_the_delay() -> None:
    from uniffy.domains.projects.time.periods import period_is_lock_due, previous_period

    policy = ResolvedTimePolicy(organization_id=uuid4(), period_lock_delay_days=2)
    assert period_is_lock_due(date(2026, 10, 18), date(2026, 10, 20), policy) is False
    assert period_is_lock_due(date(2026, 10, 18), date(2026, 10, 21), policy) is True
    assert previous_period(date(2026, 10, 12), policy) == (date(2026, 10, 5), date(2026, 10, 11))
