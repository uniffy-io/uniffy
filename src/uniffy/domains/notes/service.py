"""Notes service wrapper for ConnectRPC mounting."""

from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.notes.handlers import NotesHandlers


class NotesServiceImpl(NotesHandlers):
    def __init__(self, storage: ObjectStorage, search_indexer: SearchIndexer) -> None:
        self.storage = storage
        self.search_indexer = search_indexer
