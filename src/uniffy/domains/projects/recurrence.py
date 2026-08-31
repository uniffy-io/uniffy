"""Task recurrence; reuses the calendar domain's date generation logic."""

from datetime import date, timedelta
from typing import Any

from uniffy.core.json_codec import JSONDecodeError, dumps_str, loads
from uniffy.core.models.shared import RecurrencePattern
from uniffy.domains.scheduling.calendar.recurrence import _generate_occurrence_dates


def parse_recurrence_config(recurrence_rule: str | None) -> dict[str, Any] | None:
    if not recurrence_rule:
        return None
    try:
        config = loads(recurrence_rule)
        if not isinstance(config, dict) or "pattern" not in config:  # noqa: PLR2004
            return None
        return config
    except JSONDecodeError, TypeError:
        return None


def serialize_recurrence_config(config: dict[str, Any]) -> str:
    return dumps_str(config)


def compute_next_occurrence(due_date: str, config: dict[str, Any]) -> str | None:
    """Return the next occurrence ISO date, or None if the series has ended."""
    pattern_str = config.get("pattern", "none").upper()
    try:
        pattern = RecurrencePattern(pattern_str)
    except ValueError:
        return None

    if pattern == RecurrencePattern.NONE:
        return None

    interval = max(1, config.get("interval", 1))

    end_date_str = config.get("end_date")
    try:
        end_date_val = date.fromisoformat(end_date_str) if end_date_str else None
    except ValueError, TypeError:
        end_date_val = None

    max_occ = config.get("max_occurrences")
    created = config.get("occurrences_created", 1)

    if max_occ and created >= max_occ:
        return None

    try:
        current = date.fromisoformat(due_date)
    except ValueError, TypeError:
        return None

    if end_date_val and current >= end_date_val:
        return None

    search_end = current + timedelta(days=730)
    dates = _generate_occurrence_dates(
        event_start_date=current,
        pattern=pattern,
        interval=interval,
        days_of_week=config.get("days_of_week"),
        day_of_month=config.get("day_of_month"),
        end_date=end_date_val,
        max_occurrences=None,
        range_start=current + timedelta(days=1),
        range_end=search_end,
    )

    if not dates:
        return None

    return dates[0].isoformat()
