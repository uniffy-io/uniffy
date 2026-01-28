"""Organizations service wrapper for ConnectRPC mounting."""

from uniffy.domains.organizations.handlers import OrganizationsHandlers


class OrganizationsServiceImpl(OrganizationsHandlers):
    """
    Organizations service implementation.

    Inherits from OrganizationsHandlers to provide a service
    that can be mounted on ConnectRPC.
    """

    pass
