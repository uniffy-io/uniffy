"""Platform MFA administration RPC handlers."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.system_mfa_pb import (
    ApprovePeerResetRequest,
    ApprovePeerResetResponse,
    ListPeerResetsRequest,
    ListPeerResetsResponse,
    RequestPeerResetRequest,
    RequestPeerResetResponse,
    ResetUserMfaRequest,
    ResetUserMfaResponse,
)
from uniffy_proto.superadmin.v1.system_mfa_pb import (
    PendingPeerReset as PendingPeerResetProto,
)

from uniffy.core.auth.identity import require_system_admin
from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.domains.auth.mfa.contracts import PlatformMfaOperationsFactory
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="platform.mfa.handlers")


class SystemMfaHandlers:
    def __init__(self, operations_factory: PlatformMfaOperationsFactory) -> None:
        self._operations_factory = operations_factory

    async def reset_user_mfa(
        self,
        request: ResetUserMfaRequest,
        ctx: RequestContext,
    ) -> ResetUserMfaResponse:
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                await require_system_admin(session, actor_id)
                ops = self._operations_factory(session)
                await ops.platform_reset_mfa(
                    actor_user_id=actor_id,
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                return ResetUserMfaResponse(success=True)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.exception(f"ResetUserMfa failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def request_peer_reset(
        self,
        request: RequestPeerResetRequest,
        ctx: RequestContext,
    ) -> RequestPeerResetResponse:
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                await require_system_admin(session, actor_id)
                ops = self._operations_factory(session)
                request_id, expires_at = await ops.request_platform_peer_reset(
                    actor_user_id=actor_id,
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                response = RequestPeerResetResponse(
                    request_id=str(request_id),
                )
                response.expires_at = datetime_to_timestamp(expires_at)
                return response
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.exception(f"RequestPeerReset failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_peer_resets(
        self,
        request: ListPeerResetsRequest,
        ctx: RequestContext,
    ) -> ListPeerResetsResponse:
        del request
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                await require_system_admin(session, actor_id)
                ops = self._operations_factory(session)
                pending = await ops.list_platform_peer_resets(actor_id)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.exception(f"ListPeerResets failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
        response = ListPeerResetsResponse()
        for p in pending:
            row = PendingPeerResetProto(
                request_id=str(p.request_id),
                requester_user_id=str(p.requester_user_id),
                requester_email=p.requester_email,
                target_user_id=str(p.target_user_id),
                target_email=p.target_email,
                reason=p.reason,
            )
            row.created_at = datetime_to_timestamp(p.created_at)
            row.expires_at = datetime_to_timestamp(p.expires_at)
            response.requests.append(row)
        return response

    async def approve_peer_reset(
        self,
        request: ApprovePeerResetRequest,
        ctx: RequestContext,
    ) -> ApprovePeerResetResponse:
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                await require_system_admin(session, actor_id)
                ops = self._operations_factory(session)
                await ops.approve_platform_peer_reset(
                    actor_user_id=actor_id,
                    request_id=UUID(request.request_id),
                )
                return ApprovePeerResetResponse(success=True)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.exception(f"ApprovePeerReset failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
