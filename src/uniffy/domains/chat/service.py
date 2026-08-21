"""Chat service wrapper for ConnectRPC mounting."""

from uniffy.domains.agents.chat_integration.context_handlers import (
    ChannelAgentContextHandlers,
)
from uniffy.domains.agents.chat_integration.handlers import (
    AgentConfirmationHandlers,
)
from uniffy.domains.chat.agent_folders.handlers import AgentFolderHandlers
from uniffy.domains.chat.categories.handlers import CategoryHandlers
from uniffy.domains.chat.channels.handlers import ChannelHandlers
from uniffy.domains.chat.drafts.handlers import DraftHandlers
from uniffy.domains.chat.messages.handlers import MessageHandlers
from uniffy.domains.chat.policy_handlers import ChatPolicyHandlers
from uniffy.domains.chat.reactions.handlers import ReactionHandlers
from uniffy.domains.chat.threads.handlers import ThreadHandlers


class ChatServiceImpl(
    ChannelHandlers,
    MessageHandlers,
    ThreadHandlers,
    ReactionHandlers,
    CategoryHandlers,
    AgentFolderHandlers,
    DraftHandlers,
    ChatPolicyHandlers,
    AgentConfirmationHandlers,
    ChannelAgentContextHandlers,
):
    pass
