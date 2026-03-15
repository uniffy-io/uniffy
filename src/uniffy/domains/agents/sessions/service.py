"""Agent sessions service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.sessions.handlers import SessionsHandlers


class SessionsServiceImpl(SessionsHandlers):
    """Combined sessions service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
