"""ConnectRPC service binding for ``superadmin.v1.SupportService``."""

from connectrpc.request import RequestContext
from uniffy_proto.superadmin.v1.support_session_pb2 import (
    ApproveSessionRequest,
    ApproveSessionResponse,
    GetOrgConsentModeRequest,
    GetOrgConsentModeResponse,
    ListAllSessionsRequest,
    ListAllSessionsResponse,
    ListMySessionsRequest,
    ListMySessionsResponse,
    ListOrgSessionsRequest,
    ListOrgSessionsResponse,
    RejectSessionRequest,
    RejectSessionResponse,
    RequestSessionRequest,
    RequestSessionResponse,
    RevokeSessionRequest,
    RevokeSessionResponse,
    SetOrgConsentModeRequest,
    SetOrgConsentModeResponse,
)

from uniffy.domains.platform.support_session.handlers import SupportSessionHandlers


class SupportServiceImpl:
    """ConnectRPC service implementation - delegates to SupportSessionHandlers."""

    def __init__(self) -> None:
        self._handlers = SupportSessionHandlers()

    async def request_session(
        self, request: RequestSessionRequest, ctx: RequestContext
    ) -> RequestSessionResponse:
        return await self._handlers.request_session(request, ctx)

    async def approve_session(
        self, request: ApproveSessionRequest, ctx: RequestContext
    ) -> ApproveSessionResponse:
        return await self._handlers.approve_session(request, ctx)

    async def reject_session(
        self, request: RejectSessionRequest, ctx: RequestContext
    ) -> RejectSessionResponse:
        return await self._handlers.reject_session(request, ctx)

    async def revoke_session(
        self, request: RevokeSessionRequest, ctx: RequestContext
    ) -> RevokeSessionResponse:
        return await self._handlers.revoke_session(request, ctx)

    async def list_my_sessions(
        self, request: ListMySessionsRequest, ctx: RequestContext
    ) -> ListMySessionsResponse:
        return await self._handlers.list_my_sessions(request, ctx)

    async def list_org_sessions(
        self, request: ListOrgSessionsRequest, ctx: RequestContext
    ) -> ListOrgSessionsResponse:
        return await self._handlers.list_org_sessions(request, ctx)

    async def list_all_sessions(
        self, request: ListAllSessionsRequest, ctx: RequestContext
    ) -> ListAllSessionsResponse:
        return await self._handlers.list_all_sessions(request, ctx)

    async def get_org_consent_mode(
        self, request: GetOrgConsentModeRequest, ctx: RequestContext
    ) -> GetOrgConsentModeResponse:
        return await self._handlers.get_org_consent_mode(request, ctx)

    async def set_org_consent_mode(
        self, request: SetOrgConsentModeRequest, ctx: RequestContext
    ) -> SetOrgConsentModeResponse:
        return await self._handlers.set_org_consent_mode(request, ctx)
