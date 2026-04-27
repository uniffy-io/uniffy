"""Chat service wrapper for ConnectRPC mounting.

Composes handlers from all chat sub-domains into a single service.
"""

from uniffy.domains.agents.chat_integration.context_handlers import (
    ChannelAgentContextHandlers,
)
from uniffy.domains.agents.chat_integration.handlers import (
    AgentConfirmationHandlers,
)
from uniffy.domains.chat.categories.handlers import CategoryHandlers
from uniffy.domains.chat.channels.handlers import ChannelHandlers
from uniffy.domains.chat.messages.handlers import MessageHandlers
from uniffy.domains.chat.reactions.handlers import ReactionHandlers
from uniffy.domains.chat.threads.handlers import ThreadHandlers


class ChatServiceImpl(
    ChannelHandlers,
    MessageHandlers,
    ThreadHandlers,
    ReactionHandlers,
    CategoryHandlers,
    AgentConfirmationHandlers,
    ChannelAgentContextHandlers,
):
    """Combined chat service implementation.

    Inherits from all chat handler classes to provide a single service
    that can be mounted on ConnectRPC.
    """

    pass
