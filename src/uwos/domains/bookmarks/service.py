"""Bookmarks service wrapper for ConnectRPC mounting."""

from uwos.domains.bookmarks.handlers import BookmarksHandlers


class BookmarksServiceImpl(BookmarksHandlers):
    """
    Combined bookmarks service implementation.

    Inherits from BookmarksHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
