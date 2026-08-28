"""Auth RPC handlers - thin layer delegating to operations."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.auth.v1.auth_pb2 import (
    AcceptInvitationRequest,
    AcceptInvitationResponse,
    GetAuthConfigRequest,
    GetAuthConfigResponse,
    GetCacheKeySeedRequest,
    GetCacheKeySeedResponse,
    GetCurrentUserRequest,
    GetCurrentUserResponse,
    GetInvitationRequest,
    GetInvitationResponse,
    ListSessionsRequest,
    ListSessionsResponse,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    LogoutResponse,
    RefreshTokenRequest,
    RefreshTokenResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    RevokeOtherSessionsRequest,
    RevokeOtherSessionsResponse,
    RevokeSessionRequest,
    RevokeSessionResponse,
    RotateCacheKeySeedRequest,
    RotateCacheKeySeedResponse,
    SendPasswordResetRequest,
    SendPasswordResetResponse,
    SwitchOrganizationRequest,
    SwitchOrganizationResponse,
    VerifyPasswordResetTokenRequest,
    VerifyPasswordResetTokenResponse,
)
from uniffy_proto.auth.v1.auth_pb2 import (
    AuthResult as AuthResultProto,
)
from uniffy_proto.auth.v1.auth_pb2 import (
    EnrollmentRequired as EnrollmentRequiredProto,
)
from uniffy_proto.auth.v1.auth_pb2 import (
    MfaChallenge as MfaChallengeProto,
)

from uniffy.core.audit import audit_ip_var
from uniffy.core.auth.cookies import (
    attach_asset_cookie,
    build_clear_cookie,
    resolve_asset_cookie_config,
)
from uniffy.core.auth.devices import request_user_agent
from uniffy.core.auth.identity import get_user_by_id, require_system_admin
from uniffy.core.auth.principal import current_session_id, current_user_id
from uniffy.core.auth.tokens import decode_refresh_token
from uniffy.core.config.registration import public_registration_enabled
from uniffy.core.converters import (
    datetime_to_timestamp,
    domain_type_to_proto,
    org_role_to_proto,
)
from uniffy.core.errors import RateLimitExceededError, ValidationError
from uniffy.core.models.shared import DomainType
from uniffy.db import open_session
from uniffy.domains.auth.converters import session_to_proto, user_to_proto
from uniffy.domains.auth.errors import (
    AuthenticationError,
    RegistrationError,
    TokenError,
)
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.passwords.reset import (
    PasswordResetError,
    PasswordResetOperations,
    PasswordResetTokenExpiredError,
    PasswordResetTokenNotFoundError,
    PasswordResetTokenUsedError,
)
from uniffy.domains.auth.types import (
    AuthResult,
    MfaChallengeRequired,
    MfaEnrollmentRequired,
)
from uniffy.domains.organizations.invitations import (
    InvitationAlreadyUsedError,
    InvitationEmailConflictError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationOperations,
    InvitationRevokedError,
)

logger = logger.bind(component="auth.handlers")


def _domain_admins_to_proto(result: AuthResult) -> list[int]:
    """Convert AuthResult domain_admin_domains to proto enum values.

    Unmapped values surface as a warning rather than disappearing
    silently so a missing entry in the proto enum is visible in logs
    instead of underreporting an admin's badges to the UI.
    """
    if not result.domain_admin_domains:
        return []
    values = []
    for d in result.domain_admin_domains:
        try:
            values.append(domain_type_to_proto(DomainType(d)))
        except ValueError:
            logger.warning(
                "domain_admins_to_proto: dropped unmapped domain {domain}",
                domain=d,
            )
    return values


def _auth_result_to_proto(result: AuthResult) -> AuthResultProto:
    """Build the proto ``AuthResult`` from the domain dataclass."""
    proto = AuthResultProto(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        token_type="bearer",
        user_id=str(result.user_id),
        domain_admin_domains=_domain_admins_to_proto(result),
    )
    if result.organization_id is not None:
        proto.organization_id = str(result.organization_id)
    if result.organization_slug:
        proto.organization_slug = result.organization_slug
    if result.organization_role:
        proto.organization_role = result.organization_role
    if result.session_id is not None:
        proto.session_id = str(result.session_id)
    return proto


def _set_asset_cookie(ctx: RequestContext, result: AuthResult) -> str:
    """Attach the read-only asset cookie to an auth response; returns the ``name=value`` pair."""
    return attach_asset_cookie(
        ctx,
        access_token=result.access_token,
        user_id=result.user_id,
        organization_id=result.organization_id,
        session_id=result.session_id,
    )


def _clear_asset_cookie(ctx: RequestContext) -> None:
    ctx.response_headers().add("set-cookie", build_clear_cookie(resolve_asset_cookie_config()))


def _login_outcome_to_proto(
    outcome: AuthResult | MfaChallengeRequired | MfaEnrollmentRequired,
) -> LoginResponse:
    """Map the operations-layer union into the wire-level oneof."""
    if isinstance(outcome, AuthResult):
        return LoginResponse(auth_result=_auth_result_to_proto(outcome))
    if isinstance(outcome, MfaChallengeRequired):
        return LoginResponse(
            mfa_challenge=MfaChallengeProto(
                challenge_token=outcome.challenge_token,
                methods=list(outcome.methods),
            )
        )
    enrollment = EnrollmentRequiredProto(
        enrollment_token=outcome.enrollment_token,
    )
    if outcome.grace_expires_at is not None:
        enrollment.grace_expires_at.CopyFrom(datetime_to_timestamp(outcome.grace_expires_at))
    return LoginResponse(enrollment_required=enrollment)


class AuthHandlers:
    """Auth RPC handlers - authentication only."""

    async def register(
        self,
        request: RegisterRequest,
        ctx: RequestContext,
    ) -> RegisterResponse:
        """Register a new user."""
        try:
            user_agent = request_user_agent(ctx)

            async with open_session() as session:
                auth_ops = AuthOperations(session)
                result = await auth_ops.register(
                    email=request.email,
                    username=request.username,
                    password=request.password,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    user_agent=user_agent,
                )

                asset_cookie = _set_asset_cookie(ctx, result)
                return RegisterResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_slug=result.organization_slug or "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
                    domain_admin_domains=_domain_admins_to_proto(result),
                    asset_cookie=asset_cookie,
                )
        except RegistrationError as e:
            logger.warning(f"Registration failed: {e}")
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Registration error: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def login(
        self,
        request: LoginRequest,
        ctx: RequestContext,
    ) -> LoginResponse:
        """Authenticate user."""
        try:
            user_agent = request_user_agent(ctx)

            async with open_session() as session:
                auth_ops = AuthOperations(session)
                result = await auth_ops.authenticate(
                    email=request.email,
                    password=request.password,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                    user_agent=user_agent,
                )

                response = _login_outcome_to_proto(result)
                if isinstance(result, AuthResult):
                    response.auth_result.asset_cookie = _set_asset_cookie(ctx, result)
                return response
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except AuthenticationError as e:
            logger.warning("Login failed: {}", e)
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.opt(exception=True).error("Login error: {}", e)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def refresh_token(
        self,
        request: RefreshTokenRequest,
        ctx: RequestContext,
    ) -> RefreshTokenResponse:
        """Refresh access token."""
        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                result = await auth_ops.refresh_token(
                    refresh_token=request.refresh_token,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                )

                asset_cookie = _set_asset_cookie(ctx, result)
                return RefreshTokenResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_slug=result.organization_slug or "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
                    domain_admin_domains=_domain_admins_to_proto(result),
                    asset_cookie=asset_cookie,
                )
        except TokenError as e:
            logger.warning(f"Token refresh failed: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.exception(f"Token refresh error: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def switch_organization(
        self,
        request: SwitchOrganizationRequest,
        ctx: RequestContext,
    ) -> SwitchOrganizationResponse:
        """Move the current session into a different organization."""
        if not request.refresh_token:
            raise ConnectError(Code.INVALID_ARGUMENT, "refresh_token is required")
        if not request.organization_slug:
            raise ConnectError(Code.INVALID_ARGUMENT, "organization_slug is required")
        try:
            user_agent = request_user_agent(ctx)
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                result = await auth_ops.switch_organization(
                    refresh_token=request.refresh_token,
                    organization_slug=request.organization_slug,
                    user_agent=user_agent,
                )
                auth_result = _auth_result_to_proto(result)
                auth_result.asset_cookie = _set_asset_cookie(ctx, result)
                return SwitchOrganizationResponse(auth_result=auth_result)
        except AuthenticationError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except TokenError as e:
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.exception(f"Switch organization error: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_current_user(
        self,
        request: GetCurrentUserRequest,
        ctx: RequestContext,
    ) -> GetCurrentUserResponse:
        """Get current authenticated user info."""
        user_id = current_user_id()

        try:
            async with open_session() as session:
                user = await get_user_by_id(session, user_id)
                return user_to_proto(user)
        except Exception as e:
            logger.exception(f"Error fetching user: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def logout(
        self,
        request: LogoutRequest,
        ctx: RequestContext,
    ) -> LogoutResponse:
        """Logout the user; revokes the session derived from refresh or access token."""
        try:
            session_id: UUID | None = None
            user_id: UUID | None = None

            if request.HasField("refresh_token") and request.refresh_token:
                try:
                    payload = decode_refresh_token(request.refresh_token)
                    sid = payload.get("sid")
                    if sid:
                        session_id = UUID(sid)
                    user_id = UUID(payload["sub"])
                except Exception:
                    pass

            if not session_id:
                session_id = current_session_id()
            if not user_id:
                with contextlib.suppress(ConnectError):
                    user_id = current_user_id()

            if session_id and user_id:
                async with open_session() as session:
                    auth_ops = AuthOperations(session)
                    await auth_ops.logout_session(user_id, session_id)

            _clear_asset_cookie(ctx)
            return LogoutResponse(success=True)
        except Exception as e:
            # Logout never surfaces failure to the user; log a single line
            # without the full traceback so routine "no session to revoke"
            # cases stay quiet in ops logs.
            logger.warning(f"Logout error: {e}")
            return LogoutResponse(success=True)

    async def list_sessions(
        self,
        request: ListSessionsRequest,
        ctx: RequestContext,
    ) -> ListSessionsResponse:
        """List active sessions for the current user."""
        user_id = current_user_id()
        session_id = current_session_id()

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                sessions = await auth_ops.list_sessions(user_id)

                return ListSessionsResponse(
                    sessions=[session_to_proto(s, session_id) for s in sessions]
                )
        except Exception as e:
            logger.exception(f"Error listing sessions: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_session(
        self,
        request: RevokeSessionRequest,
        ctx: RequestContext,
    ) -> RevokeSessionResponse:
        """Revoke a specific session."""
        user_id = current_user_id()

        try:
            target_session_id = UUID(request.session_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid session ID")

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                await auth_ops.revoke_session(user_id, target_session_id)
                return RevokeSessionResponse(success=True)
        except TokenError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error revoking session: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_other_sessions(
        self,
        request: RevokeOtherSessionsRequest,
        ctx: RequestContext,
    ) -> RevokeOtherSessionsResponse:
        """Revoke all sessions except the current one."""
        user_id = current_user_id()
        session_id = current_session_id()

        if not session_id:
            raise ConnectError(
                Code.FAILED_PRECONDITION,
                "Current session not identified (old token without session tracking)",
            )

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                revoked_count = await auth_ops.revoke_other_sessions(user_id, session_id)
                return RevokeOtherSessionsResponse(revoked_count=revoked_count)
        except Exception as e:
            logger.exception(f"Error revoking other sessions: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_cache_key_seed(
        self,
        request: GetCacheKeySeedRequest,
        ctx: RequestContext,
    ) -> GetCacheKeySeedResponse:
        """Get cache key seed for client-side storage encryption."""
        user_id = current_user_id()

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                seed = await auth_ops.get_cache_key_seed(user_id)
                return GetCacheKeySeedResponse(cache_key_seed=seed)
        except AuthenticationError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.exception(f"Error fetching cache key seed: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def rotate_cache_key_seed(
        self,
        request: RotateCacheKeySeedRequest,
        ctx: RequestContext,
    ) -> RotateCacheKeySeedResponse:
        """Rotate cache key seed, invalidating all device caches."""
        user_id = current_user_id()

        target_user_id = None
        if request.HasField("target_user_id") and request.target_user_id:
            try:
                target_user_id = UUID(request.target_user_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid target_user_id")

            # Admin action: verify caller is system admin
            if target_user_id != user_id:
                try:
                    async with open_session() as session:
                        await require_system_admin(session, user_id)
                except Exception:
                    raise ConnectError(
                        Code.PERMISSION_DENIED,
                        "Only system admins can rotate another user's cache key seed",
                    )

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                new_seed = await auth_ops.rotate_cache_key_seed(user_id, target_user_id)
                return RotateCacheKeySeedResponse(new_cache_key_seed=new_seed)
        except Exception as e:
            logger.exception(f"Error rotating cache key seed: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_auth_config(
        self,
        request: GetAuthConfigRequest,
        ctx: RequestContext,
    ) -> GetAuthConfigResponse:
        """Public auth configuration the login / register pages need."""
        del request, ctx
        async with open_session() as session:
            enabled = await public_registration_enabled(session)
        return GetAuthConfigResponse(public_registration_enabled=enabled)

    async def get_invitation(
        self,
        request: GetInvitationRequest,
        ctx: RequestContext,
    ) -> GetInvitationResponse:
        """Preview an invitation by token (un-authenticated)."""
        if not request.token:
            raise ConnectError(Code.INVALID_ARGUMENT, "token is required")
        try:
            async with open_session() as session:
                ops = InvitationOperations(session)
                preview = await ops.get_for_token(request.token)
                response = GetInvitationResponse(
                    email=preview.invitation.email,
                    organization_id=str(preview.organization.id),
                    organization_name=preview.organization.name,
                    organization_slug=preview.organization.slug,
                    role=org_role_to_proto(preview.invitation.role),
                    expires_at=datetime_to_timestamp(preview.invitation.expires_at),
                )
                if preview.inviter_display_name:
                    response.inviter_display_name = preview.inviter_display_name
                return response
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except InvitationNotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except (
            InvitationExpiredError,
            InvitationRevokedError,
            InvitationAlreadyUsedError,
        ) as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except Exception as e:
            logger.exception(f"Error fetching invitation: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def accept_invitation(
        self,
        request: AcceptInvitationRequest,
        ctx: RequestContext,
    ) -> AcceptInvitationResponse:
        """Consume an invitation token; creates the user + membership.

        Returns the ``auth_result`` variant on a steady-state success, or
        the ``enrollment_required`` variant when the org/platform
        mandates MFA before the account is usable.
        """
        if not request.token:
            raise ConnectError(Code.INVALID_ARGUMENT, "token is required")
        user_agent = request_user_agent(ctx)
        try:
            async with open_session() as session:
                ops = InvitationOperations(session)
                outcome = await ops.accept(
                    raw_token=request.token,
                    username=request.username,
                    password=request.password,
                    full_name=(request.full_name if request.HasField("full_name") else None),
                    user_agent=user_agent,
                )
                if isinstance(outcome, MfaEnrollmentRequired):
                    enrollment = EnrollmentRequiredProto(
                        enrollment_token=outcome.enrollment_token,
                    )
                    if outcome.grace_expires_at is not None:
                        enrollment.grace_expires_at.CopyFrom(
                            datetime_to_timestamp(outcome.grace_expires_at)
                        )
                    return AcceptInvitationResponse(enrollment_required=enrollment)
                auth_result = _auth_result_to_proto(outcome)
                auth_result.asset_cookie = _set_asset_cookie(ctx, outcome)
                return AcceptInvitationResponse(auth_result=auth_result)
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except InvitationNotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except (
            InvitationExpiredError,
            InvitationRevokedError,
            InvitationAlreadyUsedError,
            InvitationEmailConflictError,
        ) as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.exception(f"Error accepting invitation: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def send_password_reset(
        self,
        request: SendPasswordResetRequest,
        ctx: RequestContext,
    ) -> SendPasswordResetResponse:
        """Trigger a password reset email; surfaces rate-limit, swallows the rest.

        Rate-limit responses MUST surface so the caller can back off. Any
        other failure is hidden behind a generic success to keep email
        enumeration impossible.
        """
        try:
            async with open_session() as session:
                ops = PasswordResetOperations(session)
                await ops.request(
                    email=request.email,
                    requested_ip=audit_ip_var.get(),
                )
        except RateLimitExceededError as exc:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(exc))
        except Exception as e:
            # Swallowed by design (no enumeration); log one line, not a
            # traceback that fills ops dashboards with routine SMTP hiccups.
            logger.warning(f"Password reset request error: {e}")
        return SendPasswordResetResponse()

    async def verify_password_reset_token(
        self,
        request: VerifyPasswordResetTokenRequest,
        ctx: RequestContext,
    ) -> VerifyPasswordResetTokenResponse:
        """Preview a reset token without consuming it."""
        if not request.token:
            raise ConnectError(Code.INVALID_ARGUMENT, "token is required")
        try:
            async with open_session() as session:
                ops = PasswordResetOperations(session)
                preview = await ops.verify(request.token)
                return VerifyPasswordResetTokenResponse(
                    email=preview.email,
                    expires_at=datetime_to_timestamp(preview.expires_at),
                )
        except RateLimitExceededError as e:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(e))
        except PasswordResetTokenNotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except (PasswordResetTokenExpiredError, PasswordResetTokenUsedError) as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except PasswordResetError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))

    async def reset_password(
        self,
        request: ResetPasswordRequest,
        ctx: RequestContext,
    ) -> ResetPasswordResponse:
        """Apply a new password using a single-use reset token."""
        if not request.token:
            raise ConnectError(Code.INVALID_ARGUMENT, "token is required")
        try:
            async with open_session() as session:
                ops = PasswordResetOperations(session)
                await ops.consume(request.token, request.new_password)
                return ResetPasswordResponse(success=True)
        except RateLimitExceededError as exc:
            raise ConnectError(Code.RESOURCE_EXHAUSTED, str(exc))
        except PasswordResetTokenNotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except (PasswordResetTokenExpiredError, PasswordResetTokenUsedError) as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PasswordResetError as e:
            raise ConnectError(Code.FAILED_PRECONDITION, str(e))
        except Exception as e:
            logger.exception(f"Error resetting password: {e}")
            raise ConnectError(Code.INTERNAL, "Internal server error")
