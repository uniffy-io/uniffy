"""Search service wrapper for ConnectRPC mounting."""

from uniffy.domains.search.handlers import SearchHandlers


class SearchServiceImpl(SearchHandlers):
    """
    Combined search service implementation.

    Inherits from SearchHandlers to provide a single service
    that can be mounted on ConnectRPC.
    """

    pass
