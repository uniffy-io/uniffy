"""Agent agents service wrapper for ConnectRPC mounting."""

from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.agents.handlers import AgentsHandlers


class AgentsServiceImpl(AgentsHandlers):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
