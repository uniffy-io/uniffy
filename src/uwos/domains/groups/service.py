"""Groups service wrapper for ConnectRPC mounting."""

from uwos.domains.groups.handlers import GroupsHandlers


class GroupsServiceImpl(GroupsHandlers):
    """
    Groups service implementation.

    Inherits from GroupsHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
