"""People service wrapper for ConnectRPC mounting."""

from uniffy_proto.people.v1.people_connect import PeopleService

from uniffy.core.search import SearchIndexer
from uniffy.domains.directory.people.rpc.people import PeopleHandlers
from uniffy.domains.directory.people.rpc.policy import ProfilePolicyHandlers
from uniffy.domains.directory.people.rpc.sync import IdentitySourceHandlers
from uniffy.domains.directory.people.rpc.teams import TeamHandlers


class PeopleServiceImpl(
    PeopleHandlers,
    TeamHandlers,
    ProfilePolicyHandlers,
    IdentitySourceHandlers,
    PeopleService,
):
    def __init__(self, search_indexer: SearchIndexer) -> None:
        self.search_indexer = search_indexer
