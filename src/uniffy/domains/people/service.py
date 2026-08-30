"""People service wrapper for ConnectRPC mounting."""

from uniffy_proto.people.v1.people_connect import PeopleService

from uniffy.core.search import SearchIndexer
from uniffy.domains.people.handlers import PeopleHandlers


class PeopleServiceImpl(PeopleHandlers, PeopleService):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer

    pass
