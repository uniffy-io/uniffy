"""
Task recurrence computation.

Provides functions to parse, serialize, and compute next occurrence dates
for recurring tasks. Reuses the calendar domain's date generation logic.
"""

import json
from datetime import date, timedelta
from typing import Any

from uniffy.core.models.shared import RecurrencePattern
from uniffy.domains.calendar.recurrence import _generate_occurrence_dates


def parse_recurrence_config(recurrence_rule: str | None) -> dict[str, Any] | None:
    """
    Parse a recurrence rule JSON string into a config dict.

    Parameters
    ----------
    recurrence_rule : str | None
        JSON string stored in Task.recurrence_rule.

    Returns
    -------
    dict | None
        Parsed config or None if invalid/empty.

    """
    if not recurrence_rule:
        return None
    try:
        config = json.loads(recurrence_rule)
        if not isinstance(config, dict) or "pattern" not in config:
            return None
        return config
    except (json.JSONDecodeError, TypeError):
        return None


def serialize_recurrence_config(config: dict[str, Any]) -> str:
    """
    Serialize a recurrence config dict to a JSON string.

    Parameters
    ----------
    config : dict
        Recurrence configuration.

    Returns
    -------
    str
        JSON string for storage in Task.recurrence_rule.

    """
    return json.dumps(config, separators=(",", ":"))


def compute_next_occurrence(due_date: str, config: dict[str, Any]) -> str | None:
    """
    Find the next occurrence date after the given due_date.

    Parameters
    ----------
    due_date : str
        ISO date string (YYYY-MM-DD) of the current occurrence.
    config : dict
        Recurrence config with pattern, interval, days_of_week, etc.

    Returns
    -------
    str | None
        ISO date string for the next occurrence, or None if series has ended.

    """
    pattern_str = config.get("pattern", "none").upper()
    try:
        pattern = RecurrencePattern(pattern_str)
    except ValueError:
        return None

    if pattern == RecurrencePattern.NONE:
        return None

    interval = max(1, config.get("interval", 1))

    end_date_str = config.get("end_date")
    end_date_val = date.fromisoformat(end_date_str) if end_date_str else None

    max_occ = config.get("max_occurrences")
    created = config.get("occurrences_created", 0)

    # If max occurrences reached, series is over
    if max_occ and created >= max_occ:
        return None

    current = date.fromisoformat(due_date)

    # If end date already passed, no more occurrences
    if end_date_val and current >= end_date_val:
        return None

    # Search for next date in a generous range (up to 2 years)
    search_end = current + timedelta(days=730)
    dates = _generate_occurrence_dates(
        event_start_date=current,
        pattern=pattern,
        interval=interval,
        days_of_week=config.get("days_of_week"),
        day_of_month=config.get("day_of_month"),
        end_date=end_date_val,
        max_occurrences=None,  # We track this ourselves via occurrences_created
        range_start=current + timedelta(days=1),  # Strictly after current date
        range_end=search_end,
    )

    if not dates:
        return None

    return dates[0].isoformat()
