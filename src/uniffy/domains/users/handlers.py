"""Users RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.common.v1.common_pb2 import MemberInfo, PaginationResponse
from uniffy_proto.users.v1.users_pb2 import (
    AddUserToOrganizationRequest,
    CreateUserRequest,
    DeleteAvatarRequest,
    DeleteUserRequest,
    DeleteUserResponse,
    GetMyProfileRequest,
    GetUserRequest,
    ListUserOrganizationsRequest,
    ListUserOrganizationsResponse,
    ListUsersRequest,
    ListUsersResponse,
    RemoveUserFromOrganizationRequest,
    RemoveUserFromOrganizationResponse,
    UpdateMyProfileRequest,
    UpdateUserRequest,
    UploadAvatarRequest,
    UserProfile,
)

from uniffy.core.converters import member_info_to_proto, org_role_from_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.auth.passwords import hash_password
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.converters import membership_to_proto, user_to_profile
from uniffy.domains.users.operations import UserOperations


class UsersHandlers:
    """Users RPC handlers."""

    async def get_my_profile(
        self,
        request: GetMyProfileRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Get current authenticated user's profile."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                user = await ops.get_by_id(user_id)
                return user_to_profile(user)
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error fetching user profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_my_profile(
        self,
        request: UpdateMyProfileRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Update current user's profile."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                user = await ops.update_profile(
                    user_id=user_id,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    username=request.username if request.HasField("username") else None,
                    accent_color=request.accent_color if request.HasField("accent_color") else None,
                    font_family=request.font_family if request.HasField("font_family") else None,
                )
                return user_to_profile(user)
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error updating profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def upload_avatar(
        self,
        request: UploadAvatarRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Upload user avatar image."""
        user_id = get_user_id_from_context(ctx)

        if not request.image_data:
            raise ConnectError(Code.INVALID_ARGUMENT, "Image data is required")
        if not request.filename:
            raise ConnectError(Code.INVALID_ARGUMENT, "Filename is required")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                user = await ops.upload_avatar(
                    user_id=user_id,
                    image_data=request.image_data,
                    filename=request.filename,
                )
                return user_to_profile(user)
        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error uploading avatar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_avatar(
        self,
        request: DeleteAvatarRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Delete user avatar."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                user = await ops.delete_avatar(user_id)
                return user_to_profile(user)
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error deleting avatar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_users(
        self,
        request: ListUsersRequest,
        ctx: RequestContext,
    ) -> ListUsersResponse:
        """List all users (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                page = 1
                page_size = 20
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = (
                        request.pagination.page_size if request.pagination.page_size > 0 else 20
                    )

                users, total = await ops.list_all(
                    page=page,
                    page_size=page_size,
                    query_str=request.search if request.HasField("search") else None,
                    include_inactive=(
                        request.include_inactive if request.HasField("include_inactive") else False
                    ),
                )

                total_pages = (total + page_size - 1) // page_size

                return ListUsersResponse(
                    users=[user_to_profile(u) for u in users],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error listing users: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_user(
        self,
        request: GetUserRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Get user by ID (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                user = await ops.get_by_id(target_user_id)
                return user_to_profile(user)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error fetching user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_user(
        self,
        request: CreateUserRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Create a new user (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        if not request.email or not request.password:
            raise ConnectError(Code.INVALID_ARGUMENT, "Email and password are required")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                # Check if email already exists
                existing = await ops.get_by_email(request.email)
                if existing:
                    raise ConnectError(Code.ALREADY_EXISTS, "Email already registered")

                # Generate username from email if not provided
                if request.HasField("username"):
                    username = request.username
                else:
                    username = request.email.split("@")[0]

                hashed_pw = hash_password(request.password)
                user = await ops.admin_create(
                    email=request.email,
                    username=username,
                    hashed_password=hashed_pw,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    is_system_admin=request.is_system_admin,
                )
                return user_to_profile(user)
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error creating user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_user(
        self,
        request: UpdateUserRequest,
        ctx: RequestContext,
    ) -> UserProfile:
        """Update user details (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                # Hash password if provided
                hashed_pw = None
                if request.HasField("password") and request.password:
                    hashed_pw = hash_password(request.password)

                user = await ops.admin_update(
                    user_id=target_user_id,
                    email=request.email if request.HasField("email") else None,
                    full_name=request.full_name if request.HasField("full_name") else None,
                    username=request.username if request.HasField("username") else None,
                    is_active=(request.is_active if request.HasField("is_active") else None),
                    is_system_admin=(
                        request.is_system_admin if request.HasField("is_system_admin") else None
                    ),
                    hashed_password=hashed_pw,
                )
                return user_to_profile(user)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error updating user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_user(
        self,
        request: DeleteUserRequest,
        ctx: RequestContext,
    ) -> DeleteUserResponse:
        """Delete a user (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id")

        # Prevent self-deletion
        if target_user_id == user_id:
            raise ConnectError(Code.INVALID_ARGUMENT, "Cannot delete yourself")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                await ops.delete(target_user_id)
                return DeleteUserResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error deleting user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_user_organizations(
        self,
        request: ListUserOrganizationsRequest,
        ctx: RequestContext,
    ) -> ListUserOrganizationsResponse:
        """List organizations for a specific user (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                orgs_with_memberships = await org_ops.get_user_organizations(target_user_id)

                return ListUserOrganizationsResponse(
                    memberships=[
                        membership_to_proto(org, membership)
                        for org, membership in orgs_with_memberships
                    ]
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error listing user organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_user_to_organization(
        self,
        request: AddUserToOrganizationRequest,
        ctx: RequestContext,
    ) -> MemberInfo:
        """Add user to organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            target_user_id = UUID(request.user_id)
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id or organization_id")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                # Get the user to add
                target_user = await ops.get_by_id(target_user_id)

                # Convert role from proto
                role = org_role_from_proto(request.role)
                if role is None:
                    from uniffy.core.models.login.organization_member import OrganizationRole

                    role = OrganizationRole.MEMBER

                org_ops = OrganizationOperations(session)
                membership = await org_ops.add_member(target_user_id, org_id, role)

                return member_info_to_proto(target_user, membership)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error adding user to organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_user_from_organization(
        self,
        request: RemoveUserFromOrganizationRequest,
        ctx: RequestContext,
    ) -> RemoveUserFromOrganizationResponse:
        """Remove user from organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            target_user_id = UUID(request.user_id)
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user_id or organization_id")

        try:
            async for session in get_async_session():
                ops = UserOperations(session)
                await ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                await org_ops.remove_member(target_user_id, org_id)

                return RemoveUserFromOrganizationResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error removing user from organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
