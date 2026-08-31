"""Stable calendar RPC handler composition."""

from uniffy.domains.scheduling.calendar.rpc.attendees import AttendeeHandlers
from uniffy.domains.scheduling.calendar.rpc.categories import CategoryHandlers
from uniffy.domains.scheduling.calendar.rpc.events import EventMutationHandlers
from uniffy.domains.scheduling.calendar.rpc.queries import EventQueryHandlers
from uniffy.domains.scheduling.calendar.rpc.templates import TemplateHandlers


class CalendarHandlers(
    EventMutationHandlers,
    EventQueryHandlers,
    CategoryHandlers,
    AttendeeHandlers,
    TemplateHandlers,
):
    """RPC surface composed from focused calendar handler groups."""
