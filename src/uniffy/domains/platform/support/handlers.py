"""RPC handlers for the operator and tenant halves of support sessions."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.support_session_pb import (
    ListAllSessionsRequest,
    ListAllSessionsResponse,
    ListMySessionsRequest,
    ListMySessionsResponse,
    RequestSessionRequest,
    RequestSessionResponse,
)
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

from uniffy.core.auth.principal import current_user_id
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.domains.platform.support.converters import (
    consent_mode_from_proto,
    consent_view_to_proto,
    scope_from_proto,
    session_to_proto,
    state_from_proto,
)
from uniffy.domains.platform.support.operations import (
    SupportSessionOperations,
)
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="platform.support.handlers")


def _parse_uuid(value: str, field: str) -> UUID:
    if not value:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is required")
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"{field} is not a valid UUID") from exc


def _map_domain_error(exc: Exception) -> ConnectError:
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc))
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc))
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, ValueError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    logger.exception("Unhandled error in support session handler")
    return ConnectError(Code.INTERNAL, "Internal server error")


class SupportSessionHandlers:
    """Operator-side RPCs, mounted under ``superadmin.v1.SupportService``."""

    async def request_session(
        self, request: RequestSessionRequest, ctx: RequestContext
    ) -> RequestSessionResponse:
        actor_id = current_user_id()
        org_id = _parse_uuid(request.organization_id, "organization_id")
        scope = scope_from_proto(request.scope)
        try:
            async with open_session() as session:
                view = await SupportSessionOperations(session).request_session(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    reason=request.reason,
                    scope=scope,
                    duration_minutes=request.duration_minutes,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return RequestSessionResponse(session=session_to_proto(view))

    async def list_my_sessions(
        self, request: ListMySessionsRequest, ctx: RequestContext
    ) -> ListMySessionsResponse:
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                page = await SupportSessionOperations(session).list_my_sessions(
                    actor_user_id=actor_id,
                    page=request.page,
                    page_size=request.page_size,
                    include_inactive=request.include_inactive,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListMySessionsResponse(
            sessions=[session_to_proto(v) for v in page.sessions],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def list_all_sessions(
        self, request: ListAllSessionsRequest, ctx: RequestContext
    ) -> ListAllSessionsResponse:
        actor_id = current_user_id()
        state = state_from_proto(request.state)
        try:
            async with open_session() as session:
                page = await SupportSessionOperations(session).list_all_sessions(
                    actor_user_id=actor_id,
                    page=request.page,
                    page_size=request.page_size,
                    state=state,
                    search=request.search,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListAllSessionsResponse(
            sessions=[session_to_proto(v) for v in page.sessions],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )


class SupportConsentHandlers:
    """Tenant-side RPCs, mounted under ``support.v1.SupportConsentService``."""

    async def approve_session(
        self, request: ApproveSessionRequest, ctx: RequestContext
    ) -> ApproveSessionResponse:
        actor_id = current_user_id()
        session_id = _parse_uuid(request.session_id, "session_id")
        try:
            async with open_session() as session:
                view = await SupportSessionOperations(session).approve_session(
                    actor_user_id=actor_id,
                    session_id=session_id,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ApproveSessionResponse(session=session_to_proto(view))

    async def reject_session(
        self, request: RejectSessionRequest, ctx: RequestContext
    ) -> RejectSessionResponse:
        actor_id = current_user_id()
        session_id = _parse_uuid(request.session_id, "session_id")
        try:
            async with open_session() as session:
                view = await SupportSessionOperations(session).reject_session(
                    actor_user_id=actor_id,
                    session_id=session_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return RejectSessionResponse(session=session_to_proto(view))

    async def revoke_session(
        self, request: RevokeSessionRequest, ctx: RequestContext
    ) -> RevokeSessionResponse:
        actor_id = current_user_id()
        session_id = _parse_uuid(request.session_id, "session_id")
        try:
            async with open_session() as session:
                view = await SupportSessionOperations(session).revoke_session(
                    actor_user_id=actor_id,
                    session_id=session_id,
                    reason=request.reason,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return RevokeSessionResponse(session=session_to_proto(view))

    async def list_org_sessions(
        self, request: ListOrgSessionsRequest, ctx: RequestContext
    ) -> ListOrgSessionsResponse:
        actor_id = current_user_id()
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                page = await SupportSessionOperations(session).list_org_sessions(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    page=request.page,
                    page_size=request.page_size,
                    include_inactive=request.include_inactive,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return ListOrgSessionsResponse(
            sessions=[session_to_proto(v) for v in page.sessions],
            total_count=page.total_count,
            page=page.page,
            page_size=page.page_size,
        )

    async def get_org_consent_mode(
        self, request: GetOrgConsentModeRequest, ctx: RequestContext
    ) -> GetOrgConsentModeResponse:
        actor_id = current_user_id()
        org_id = _parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                view = await SupportSessionOperations(session).get_org_consent_mode(
                    actor_user_id=actor_id, organization_id=org_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return GetOrgConsentModeResponse(view=consent_view_to_proto(view))

    async def set_org_consent_mode(
        self, request: SetOrgConsentModeRequest, ctx: RequestContext
    ) -> SetOrgConsentModeResponse:
        actor_id = current_user_id()
        org_id = _parse_uuid(request.organization_id, "organization_id")
        mode = consent_mode_from_proto(request.mode)
        try:
            async with open_session() as session:
                view = await SupportSessionOperations(session).set_org_consent_mode(
                    actor_user_id=actor_id,
                    organization_id=org_id,
                    mode=mode,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error(exc) from exc
        return SetOrgConsentModeResponse(view=consent_view_to_proto(view))
