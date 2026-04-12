"""Members service wrapper for ConnectRPC mounting."""

from uniffy.domains.permissions.handlers import MembersHandlers


class MembersServiceImpl(MembersHandlers):
    """Combined members service implementation.

    Inherits from :class:`MembersHandlers` so it can be mounted on
    ConnectRPC. ``permissions.v1.MembersService`` is the only service
    in this domain; the legacy ``PermissionsService`` and the
    ``ContentPermission``-based ``PermissionsOperations`` were removed
    when the new model landed.
    """

    pass
