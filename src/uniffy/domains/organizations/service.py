"""Organizations service wrapper for ConnectRPC mounting."""

from uniffy.domains.organizations.handlers import OrganizationsHandlers


class OrganizationsServiceImpl(OrganizationsHandlers):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer


from uniffy.core.search import SearchIndexer
