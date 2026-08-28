"""Stable calendar RPC handler composition."""

from uniffy.domains.calendar.rpc.attendees import AttendeeHandlers
from uniffy.domains.calendar.rpc.categories import CategoryHandlers
from uniffy.domains.calendar.rpc.events import EventMutationHandlers
from uniffy.domains.calendar.rpc.queries import EventQueryHandlers
from uniffy.domains.calendar.rpc.templates import TemplateHandlers


class CalendarHandlers(
    EventMutationHandlers,
    EventQueryHandlers,
    CategoryHandlers,
    AttendeeHandlers,
    TemplateHandlers,
):
    """RPC surface composed from focused calendar handler groups."""
