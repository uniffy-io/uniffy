"""Members service wrapper for ConnectRPC mounting."""

from uniffy.domains.permissions.handlers import MembersHandlers
from uniffy.domains.permissions.requests.handlers import AccessRequestHandlers


class MembersServiceImpl(AccessRequestHandlers, MembersHandlers):
    pass
