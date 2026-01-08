"""Authentication service implementation for ConnectRPC."""

import logging

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext

from uwos.auth.jwt import decode_access_token
from uwos.auth.service import (
    AuthenticationError,
    authenticate_user,
    refresh_access_token,
    register_user,
)
from uwos.db import get_async_session
from uwos.gen.auth.v1.auth_pb2 import (
    AuthResponse,
    GetCurrentUserRequest,
    LoginRequest,
    RefreshTokenRequest,
    RegisterRequest,
    UserInfoResponse,
)
from uwos.repositories.user import get_user_by_id

logger = logging.getLogger(__name__)


class AuthServiceImpl:
    """
    Implementation of AuthService.

    Provides authentication and user management via ConnectRPC.
    """

    async def register(self, request: RegisterRequest, ctx: RequestContext) -> AuthResponse:
        """
        Register a new user.

        Parameters
        ----------
        request : RegisterRequest
            Registration request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        AuthResponse
            Authentication tokens and user info.

        """
        try:
            async for session in get_async_session():
                response = await register_user(
                    session,
                    email=request.email,
                    username=request.username,
                    password=request.password,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                )

                return AuthResponse(
                    access_token=response.access_token,
                    refresh_token=response.refresh_token,
                    token_type="bearer",
                    user_id=str(response.user_id),
                    organization_id=(
                        str(response.organization_id) if response.organization_id else ""
                    ),
                )

        except AuthenticationError as e:
            logger.warning(f"Registration failed: {e}")
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except Exception as e:
            logger.error(f"Registration error: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def login(self, request: LoginRequest, ctx: RequestContext) -> AuthResponse:
        """
        Authenticate user with email and password.

        Parameters
        ----------
        request : LoginRequest
            Login credentials.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        AuthResponse
            Authentication tokens and user info.

        """
        try:
            async for session in get_async_session():
                response = await authenticate_user(
                    session,
                    email=request.email,
                    password=request.password,
                    organization_slug=(
                        request.organization_slug if request.HasField("organization_slug") else None
                    ),
                )

                return AuthResponse(
                    access_token=response.access_token,
                    refresh_token=response.refresh_token,
                    token_type="bearer",
                    user_id=str(response.user_id),
                    organization_id=(
                        str(response.organization_id) if response.organization_id else ""
                    ),
                )

        except AuthenticationError as e:
            logger.warning(f"Login failed: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.error(f"Login error: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def refresh_token(self, request: RefreshTokenRequest, ctx: RequestContext) -> AuthResponse:
        """
        Refresh access token.

        Parameters
        ----------
        request : RefreshTokenRequest
            Refresh token request.
        ctx : RequestContext
            RPC context.

        Returns
        -------
        AuthResponse
            New authentication tokens.

        """
        try:
            async for session in get_async_session():
                organization_slug = (
                    request.organization_slug if request.HasField("organization_slug") else None
                )

                response = await refresh_access_token(
                    session, request.refresh_token, organization_slug
                )

                return AuthResponse(
                    access_token=response.access_token,
                    refresh_token=response.refresh_token,
                    token_type="bearer",
                    user_id=str(response.user_id),
                    organization_id=(
                        str(response.organization_id) if response.organization_id else ""
                    ),
                )

        except AuthenticationError as e:
            logger.warning(f"Token refresh failed: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.error(f"Token refresh error: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_current_user(
        self, request: GetCurrentUserRequest, ctx: RequestContext
    ) -> UserInfoResponse:
        """
        Get current authenticated user info.

        Parameters
        ----------
        request : GetCurrentUserRequest
            Request (empty).
        ctx : RequestContext
            RPC context with authentication header.

        Returns
        -------
        UserInfoResponse
            Current user information.

        """
        # Extract token from Authorization header
        # request_headers is a callable method that returns Headers
        headers = ctx.request_headers()

        # Debug: Log all headers
        logger.info(f"Request headers: {dict(headers.items())}")

        auth_header = headers.get("authorization", "")
        logger.info(f"Authorization header value: '{auth_header}'")

        if not auth_header.startswith("Bearer "):
            raise ConnectError(Code.UNAUTHENTICATED, "Missing or invalid authorization header")

        token = auth_header[7:]  # Remove "Bearer " prefix

        try:
            payload = decode_access_token(token)
            user_id = payload["sub"]
        except Exception as e:
            logger.warning(f"Invalid token: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, f"Invalid token: {e}")

        try:
            async for session in get_async_session():
                user = await get_user_by_id(session, user_id)
                if not user:
                    raise ConnectError(Code.NOT_FOUND, "User not found")

                return UserInfoResponse(
                    id=str(user.id),
                    email=user.email,
                    username=user.username,
                    full_name=user.full_name or "",
                    is_active=user.is_active,
                    is_system_admin=user.is_system_admin,
                    email_verified=user.email_verified,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error fetching user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
