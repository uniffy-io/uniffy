"""Organizations service wrapper for ConnectRPC mounting."""

from uniffy.core.search import SearchIndexer
from uniffy.domains.calls.lifecycle import CallRevocationLifecycle
from uniffy.domains.organizations.handlers import OrganizationsHandlers


class OrganizationsServiceImpl(OrganizationsHandlers):
    def __init__(
        self,
        search_indexer: SearchIndexer,
        call_lifecycle: CallRevocationLifecycle,
    ) -> None:
        self.search_indexer = search_indexer
        self.call_lifecycle = call_lifecycle
