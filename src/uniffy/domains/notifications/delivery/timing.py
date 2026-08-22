"""Timezone-aware notification delivery schedules."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from uniffy.domains.settings.defaults import EmailFrequency, get_effective_notifications

_UTC = ZoneInfo("UTC")


def next_email_delivery_at(
    frequency: EmailFrequency,
    notification_overrides: dict[str, Any] | None,
    timezone: str | None,
    *,
    at: datetime | None = None,
) -> datetime:
    instant = _aware_utc(at)
    if frequency is EmailFrequency.INSTANT:
        return quiet_hours_end_at(notification_overrides, timezone, at=instant) or instant
    if frequency is EmailFrequency.HOURLY:
        return instant.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)

    settings = get_effective_notifications(notification_overrides)
    digest_minutes = parse_clock_minutes(settings.get("email_digest_time"))
    if digest_minutes is None:
        digest_minutes = 8 * 60
    zone = resolve_timezone(timezone)
    local = instant.astimezone(zone)
    candidate = _local_datetime(local.date(), digest_minutes, zone)
    if candidate <= local:
        candidate = _local_datetime(local.date() + timedelta(days=1), digest_minutes, zone)
    return candidate.astimezone(UTC)


def quiet_hours_end_at(
    notification_overrides: dict[str, Any] | None,
    timezone: str | None,
    *,
    at: datetime | None = None,
) -> datetime | None:
    settings = get_effective_notifications(notification_overrides)
    start_minutes = parse_clock_minutes(settings.get("quiet_hours_start"))
    end_minutes = parse_clock_minutes(settings.get("quiet_hours_end"))
    if start_minutes is None or end_minutes is None or start_minutes == end_minutes:
        return None

    zone = resolve_timezone(timezone)
    local = _aware_utc(at).astimezone(zone)
    current_minutes = local.hour * 60 + local.minute
    if start_minutes < end_minutes:
        if not start_minutes <= current_minutes < end_minutes:
            return None
        end_date = local.date()
    else:
        if current_minutes >= start_minutes:
            end_date = local.date() + timedelta(days=1)
        elif current_minutes < end_minutes:
            end_date = local.date()
        else:
            return None
    return _local_datetime(end_date, end_minutes, zone).astimezone(UTC)


def parse_clock_minutes(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) != 2:  # noqa: PLR2004 -- HH:MM boundary shape
        return None
    try:
        hour, minute = (int(part) for part in parts)
    except ValueError:
        return None
    if not 0 <= hour <= 23 or not 0 <= minute <= 59:  # noqa: PLR2004 -- clock bounds
        return None
    if value != f"{hour:02d}:{minute:02d}":
        return None
    return hour * 60 + minute


def resolve_timezone(value: str | None) -> ZoneInfo:
    if not value:
        return _UTC
    try:
        return ZoneInfo(value)
    except ValueError, ZoneInfoNotFoundError:
        return _UTC


def _aware_utc(value: datetime | None) -> datetime:
    instant = value or datetime.now(UTC)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    return instant.astimezone(UTC)


def _local_datetime(day: date, minutes: int, zone: ZoneInfo) -> datetime:
    return datetime.combine(
        day,
        time(hour=minutes // 60, minute=minutes % 60),
        tzinfo=zone,
    )
