"""Members service wrapper for ConnectRPC mounting."""

from uniffy.domains.permissions.access_request_handlers import AccessRequestHandlers
from uniffy.domains.permissions.handlers import MembersHandlers


class MembersServiceImpl(AccessRequestHandlers, MembersHandlers):
    pass
