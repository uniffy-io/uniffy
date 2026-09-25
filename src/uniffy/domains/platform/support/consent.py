"""ConnectRPC service binding for ``support.v1.SupportConsentService``."""

from connectrpc.request import RequestContext
from uniffy_proto.support.v1.support_consent_pb import (
    ApproveSessionRequest,
    ApproveSessionResponse,
    GetOrgConsentModeRequest,
    GetOrgConsentModeResponse,
    ListOrgSessionsRequest,
    ListOrgSessionsResponse,
    RejectSessionRequest,
    RejectSessionResponse,
    RevokeSessionRequest,
    RevokeSessionResponse,
    SetOrgConsentModeRequest,
    SetOrgConsentModeResponse,
)

from uniffy.domains.platform.support.handlers import SupportConsentHandlers


class SupportConsentServiceImpl:
    def __init__(self) -> None:
        self._handlers = SupportConsentHandlers()

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

    async def list_org_sessions(
        self, request: ListOrgSessionsRequest, ctx: RequestContext
    ) -> ListOrgSessionsResponse:
        return await self._handlers.list_org_sessions(request, ctx)

    async def get_org_consent_mode(
        self, request: GetOrgConsentModeRequest, ctx: RequestContext
    ) -> GetOrgConsentModeResponse:
        return await self._handlers.get_org_consent_mode(request, ctx)

    async def set_org_consent_mode(
        self, request: SetOrgConsentModeRequest, ctx: RequestContext
    ) -> SetOrgConsentModeResponse:
        return await self._handlers.set_org_consent_mode(request, ctx)
