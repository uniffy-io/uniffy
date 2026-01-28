"""Users service wrapper for ConnectRPC mounting."""

from uniffy.domains.users.handlers import UsersHandlers


class UsersServiceImpl(UsersHandlers):
    """
    Users service implementation.

    Inherits from UsersHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
