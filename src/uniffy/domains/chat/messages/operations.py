"""Public chat message operations façade."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.messages.delivery import MessageDelivery
from uniffy.domains.chat.messages.indexing import MessageIndexing
from uniffy.domains.chat.messages.mutations import MessageMutations
from uniffy.domains.chat.messages.notifications import MessageNotifications
from uniffy.domains.chat.messages.queries import MessageQueries
from uniffy.domains.chat.messages.sending import MessageSender


class ChatMessageOperations(
    MessageSender,
    MessageDelivery,
    MessageIndexing,
    MessageNotifications,
    MessageQueries,
    MessageMutations,
):
    """Stable aggregate API over focused message use cases."""

    def __init__(
        self,
        session: AsyncSession,
        access: ChatAccessChecker | None = None,
        storage: ObjectStorage | None = None,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        self.session = session
        self.access = access or ChatAccessChecker(session)
        self.storage = storage
        self._search_indexer = search_indexer

    @property
    def search_indexer(self) -> SearchIndexer:
        if self._search_indexer is None:
            raise RuntimeError("Search indexing is required for chat message mutations")
        return self._search_indexer
