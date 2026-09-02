"""ConnectRPC service binding for ``superadmin.v1.SupportService``."""

from connectrpc.request import RequestContext
from uniffy_proto.superadmin.v1.support_session_pb2 import (
    ListAllSessionsRequest,
    ListAllSessionsResponse,
    ListMySessionsRequest,
    ListMySessionsResponse,
    RequestSessionRequest,
    RequestSessionResponse,
)

from uniffy.domains.platform.support.handlers import SupportSessionHandlers


class SupportServiceImpl:
    def __init__(self) -> None:
        self._handlers = SupportSessionHandlers()

    async def request_session(
        self, request: RequestSessionRequest, ctx: RequestContext
    ) -> RequestSessionResponse:
        return await self._handlers.request_session(request, ctx)

    async def list_my_sessions(
        self, request: ListMySessionsRequest, ctx: RequestContext
    ) -> ListMySessionsResponse:
        return await self._handlers.list_my_sessions(request, ctx)

    async def list_all_sessions(
        self, request: ListAllSessionsRequest, ctx: RequestContext
    ) -> ListAllSessionsResponse:
        return await self._handlers.list_all_sessions(request, ctx)
