"""RPC handlers for ``superadmin.v1.SystemMfaService``.

Thin layer over ``MfaOperations``; the operations (and their
platform-admin gates) live in ``domains/auth/mfa/operations.py``.
"""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.superadmin.v1.system_mfa_pb2 import (
    ApprovePeerResetRequest,
    ApprovePeerResetResponse,
    ListPeerResetsRequest,
    ListPeerResetsResponse,
    RequestPeerResetRequest,
    RequestPeerResetResponse,
    ResetUserMfaRequest,
    ResetUserMfaResponse,
)
from uniffy_proto.superadmin.v1.system_mfa_pb2 import (
    PendingPeerReset as PendingPeerResetProto,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.auth.mfa.operations import MfaOperations

logger = logger.bind(component="platform.mfa.handlers")


class SystemMfaHandlers:
    async def reset_user_mfa(
        self,
        request: ResetUserMfaRequest,
        ctx: RequestContext,
    ) -> ResetUserMfaResponse:
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
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
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                request_id, expires_at = await ops.request_platform_peer_reset(
                    actor_user_id=actor_id,
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                response = RequestPeerResetResponse(
                    request_id=str(request_id),
                )
                response.expires_at.CopyFrom(datetime_to_timestamp(expires_at))
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
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
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
            row.created_at.CopyFrom(datetime_to_timestamp(p.created_at))
            row.expires_at.CopyFrom(datetime_to_timestamp(p.expires_at))
            response.requests.append(row)
        return response

    async def approve_peer_reset(
        self,
        request: ApprovePeerResetRequest,
        ctx: RequestContext,
    ) -> ApprovePeerResetResponse:
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
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
