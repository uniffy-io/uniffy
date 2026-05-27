"""MFA RPC handlers -- thin layer over ``MfaOperations``."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.auth.v1.mfa_pb2 import (
    AdminResetMfaRequest,
    AdminResetMfaResponse,
    ApprovePlatformPeerResetRequest,
    ApprovePlatformPeerResetResponse,
    BeginEnrollmentRequest,
    BeginEnrollmentResponse,
    ConfirmEnrollmentRequest,
    ConfirmEnrollmentResponse,
    DisableMfaRequest,
    DisableMfaResponse,
    GetMfaStatusRequest,
    GetMfaStatusResponse,
    ListPlatformPeerResetsRequest,
    ListPlatformPeerResetsResponse,
    PlatformResetMfaRequest,
    PlatformResetMfaResponse,
    RegenerateRecoveryCodesRequest,
    RegenerateRecoveryCodesResponse,
    RequestPlatformPeerResetRequest,
    RequestPlatformPeerResetResponse,
    VerifyMfaRequest,
    VerifyMfaResponse,
)
from uniffy_proto.auth.v1.mfa_pb2 import (
    PendingPeerReset as PendingPeerResetProto,
)

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import open_session
from uniffy.domains.auth.context import (
    get_user_agent_from_context,
    get_user_id_from_context,
    get_user_id_from_enrollment_context,
)
from uniffy.domains.auth.errors import (
    AuthenticationError,
    MfaRateLimitedError,
    TokenError,
)
from uniffy.domains.auth.mfa.operations import MfaOperations


class MfaHandlers:
    """ConnectRPC handlers for the MFA service.

    Enrollment-state endpoints (``BeginEnrollment``, ``ConfirmEnrollment``,
    ``GetMfaStatus``) accept either a regular access token or an
    enrollment-only token; everything else requires a real access token.
    ``VerifyMfa`` is unauthenticated (the challenge token rides in the
    request body).
    """

    async def begin_enrollment(
        self,
        request: BeginEnrollmentRequest,
        ctx: RequestContext,
    ) -> BeginEnrollmentResponse:
        user_id = _user_for_enrollment(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                challenge = await ops.begin_enrollment(user_id)
                return BeginEnrollmentResponse(
                    secret_b32=challenge.secret_b32,
                    provisioning_uri=challenge.provisioning_uri,
                    qr_svg_base64=challenge.qr_svg_base64,
                )
        except AuthenticationError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except PermissionDeniedError as exc:
            raise ConnectError(Code.FAILED_PRECONDITION, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"BeginEnrollment failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def confirm_enrollment(
        self,
        request: ConfirmEnrollmentRequest,
        ctx: RequestContext,
    ) -> ConfirmEnrollmentResponse:
        user_id = _user_for_enrollment(ctx)
        user_agent = get_user_agent_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                result = await ops.confirm_enrollment(
                    user_id, request.code, user_agent=user_agent
                )
                return ConfirmEnrollmentResponse(
                    recovery_codes=result.recovery_codes,
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    session_id=str(result.session_id),
                )
        except AuthenticationError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"ConfirmEnrollment failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def verify_mfa(
        self,
        request: VerifyMfaRequest,
        ctx: RequestContext,
    ) -> VerifyMfaResponse:
        user_agent = get_user_agent_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                result = await ops.verify_mfa(
                    challenge_token=request.challenge_token,
                    code=request.code,
                    method=request.method,
                    user_agent=user_agent,
                )
                response = VerifyMfaResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    used_recovery_code=result.used_recovery_code,
                    remaining_recovery_codes=result.remaining_recovery_codes,
                )
                if result.organization_id is not None:
                    response.organization_id = str(result.organization_id)
                if result.session_id is not None:
                    response.session_id = str(result.session_id)
                return response
        except MfaRateLimitedError as exc:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(exc))
        except TokenError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except AuthenticationError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except Exception as exc:
            logger.error(f"VerifyMfa failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def disable_mfa(
        self,
        request: DisableMfaRequest,
        ctx: RequestContext,
    ) -> DisableMfaResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                await ops.disable_mfa(user_id, request.code)
                return DisableMfaResponse(success=True)
        except AuthenticationError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"DisableMfa failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def regenerate_recovery_codes(
        self,
        request: RegenerateRecoveryCodesRequest,
        ctx: RequestContext,
    ) -> RegenerateRecoveryCodesResponse:
        user_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                codes = await ops.regenerate_recovery_codes(user_id, request.code)
                return RegenerateRecoveryCodesResponse(recovery_codes=codes)
        except AuthenticationError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"RegenerateRecoveryCodes failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_mfa_status(
        self,
        request: GetMfaStatusRequest,
        ctx: RequestContext,
    ) -> GetMfaStatusResponse:
        user_id = _user_for_enrollment(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                status = await ops.get_status(user_id)
                response = GetMfaStatusResponse(
                    enabled=status.enabled,
                    remaining_recovery_codes=status.remaining_recovery_codes,
                )
                if status.enrolled_at is not None:
                    response.enrolled_at.CopyFrom(
                        datetime_to_timestamp(status.enrolled_at)
                    )
                if status.last_used_at is not None:
                    response.last_used_at.CopyFrom(
                        datetime_to_timestamp(status.last_used_at)
                    )
                return response
        except Exception as exc:
            logger.error(f"GetMfaStatus failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_reset_mfa(
        self,
        request: AdminResetMfaRequest,
        ctx: RequestContext,
    ) -> AdminResetMfaResponse:
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                await ops.admin_reset_mfa(
                    actor_user_id=actor_id,
                    organization_id=UUID(request.organization_id),
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                return AdminResetMfaResponse(success=True)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"AdminResetMfa failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def platform_reset_mfa(
        self,
        request: PlatformResetMfaRequest,
        ctx: RequestContext,
    ) -> PlatformResetMfaResponse:
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                await ops.platform_reset_mfa(
                    actor_user_id=actor_id,
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                return PlatformResetMfaResponse(success=True)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"PlatformResetMfa failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def request_platform_peer_reset(
        self,
        request: RequestPlatformPeerResetRequest,
        ctx: RequestContext,
    ) -> RequestPlatformPeerResetResponse:
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                request_id, expires_at = await ops.request_platform_peer_reset(
                    actor_user_id=actor_id,
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                response = RequestPlatformPeerResetResponse(
                    request_id=str(request_id),
                )
                response.expires_at.CopyFrom(datetime_to_timestamp(expires_at))
                return response
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"RequestPlatformPeerReset failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_platform_peer_resets(
        self,
        request: ListPlatformPeerResetsRequest,
        ctx: RequestContext,
    ) -> ListPlatformPeerResetsResponse:
        del request
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                pending = await ops.list_platform_peer_resets(actor_id)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except Exception as exc:
            logger.error(f"ListPlatformPeerResets failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
        response = ListPlatformPeerResetsResponse()
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

    async def approve_platform_peer_reset(
        self,
        request: ApprovePlatformPeerResetRequest,
        ctx: RequestContext,
    ) -> ApprovePlatformPeerResetResponse:
        actor_id = get_user_id_from_context(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                await ops.approve_platform_peer_reset(
                    actor_user_id=actor_id,
                    request_id=UUID(request.request_id),
                )
                return ApprovePlatformPeerResetResponse(success=True)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.error(f"ApprovePlatformPeerReset failed: {exc}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")


def _user_for_enrollment(ctx: RequestContext) -> UUID:
    """Accept either an access token or an enrollment-only token.

    Whichever decoder accepts the token first wins. Used by the three
    RPCs that must work for users who do not yet have full access:
    BeginEnrollment, ConfirmEnrollment, GetMfaStatus.
    """
    try:
        return get_user_id_from_context(ctx)
    except ConnectError:
        return get_user_id_from_enrollment_context(ctx)
