"""Agent runtime service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.runtime.handlers import RuntimeHandlers


class RuntimeServiceImpl(RuntimeHandlers):
    """Combined runtime service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
