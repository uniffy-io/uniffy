"""iCalendar (RFC 5545) serialization and parsing for calendar events."""

from uniffy.domains.scheduling.calendar.ical.rrule import (
    RecurrenceMapping,
    RecurrenceRejection,
    UnsupportedRule,
    config_to_rrule,
    rrule_to_config,
)

__all__ = [
    "RecurrenceMapping",
    "RecurrenceRejection",
    "UnsupportedRule",
    "config_to_rrule",
    "rrule_to_config",
]
