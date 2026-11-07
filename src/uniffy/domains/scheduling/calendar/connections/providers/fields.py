"""Field cleaning both provider readers share: caps, link schemes and the pushed join line."""

import re
from datetime import date, datetime
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from uniffy.core.content.external_text import neutralize_external_text
from uniffy.domains.scheduling.calendar.ical.parse import (
    LOCATION_LIMIT,
    TITLE_LIMIT,
    UID_LIMIT,
    URL_LIMIT,
)
from uniffy.domains.scheduling.calendar.recurrence import resolve_event_zone

UTC = ZoneInfo("UTC")
NAME_LIMIT = 255
# A provider body can run to megabytes; far more than anyone reads in a calendar event.
DESCRIPTION_LIMIT = 100_000
_LINK_SCHEMES = frozenset({"http", "https"})
# Uniffy appends this line when it pushes an event; reading it back would stack copies.
_JOIN_LINE = re.compile(r"^Join: https?://\S+$")


def text(value: Any, limit: int | None = None) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = neutralize_external_text(value).strip()
    return cleaned[:limit] if limit else cleaned


def title(value: Any) -> str:
    return text(value, TITLE_LIMIT)


def location(value: Any) -> str:
    return text(value, LOCATION_LIMIT)


def display_name(value: Any) -> str | None:
    return text(value, NAME_LIMIT) or None


def web_link(value: Any) -> str | None:
    """Only a web address may become a join link; a javascript: or file: URL is dropped."""
    if not isinstance(value, str):
        return None
    link = value.strip()
    if not link or len(link) > URL_LIMIT or has_controls(link):
        return None
    try:
        scheme = urlsplit(link).scheme.lower()
    except ValueError:
        return None
    return link if scheme in _LINK_SCHEMES else None


def ical_uid(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    uid = value.strip()
    if not uid or len(uid) > UID_LIMIT or has_controls(uid):
        return None
    return uid


def description(value: str) -> str:
    lines = text(value[:DESCRIPTION_LIMIT]).rstrip().split("\n")
    if lines and _JOIN_LINE.match(lines[-1].strip()):
        lines.pop()
    return "\n".join(lines).rstrip()


def zone_name(value: Any) -> str:
    """The resolved zone's own name, so an unknown zone never reaches the row."""
    if not isinstance(value, str) or not value.strip():
        return "UTC"
    return resolve_event_zone(value.strip()).key


def instant(value: Any, zone: ZoneInfo = UTC) -> datetime | None:
    """An ISO 8601 timestamp as a UTC datetime; a value without an offset reads in ``zone``."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        moment = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=zone)
    return moment.astimezone(UTC)


def calendar_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError:
        return None


def utc_midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


def has_controls(value: str) -> bool:
    return any(ord(ch) < 32 or ord(ch) == 127 for ch in value)  # noqa: PLR2004 - ASCII control range
