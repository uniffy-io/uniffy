"""Auth service wrapper combining all auth handlers for ConnectRPC mounting."""

from uwos.domains.auth.handlers import AuthHandlers
from uwos.domains.auth.handlers_admin import AdminHandlers, GroupHandlers


class AuthServiceImpl(AuthHandlers, AdminHandlers, GroupHandlers):
    """
    Combined auth service implementation.

    Inherits from all auth handler classes to provide
    a single service that can be mounted on ConnectRPC.
    """

    pass
