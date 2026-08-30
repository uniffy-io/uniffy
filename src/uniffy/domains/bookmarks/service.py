"""Bookmarks service wrapper for ConnectRPC mounting."""

from uniffy.core.search import SearchIndexer
from uniffy.domains.bookmarks.handlers import BookmarksHandlers


class BookmarksServiceImpl(BookmarksHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer
