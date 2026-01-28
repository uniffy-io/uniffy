"""Auth RPC handlers - thin layer delegating to operations."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.auth.converters import user_to_proto
from uniffy.domains.auth.errors import (
    AuthenticationError,
    RegistrationError,
    TokenError,
)
from uniffy.domains.auth.operations import AuthOperations
from uniffy.domains.users.operations import UserOperations
from uniffy.gen.auth.v1.auth_pb2 import (
    AuthResponse,
    CurrentUserResponse,
    GetCurrentUserRequest,
    LoginRequest,
    LogoutRequest,
    LogoutResponse,
    RefreshTokenRequest,
    RegisterRequest,
)


class AuthHandlers:
    """Auth RPC handlers - authentication only."""

    async def register(
        self,
        request: RegisterRequest,
        ctx: RequestContext,
    ) -> AuthResponse:
        """Register a new user."""
        try:
            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                result = await auth_ops.register(
                    email=request.email,
                    username=request.username,
                    password=request.password,
                    full_name=request.full_name if request.HasField("full_name") else None,
                )

                return AuthResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
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
    ) -> AuthResponse:
        """Authenticate user."""
        try:
            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                result = await auth_ops.authenticate(
                    email=request.email,
                    password=request.password,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                )

                return AuthResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
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
    ) -> AuthResponse:
        """Refresh access token."""
        try:
            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                result = await auth_ops.refresh_token(
                    refresh_token=request.refresh_token,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                )

                return AuthResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
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
    ) -> CurrentUserResponse:
        """Get current authenticated user info."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
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
        Logout user (invalidate tokens).

        Note: Token invalidation is primarily client-side (discard tokens).
        Server-side invalidation requires incrementing token_version.
        """
        # For now, logout is primarily client-side
        # Future: increment token_version to invalidate all user tokens
        return LogoutResponse(success=True)
