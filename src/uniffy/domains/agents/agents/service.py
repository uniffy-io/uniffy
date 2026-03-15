"""Agent agents service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.agents.handlers import AgentsHandlers


class AgentsServiceImpl(AgentsHandlers):
    """Combined agents service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
