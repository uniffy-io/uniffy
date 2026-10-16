"""Agent runtime service wrapper for ConnectRPC mounting."""

from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.runtime.handlers import RuntimeHandlers


class RuntimeServiceImpl(RuntimeHandlers):
    def __init__(
        self, storage: ObjectStorage, search_indexer: SearchIndexer, buffer: UpdateBuffer
    ) -> None:
        self.storage = storage
        self.search_indexer = search_indexer
        self.buffer = buffer
