"""Auth RPC handlers - thin layer delegating to operations."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.auth.v1.auth_pb2 import (
    GetCacheKeySeedRequest,
    GetCacheKeySeedResponse,
    GetCurrentUserRequest,
    GetCurrentUserResponse,
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
    RevokeOtherSessionsRequest,
    RevokeOtherSessionsResponse,
    RevokeSessionRequest,
    RevokeSessionResponse,
    RotateCacheKeySeedRequest,
    RotateCacheKeySeedResponse,
)

from uniffy.core.converters import domain_type_to_proto
from uniffy.core.models.shared import DomainType
from uniffy.db import open_session
from uniffy.domains.auth.context import (
    get_session_id_from_context,
    get_user_agent_from_context,
    get_user_id_from_context,
)
from uniffy.domains.auth.converters import session_to_proto, user_to_proto
from uniffy.domains.auth.errors import (
    AuthenticationError,
    RegistrationError,
    TokenError,
)
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.auth.tokens import decode_access_token
from uniffy.domains.auth.types import AuthResult


def _domain_admins_to_proto(result: AuthResult) -> list[int]:
    """Convert AuthResult domain_admin_domains to proto enum values."""
    if not result.domain_admin_domains:
        return []
    values = []
    for d in result.domain_admin_domains:
        with contextlib.suppress(ValueError):
            values.append(domain_type_to_proto(DomainType(d)))
    return values


class AuthHandlers:
    """Auth RPC handlers - authentication only."""

    async def register(
        self,
        request: RegisterRequest,
        ctx: RequestContext,
    ) -> RegisterResponse:
        """Register a new user."""
        try:
            user_agent = get_user_agent_from_context(ctx)

            async with open_session() as session:
                auth_ops = AuthOperations(session)
                result = await auth_ops.register(
                    email=request.email,
                    username=request.username,
                    password=request.password,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    user_agent=user_agent,
                )

                return RegisterResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
                    domain_admin_domains=_domain_admins_to_proto(result),
                )
        except RegistrationError as e:
            logger.warning(f"Registration failed: {e}")
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.error(f"Registration error: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def login(
        self,
        request: LoginRequest,
        ctx: RequestContext,
    ) -> LoginResponse:
        """Authenticate user."""
        try:
            user_agent = get_user_agent_from_context(ctx)

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

                return LoginResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
                    domain_admin_domains=_domain_admins_to_proto(result),
                )
        except AuthenticationError as e:
            logger.warning(f"Login failed: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.error(f"Login error: {e}", exc_info=True)
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

                return RefreshTokenResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
                    domain_admin_domains=_domain_admins_to_proto(result),
                )
        except TokenError as e:
            logger.warning(f"Token refresh failed: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.error(f"Token refresh error: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_current_user(
        self,
        request: GetCurrentUserRequest,
        ctx: RequestContext,
    ) -> GetCurrentUserResponse:
        """Get current authenticated user info."""
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                from uniffy.domains.users.operations import UserOperations

                user_ops = UserOperations(session)
                user = await user_ops.get_by_id(user_id)
                return user_to_proto(user)
        except Exception as e:
            logger.error(f"Error fetching user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def logout(
        self,
        request: LogoutRequest,
        ctx: RequestContext,
    ) -> LogoutResponse:
        """
        Logout user - revoke session server-side.

        If the client sends a refresh_token, we extract the session_id from it
        and revoke that session. Otherwise we try to get session_id from the
        access token in the Authorization header.
        """
        try:
            session_id: UUID | None = None
            user_id: UUID | None = None

            # Try to extract session_id from refresh_token first
            if request.HasField("refresh_token") and request.refresh_token:
                try:
                    payload = decode_access_token(request.refresh_token)
                    sid = payload.get("sid")
                    if sid:
                        session_id = UUID(sid)
                    user_id = UUID(payload["sub"])
                except Exception:
                    pass

            # Fallback: get from access token in context
            if not session_id:
                session_id = get_session_id_from_context(ctx)
            if not user_id:
                with contextlib.suppress(ConnectError):
                    user_id = get_user_id_from_context(ctx)

            if session_id and user_id:
                async with open_session() as session:
                    auth_ops = AuthOperations(session)
                    await auth_ops.logout_session(user_id, session_id)

            return LogoutResponse(success=True)
        except Exception as e:
            logger.error(f"Logout error: {e}", exc_info=True)
            # Logout should not fail from user perspective
            return LogoutResponse(success=True)

    async def list_sessions(
        self,
        request: ListSessionsRequest,
        ctx: RequestContext,
    ) -> ListSessionsResponse:
        """List active sessions for the current user."""
        user_id = get_user_id_from_context(ctx)
        current_session_id = get_session_id_from_context(ctx)

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                sessions = await auth_ops.list_sessions(user_id)

                return ListSessionsResponse(
                    sessions=[session_to_proto(s, current_session_id) for s in sessions]
                )
        except Exception as e:
            logger.error(f"Error listing sessions: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_session(
        self,
        request: RevokeSessionRequest,
        ctx: RequestContext,
    ) -> RevokeSessionResponse:
        """Revoke a specific session."""
        user_id = get_user_id_from_context(ctx)

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
            logger.error(f"Error revoking session: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_other_sessions(
        self,
        request: RevokeOtherSessionsRequest,
        ctx: RequestContext,
    ) -> RevokeOtherSessionsResponse:
        """Revoke all sessions except the current one."""
        user_id = get_user_id_from_context(ctx)
        current_session_id = get_session_id_from_context(ctx)

        if not current_session_id:
            raise ConnectError(
                Code.FAILED_PRECONDITION,
                "Current session not identified (old token without session tracking)",
            )

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                revoked_count = await auth_ops.revoke_other_sessions(user_id, current_session_id)
                return RevokeOtherSessionsResponse(revoked_count=revoked_count)
        except Exception as e:
            logger.error(f"Error revoking other sessions: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_cache_key_seed(
        self,
        request: GetCacheKeySeedRequest,
        ctx: RequestContext,
    ) -> GetCacheKeySeedResponse:
        """Get cache key seed for client-side storage encryption."""
        user_id = get_user_id_from_context(ctx)

        try:
            async with open_session() as session:
                auth_ops = AuthOperations(session)
                seed = await auth_ops.get_cache_key_seed(user_id)
                return GetCacheKeySeedResponse(cache_key_seed=seed)
        except AuthenticationError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error fetching cache key seed: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def rotate_cache_key_seed(
        self,
        request: RotateCacheKeySeedRequest,
        ctx: RequestContext,
    ) -> RotateCacheKeySeedResponse:
        """Rotate cache key seed, invalidating all device caches."""
        user_id = get_user_id_from_context(ctx)

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
                        from uniffy.domains.users.operations import UserOperations

                        user_ops = UserOperations(session)
                        await user_ops.require_system_admin(user_id)
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
            logger.error(f"Error rotating cache key seed: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
