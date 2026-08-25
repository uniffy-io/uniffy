"""Calendar service wrapper for ConnectRPC mounting."""

from uniffy.domains.calendar.handlers import CalendarHandlers
from uniffy.domains.calendar.handlers_scheduling import SchedulingHandlers


class CalendarServiceImpl(CalendarHandlers, SchedulingHandlers):
    """
    Combined calendar service implementation.

    Inherits the handler mixins to provide a single service
    that can be mounted on ConnectRPC.
    """

    pass
