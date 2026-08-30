"""Chat service wrapper for ConnectRPC mounting."""

from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.bridge.contexts import (
    ChannelAgentContextHandlers,
)
from uniffy.domains.agents.bridge.handlers import (
    AgentConfirmationHandlers,
)
from uniffy.domains.chat.categories.handlers import CategoryHandlers
from uniffy.domains.chat.channels.handlers import ChannelHandlers
from uniffy.domains.chat.drafts.handlers import DraftHandlers
from uniffy.domains.chat.folders.handlers import AgentFolderHandlers
from uniffy.domains.chat.messages.handlers import MessageHandlers
from uniffy.domains.chat.policies.handlers import ChatPolicyHandlers
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
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
