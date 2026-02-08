"""Notifications service wrapper for ConnectRPC mounting."""

from uniffy.domains.notifications.handlers import NotificationsHandlers


class NotificationsServiceImpl(NotificationsHandlers):
    """
    Combined notifications service implementation.

    Inherits from NotificationsHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
