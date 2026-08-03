"""People service wrapper for ConnectRPC mounting."""

from uniffy_proto.people.v1.people_connect import PeopleService

from uniffy.domains.people.handlers import PeopleHandlers


class PeopleServiceImpl(PeopleHandlers, PeopleService):
    """ConnectRPC people service; RPCs not yet implemented answer UNIMPLEMENTED."""

    pass
