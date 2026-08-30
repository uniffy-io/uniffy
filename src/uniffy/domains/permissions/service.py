"""Members service wrapper for ConnectRPC mounting."""

from uniffy.domains.permissions.handlers import MembersHandlers
from uniffy.domains.permissions.requests.handlers import AccessRequestHandlers


class MembersServiceImpl(AccessRequestHandlers, MembersHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
