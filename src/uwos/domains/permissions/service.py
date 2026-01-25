"""Permissions service wrapper for ConnectRPC mounting."""

from uwos.domains.permissions.handlers import PermissionsHandlers


class PermissionsServiceImpl(PermissionsHandlers):
    """
    Combined permissions service implementation.

    Inherits from PermissionsHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
