"""Rooms service wrapper for ConnectRPC mounting."""

from uniffy.domains.rooms.handlers import BookingHandlers, RoomHandlers


class RoomsServiceImpl(RoomHandlers, BookingHandlers):
    """
    Combined rooms service implementation.

    Inherits from RoomHandlers and BookingHandlers to provide a single
    service that can be mounted on ConnectRPC.
    """

    pass
