"""Auth RPC handlers - thin layer delegating to operations."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uwos.core.models.login.organization_member import OrganizationRole
from uwos.db import get_async_session
from uwos.domains.auth.context import get_user_id_from_context
from uwos.domains.auth.converters import (
    organization_to_proto,
    user_to_proto,
)
from uwos.domains.auth.errors import (
    AuthenticationError,
    RegistrationError,
    TokenError,
)
from uwos.domains.auth.operations import AuthOperations
from uwos.domains.auth.orgs import OrganizationOperations
from uwos.domains.auth.passwords import hash_password
from uwos.domains.auth.users import UserOperations
from uwos.gen.auth.v1.auth_pb2 import (
    AdminCreateUserRequest,
    AdminUserListResponse,
    AuthResponse,
    GetCurrentUserRequest,
    ListAllUsersRequest,
    ListMyOrganizationsRequest,
    LoginRequest,
    OrganizationListResponse,
    RefreshTokenRequest,
    RegisterRequest,
    UpdateMyProfileRequest,
    UpdateUserRequest,
    UserInfoResponse,
)


class AuthHandlers:
    """Auth RPC handlers."""

    # -------------------------------------------------------------------------
    # Authentication
    # -------------------------------------------------------------------------

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
                )
        except TokenError as e:
            logger.warning(f"Token refresh failed: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, str(e))
        except Exception as e:
            logger.error(f"Token refresh error: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # -------------------------------------------------------------------------
    # User self-service
    # -------------------------------------------------------------------------

    async def get_current_user(
        self,
        request: GetCurrentUserRequest,
        ctx: RequestContext,
    ) -> UserInfoResponse:
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

    async def update_my_profile(
        self,
        request: UpdateMyProfileRequest,
        ctx: RequestContext,
    ) -> UserInfoResponse:
        """Update current user's profile."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                user = await user_ops.update_profile(
                    user_id=user_id,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    accent_color=request.accent_color if request.HasField("accent_color") else None,
                    font_family=request.font_family if request.HasField("font_family") else None,
                )
                return user_to_proto(user)
        except Exception as e:
            logger.error(f"Error updating profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_my_organizations(
        self,
        request: ListMyOrganizationsRequest,
        ctx: RequestContext,
    ) -> OrganizationListResponse:
        """List organizations the current user belongs to."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                org_ops = OrganizationOperations(session)
                orgs_with_memberships = await org_ops.get_user_organizations(user_id)

                return OrganizationListResponse(
                    organizations=[
                        organization_to_proto(org, membership)
                        for org, membership in orgs_with_memberships
                    ]
                )
        except Exception as e:
            logger.error(f"Error listing organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # -------------------------------------------------------------------------
    # System Admin - Users
    # -------------------------------------------------------------------------

    async def list_all_users(
        self,
        request: ListAllUsersRequest,
        ctx: RequestContext,
    ) -> AdminUserListResponse:
        """List all users (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                users, total = await user_ops.list_all(
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return AdminUserListResponse(
                    users=[user_to_proto(u) for u in users],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing users: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_create_user(
        self,
        request: AdminCreateUserRequest,
        ctx: RequestContext,
    ) -> UserInfoResponse:
        """Create a new user (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                hashed_pw = hash_password(request.password)
                user = await user_ops.admin_create(
                    email=request.email,
                    username=request.username,
                    hashed_password=hashed_pw,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    is_active=request.is_active,
                    is_system_admin=request.is_system_admin,
                    email_verified=request.email_verified,
                )

                # Add to organization if requested
                if request.HasField("organization_id"):
                    org_ops = OrganizationOperations(session)
                    role = OrganizationRole.MEMBER
                    if request.HasField("organization_role"):
                        with contextlib.suppress(ValueError):
                            role = OrganizationRole(request.organization_role.lower())
                    await org_ops.add_member(user.id, UUID(request.organization_id), role)

                return user_to_proto(user)
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_user(
        self,
        request: UpdateUserRequest,
        ctx: RequestContext,
    ) -> UserInfoResponse:
        """Update user details (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                user = await user_ops.admin_update(
                    user_id=UUID(request.user_id),
                    full_name=request.full_name if request.HasField("full_name") else None,
                    username=request.username if request.HasField("username") else None,
                    email=request.email if request.HasField("email") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                    is_system_admin=(
                        request.is_system_admin if request.HasField("is_system_admin") else None
                    ),
                    email_verified=(
                        request.email_verified if request.HasField("email_verified") else None
                    ),
                    accent_color=request.accent_color if request.HasField("accent_color") else None,
                )

                return user_to_proto(user)
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
