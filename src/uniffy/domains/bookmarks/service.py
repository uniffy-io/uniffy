"""Bookmarks service wrapper for ConnectRPC mounting."""

from uniffy.domains.bookmarks.handlers import BookmarksHandlers


class BookmarksServiceImpl(BookmarksHandlers):
    """Concrete bookmarks service mounted by the application factory."""

    pass
