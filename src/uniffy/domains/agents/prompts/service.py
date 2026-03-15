"""Agent prompts service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.prompts.handlers import PromptsHandlers


class PromptsServiceImpl(PromptsHandlers):
    """Combined prompts service implementation.

    Inherits from handlers to provide service that can be mounted on ConnectRPC.
    """

    pass
