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
    BeginEnrollmentRequest,
    BeginEnrollmentResponse,
    ConfirmEnrollmentRequest,
    ConfirmEnrollmentResponse,
    DisableMfaRequest,
    DisableMfaResponse,
    GetMfaStatusRequest,
    GetMfaStatusResponse,
    RegenerateRecoveryCodesRequest,
    RegenerateRecoveryCodesResponse,
    VerifyMfaRequest,
    VerifyMfaResponse,
)

from uniffy.core.auth.cookies import attach_asset_cookie
from uniffy.core.auth.devices import request_user_agent
from uniffy.core.auth.principal import current_user_id, resolve_organization_id
from uniffy.core.converters import datetime_to_timestamp, domain_type_to_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.shared import DomainType
from uniffy.domains.auth.errors import (
    AuthenticationError,
    MfaRateLimitedError,
    TokenError,
)
from uniffy.domains.auth.mfa.challenge import ENROLLMENT_ALLOWED_RPCS
from uniffy.domains.auth.mfa.context import enrollment_organization_id, enrollment_user_id
from uniffy.domains.auth.mfa.operations import MfaOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="auth.mfa.handlers")


def _mfa_domain_admins(values: list[str] | None) -> list[int]:
    if not values:
        return []
    out: list[int] = []
    for v in values:
        try:
            out.append(domain_type_to_proto(DomainType(v)))
        except ValueError:
            logger.warning("mfa_domain_admins: dropped unmapped domain {domain}", domain=v)
    return out


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
        user_id = _user_for_enrollment(ctx, rpc="BeginEnrollment")
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
            logger.exception(f"BeginEnrollment failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def confirm_enrollment(
        self,
        request: ConfirmEnrollmentRequest,
        ctx: RequestContext,
    ) -> ConfirmEnrollmentResponse:
        user_id = _user_for_enrollment(ctx, rpc="ConfirmEnrollment")
        user_agent = request_user_agent(ctx)
        pending_org_id = enrollment_organization_id(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                result = await ops.confirm_enrollment(
                    user_id,
                    request.code,
                    user_agent=user_agent,
                    pending_organization_id=pending_org_id,
                )
                asset_cookie = attach_asset_cookie(
                    ctx,
                    access_token=result.access_token,
                    user_id=user_id,
                    organization_id=result.organization_id,
                    session_id=result.session_id,
                )
                response = ConfirmEnrollmentResponse(
                    recovery_codes=result.recovery_codes,
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    session_id=str(result.session_id),
                    domain_admin_domains=_mfa_domain_admins(result.domain_admin_domains),
                    asset_cookie=asset_cookie,
                )
                if result.organization_id is not None:
                    response.organization_id = str(result.organization_id)
                if result.organization_slug:
                    response.organization_slug = result.organization_slug
                if result.organization_role:
                    response.organization_role = result.organization_role
                return response
        except AuthenticationError as exc:
            raise ConnectError(Code.UNAUTHENTICATED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except Exception as exc:
            logger.exception(f"ConfirmEnrollment failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def verify_mfa(
        self,
        request: VerifyMfaRequest,
        ctx: RequestContext,
    ) -> VerifyMfaResponse:
        user_agent = request_user_agent(ctx)
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                result = await ops.verify_mfa(
                    challenge_token=request.challenge_token,
                    code=request.code,
                    method=request.method,
                    user_agent=user_agent,
                )
                asset_cookie = attach_asset_cookie(
                    ctx,
                    access_token=result.access_token,
                    user_id=result.user_id,
                    organization_id=result.organization_id,
                    session_id=result.session_id,
                )
                response = VerifyMfaResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    used_recovery_code=result.used_recovery_code,
                    remaining_recovery_codes=result.remaining_recovery_codes,
                    domain_admin_domains=_mfa_domain_admins(result.domain_admin_domains),
                    asset_cookie=asset_cookie,
                )
                if result.organization_id is not None:
                    response.organization_id = str(result.organization_id)
                if result.organization_slug:
                    response.organization_slug = result.organization_slug
                if result.organization_role:
                    response.organization_role = result.organization_role
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
            logger.exception(f"VerifyMfa failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def disable_mfa(
        self,
        request: DisableMfaRequest,
        ctx: RequestContext,
    ) -> DisableMfaResponse:
        user_id = current_user_id()
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
            logger.exception(f"DisableMfa failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def regenerate_recovery_codes(
        self,
        request: RegenerateRecoveryCodesRequest,
        ctx: RequestContext,
    ) -> RegenerateRecoveryCodesResponse:
        user_id = current_user_id()
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
            logger.exception(f"RegenerateRecoveryCodes failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_mfa_status(
        self,
        request: GetMfaStatusRequest,
        ctx: RequestContext,
    ) -> GetMfaStatusResponse:
        user_id = _user_for_enrollment(ctx, rpc="GetMfaStatus")
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                status = await ops.get_status(user_id)
                response = GetMfaStatusResponse(
                    enabled=status.enabled,
                    remaining_recovery_codes=status.remaining_recovery_codes,
                )
                if status.enrolled_at is not None:
                    response.enrolled_at.CopyFrom(datetime_to_timestamp(status.enrolled_at))
                if status.last_used_at is not None:
                    response.last_used_at.CopyFrom(datetime_to_timestamp(status.last_used_at))
                return response
        except Exception as exc:
            logger.exception(f"GetMfaStatus failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_reset_mfa(
        self,
        request: AdminResetMfaRequest,
        ctx: RequestContext,
    ) -> AdminResetMfaResponse:
        actor_id = current_user_id()
        try:
            async with open_session() as session:
                ops = MfaOperations(session)
                await ops.admin_reset_mfa(
                    actor_user_id=actor_id,
                    organization_id=resolve_organization_id(request.organization_id),
                    target_user_id=UUID(request.target_user_id),
                    reason=request.reason,
                )
                return AdminResetMfaResponse(success=True)
        except PermissionDeniedError as exc:
            raise ConnectError(Code.PERMISSION_DENIED, str(exc))
        except NotFoundError as exc:
            raise ConnectError(Code.NOT_FOUND, str(exc))
        except ConnectError:
            raise
        except Exception as exc:
            logger.exception(f"AdminResetMfa failed: {exc}")
            raise ConnectError(Code.INTERNAL, "Internal server error")


def _user_for_enrollment(ctx: RequestContext, *, rpc: str) -> UUID:
    """Accept either an access token or an enrollment-only token.

    ``rpc`` is checked against ``ENROLLMENT_ALLOWED_RPCS`` so an
    enrollment-only token is only honoured for the three enrollment
    endpoints (``BeginEnrollment``, ``ConfirmEnrollment``,
    ``GetMfaStatus``). Any future handler that calls this helper
    without an allowlisted name will refuse to accept an enrollment
    token and require a real access token instead.
    """
    try:
        return current_user_id()
    except ConnectError:
        if rpc not in ENROLLMENT_ALLOWED_RPCS:
            raise
        return enrollment_user_id(ctx)
