"""Agent runtime service wrapper for ConnectRPC mounting."""

from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.runtime.handlers import RuntimeHandlers


class RuntimeServiceImpl(RuntimeHandlers):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
