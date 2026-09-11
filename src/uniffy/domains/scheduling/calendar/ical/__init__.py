"""iCalendar (RFC 5545) serialization and parsing for calendar events."""

from uniffy.domains.scheduling.calendar.ical.emit import (
    EventExport,
    IcalAttendee,
    IcalPerson,
    serialize_events,
)
from uniffy.domains.scheduling.calendar.ical.rrule import (
    RecurrenceMapping,
    RecurrenceRejection,
    UnsupportedRule,
    config_to_rrule,
    rrule_to_config,
)

__all__ = [
    "EventExport",
    "IcalAttendee",
    "IcalPerson",
    "RecurrenceMapping",
    "RecurrenceRejection",
    "UnsupportedRule",
    "config_to_rrule",
    "rrule_to_config",
    "serialize_events",
]
