"""Auth service wrapper for ConnectRPC mounting."""

from uniffy.domains.auth.handlers import AuthHandlers


class AuthServiceImpl(AuthHandlers):
    """
    Auth service implementation.

    Inherits from AuthHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
