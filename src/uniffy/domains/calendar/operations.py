"""Stable calendar operations exports."""

from uniffy.domains.calendar.categories.operations import CategoryOperations
from uniffy.domains.calendar.events.operations import CalendarEventOperations
from uniffy.domains.calendar.events.state import (
    _activity_value,
    _master_event_id,
    event_details_hidden,
)
from uniffy.domains.calendar.templates.operations import EventTemplateOperations

__all__ = [
    "CalendarEventOperations",
    "CategoryOperations",
    "EventTemplateOperations",
    "_activity_value",
    "_master_event_id",
    "event_details_hidden",
]
