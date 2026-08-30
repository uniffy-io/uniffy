"""Groups service wrapper for ConnectRPC mounting."""

from uniffy.domains.groups.handlers import GroupsHandlers


class GroupsServiceImpl(GroupsHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
