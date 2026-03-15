"""Agent providers service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.providers.handlers import ProvidersHandlers


class ProvidersServiceImpl(ProvidersHandlers):
    """Combined providers service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
