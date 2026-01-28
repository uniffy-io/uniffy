"""Calendar service wrapper for ConnectRPC mounting."""

from uniffy.domains.calendar.handlers import CalendarHandlers


class CalendarServiceImpl(CalendarHandlers):
    """
    Combined calendar service implementation.

    Inherits from CalendarHandlers to provide a single service
    that can be mounted on ConnectRPC.
    """

    pass
