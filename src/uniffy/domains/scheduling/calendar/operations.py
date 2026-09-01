"""Stable calendar operations exports."""

from uniffy.domains.scheduling.calendar.categories.operations import CategoryOperations
from uniffy.domains.scheduling.calendar.events.operations import CalendarEventOperations
from uniffy.domains.scheduling.calendar.events.reader import CalendarEventReader
from uniffy.domains.scheduling.calendar.events.state import (
    _activity_value,
    _master_event_id,
    event_details_hidden,
)
from uniffy.domains.scheduling.calendar.templates.operations import EventTemplateOperations

__all__ = [
    "CalendarEventOperations",
    "CalendarEventReader",
    "CategoryOperations",
    "EventTemplateOperations",
    "_activity_value",
    "_master_event_id",
    "event_details_hidden",
]
