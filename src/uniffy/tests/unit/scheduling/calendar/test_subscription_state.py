from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from uniffy.core.models.calendar.subscription import CalendarSubscription
from uniffy.domains.scheduling.calendar.ical.parse import parse_calendar
from uniffy.domains.scheduling.calendar.ical.sync import fingerprint
from uniffy.domains.scheduling.calendar.subscriptions.state import (
    BROKEN_AFTER_FAILURES,
    MAX_BACKOFF,
    SubscriptionState,
    next_after_failure,
    next_after_success,
    state_of,
)

NOW = datetime(2026, 11, 6, 9, 0, tzinfo=UTC)
HOUR = 60


def _row(*, failures: int = 0, succeeded: bool = True) -> CalendarSubscription:
    return CalendarSubscription(
        organization_id=uuid4(),
        owner_id=uuid4(),
        calendar_id=uuid4(),
        url_encrypted="sealed",
        url_digest="d" * 64,
        url_host="example.com",
        next_refresh_at=NOW,
        consecutive_failures=failures,
        last_success_at=NOW if succeeded else None,
    )


@pytest.mark.parametrize(
    ("failures", "succeeded", "expected"),
    [
        (0, False, SubscriptionState.PENDING),
        (0, True, SubscriptionState.HEALTHY),
        (1, True, SubscriptionState.FAILING),
        (BROKEN_AFTER_FAILURES, True, SubscriptionState.BROKEN),
    ],
)
def test_health_follows_the_failure_count(
    failures: int, succeeded: bool, expected: SubscriptionState
) -> None:
    assert state_of(_row(failures=failures, succeeded=succeeded), policy_allows=True) == expected


def test_a_paused_policy_wins_over_any_failure() -> None:
    broken = _row(failures=BROKEN_AFTER_FAILURES)

    assert state_of(broken, policy_allows=False) == SubscriptionState.PAUSED


def test_success_spreads_feeds_within_a_tenth_of_the_interval() -> None:
    ids = [UUID(int=value) for value in (0, 499, 999, 12345)]
    due = [next_after_success(NOW, HOUR, subscription_id) for subscription_id in ids]

    assert all(NOW + timedelta(minutes=HOUR) <= at < NOW + timedelta(minutes=66) for at in due)
    assert len(set(due)) == len(due)


def test_failure_backs_off_doubling_up_to_a_day() -> None:
    waits = [next_after_failure(NOW, HOUR, failures) - NOW for failures in range(1, 8)]

    assert waits[:3] == [timedelta(hours=1), timedelta(hours=2), timedelta(hours=4)]
    assert waits[-1] == MAX_BACKOFF


def test_the_fingerprint_ignores_dtstamp_but_sees_real_changes() -> None:
    def entry(stamp: str, summary: str = "Standup"):
        document = (
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\n"
            f"UID:s@example.com\r\nSUMMARY:{summary}\r\nDTSTAMP:{stamp}\r\n"
            "DTSTART:20261110T090000Z\r\nDTEND:20261110T093000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
        )
        return parse_calendar(document.encode()).events[0]

    first = entry("20261101T000000Z")

    assert fingerprint(first) == fingerprint(entry("20261106T120000Z"))
    assert fingerprint(first) != fingerprint(replace(first, title="Standup (moved)"))
    assert fingerprint(first) != fingerprint(entry("20261101T000000Z", summary="Retro"))
