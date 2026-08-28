"""Calendar service wrapper for ConnectRPC mounting."""

from uniffy.domains.calendar.handlers import CalendarHandlers
from uniffy.domains.calendar.rpc.scheduling import SchedulingHandlers


class CalendarServiceImpl(CalendarHandlers, SchedulingHandlers):
    """ConnectRPC calendar service composed from its handler groups."""
