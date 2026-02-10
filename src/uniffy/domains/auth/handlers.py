"""Auth RPC handlers - thin layer delegating to operations."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.db import get_async_session
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
from uniffy.domains.users.operations import UserOperations
from uniffy.gen.auth.v1.auth_pb2 import (
    AuthResponse,
    CurrentUserResponse,
    GetCurrentUserRequest,
    ListSessionsRequest,
    ListSessionsResponse,
    LoginRequest,
    LogoutRequest,
    LogoutResponse,
    RefreshTokenRequest,
    RegisterRequest,
    RevokeOtherSessionsRequest,
    RevokeOtherSessionsResponse,
    RevokeSessionRequest,
    RevokeSessionResponse,
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
            user_agent = get_user_agent_from_context(ctx)

            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                result = await auth_ops.register(
                    email=request.email,
                    username=request.username,
                    password=request.password,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    user_agent=user_agent,
                )

                return AuthResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
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
            user_agent = get_user_agent_from_context(ctx)

            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                result = await auth_ops.authenticate(
                    email=request.email,
                    password=request.password,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                    user_agent=user_agent,
                )

                return AuthResponse(
                    access_token=result.access_token,
                    refresh_token=result.refresh_token,
                    token_type="bearer",
                    user_id=str(result.user_id),
                    organization_id=str(result.organization_id) if result.organization_id else "",
                    organization_role=result.organization_role or "",
                    session_id=str(result.session_id) if result.session_id else "",
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
                    session_id=str(result.session_id) if result.session_id else "",
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
                async for session in get_async_session():
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
            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                sessions = await auth_ops.list_sessions(user_id)

                return ListSessionsResponse(
                    sessions=[
                        session_to_proto(s, current_session_id)
                        for s in sessions
                    ]
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
            async for session in get_async_session():
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
            async for session in get_async_session():
                auth_ops = AuthOperations(session)
                revoked_count = await auth_ops.revoke_other_sessions(
                    user_id, current_session_id
                )
                return RevokeOtherSessionsResponse(revoked_count=revoked_count)
        except Exception as e:
            logger.error(f"Error revoking other sessions: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
