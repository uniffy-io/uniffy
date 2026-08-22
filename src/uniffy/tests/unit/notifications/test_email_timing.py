"""Timezone-aware notification email schedules."""

from datetime import UTC, datetime

from uniffy.domains.notifications.delivery.timing import next_email_delivery_at
from uniffy.domains.settings.defaults import EmailFrequency


def test_instant_email_defers_until_quiet_hours_end() -> None:
    now = datetime(2026, 8, 21, 23, 15, tzinfo=UTC)

    scheduled = next_email_delivery_at(
        EmailFrequency.INSTANT,
        {"quiet_hours_start": "22:00", "quiet_hours_end": "08:00"},
        "UTC",
        at=now,
    )

    assert scheduled == datetime(2026, 8, 22, 8, 0, tzinfo=UTC)


def test_hourly_digest_uses_the_next_utc_hour() -> None:
    scheduled = next_email_delivery_at(
        EmailFrequency.HOURLY,
        None,
        "America/New_York",
        at=datetime(2026, 8, 21, 12, 34, 56, tzinfo=UTC),
    )

    assert scheduled == datetime(2026, 8, 21, 13, 0, tzinfo=UTC)


def test_daily_digest_uses_profile_timezone_and_configured_time() -> None:
    scheduled = next_email_delivery_at(
        EmailFrequency.DAILY,
        {"email_digest_time": "09:30"},
        "America/New_York",
        at=datetime(2026, 8, 21, 12, 0, tzinfo=UTC),
    )

    assert scheduled == datetime(2026, 8, 21, 13, 30, tzinfo=UTC)


def test_daily_digest_rolls_to_the_next_local_day() -> None:
    scheduled = next_email_delivery_at(
        EmailFrequency.DAILY,
        {"email_digest_time": "08:00"},
        "Europe/Sofia",
        at=datetime(2026, 8, 21, 12, 0, tzinfo=UTC),
    )

    assert scheduled == datetime(2026, 8, 22, 5, 0, tzinfo=UTC)

