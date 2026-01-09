"""Authentication service implementation for ConnectRPC."""

import contextlib
import logging
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.auth.jwt import decode_access_token
from uwos.auth.password import hash_password
from uwos.auth.service import (
    AuthenticationError,
    authenticate_user,
    refresh_access_token,
    register_user,
)
from uwos.db import get_async_session
from uwos.gen.auth.v1.auth_pb2 import (
    AddGroupMemberRequest,
    AdminAddUserToOrganizationRequest,
    AdminCreateOrganizationRequest,
    AdminCreateUserRequest,
    AdminListUserOrganizationsRequest,
    AdminOrganizationInfo,
    AdminOrganizationListResponse,
    AdminRemoveUserFromOrganizationRequest,
    AdminUserListResponse,
    AdminUserOrganizationInfo,
    AdminUserOrganizationListResponse,
    AuthResponse,
    CreateGroupRequest,
    DeleteGroupRequest,
    Empty,
    GetCurrentUserRequest,
    GroupInfo,
    GroupListResponse,
    GroupMemberInfo,
    GroupMemberListResponse,
    ListAllOrganizationsRequest,
    ListAllUsersRequest,
    ListGroupMembersRequest,
    ListGroupsRequest,
    ListMyOrganizationsRequest,
    ListOrganizationUsersRequest,
    LoginRequest,
    OrganizationInfo,
    OrganizationListResponse,
    OrganizationUserListResponse,
    RefreshTokenRequest,
    RegisterRequest,
    RemoveGroupMemberRequest,
    UpdateGroupRequest,
    UpdateMyProfileRequest,
    UpdateOrganizationRequest,
    UpdateUserRequest,
    UserInfoResponse,
)
from uwos.models import GroupRole, OrganizationRole
from uwos.repositories.group import (
    add_group_member,
    create_group,
    delete_group,
    get_group_by_id,
    list_group_members,
    list_groups,
    remove_group_member,
    update_group,
)
from uwos.repositories.organization import (
    add_user_to_organization,
    create_organization,
    get_organization_by_id,
    get_user_organization_membership,
    get_user_organizations,
    list_all_organizations,
    list_organization_users,
    remove_user_from_organization,
    update_organization,
)
from uwos.repositories.user import (
    create_user,
    get_user_by_id,
    list_all_users,
    update_user,
)

logger = logging.getLogger(__name__)


class AuthServiceImpl:
    """
    Implementation of AuthService.

    Provides authentication, user management, and group management via ConnectRPC.
    """

    # --- Helpers ---

    def _get_user_id_from_context(self, ctx: RequestContext) -> str:
        """Extract user ID from request context."""
        headers = ctx.request_headers()
        auth_header = headers.get("authorization", "")

        if not auth_header.startswith("Bearer "):
            raise ConnectError(Code.UNAUTHENTICATED, "Missing or invalid authorization header")

        token = auth_header[7:]

        try:
            payload = decode_access_token(token)
            return payload["sub"]
        except Exception as e:
            logger.warning(f"Invalid token: {e}")
            raise ConnectError(Code.UNAUTHENTICATED, f"Invalid token: {e}")

    async def _check_org_admin(self, session: AsyncSession, user_id: str, organization_id: str):
        """
        Verify that the user is an admin or owner of the organization.
        Raises ConnectError(PERMISSION_DENIED) if not.
        """
        membership = await get_user_organization_membership(
            session, UUID(user_id), UUID(organization_id)
        )
        if not membership or membership.role not in (OrganizationRole.OWNER, OrganizationRole.ADMIN):
            raise ConnectError(Code.PERMISSION_DENIED, "Requires organization admin privileges")

    # --- Authentication & User Self-Service ---

    async def register(self, request: RegisterRequest, ctx: RequestContext) -> AuthResponse:
        """Register a new user."""
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
        """Authenticate user."""
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
        """Refresh access token."""
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
        """Get current authenticated user info."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user = await get_user_by_id(session, UUID(user_id))
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
                    accent_color=user.accent_color or "",
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error fetching user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_my_profile(
        self, request: UpdateMyProfileRequest, ctx: RequestContext
    ) -> UserInfoResponse:
        """Update current user's profile (own profile only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user = await update_user(
                    session,
                    UUID(user_id),
                    full_name=request.full_name if request.HasField("full_name") else None,
                    accent_color=request.accent_color if request.HasField("accent_color") else None,
                )

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
                    accent_color=user.accent_color or "",
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating profile: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_my_organizations(
        self, request: ListMyOrganizationsRequest, ctx: RequestContext
    ) -> OrganizationListResponse:
        """List organizations the current user is a member of."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                orgs_with_memberships = await get_user_organizations(session, UUID(user_id))

                return OrganizationListResponse(
                    organizations=[
                        OrganizationInfo(
                            id=str(org.id),
                            name=org.name,
                            slug=org.slug,
                            role=membership.role.value,
                        )
                        for org, membership in orgs_with_memberships
                    ]
                )
        except Exception as e:
            logger.error(f"Error listing organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # --- System Admin Methods ---

    async def list_all_users(
        self, request: ListAllUsersRequest, ctx: RequestContext
    ) -> AdminUserListResponse:
        """List all users (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                admin = await get_user_by_id(session, UUID(user_id))
                if not admin or not admin.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                users, total = await list_all_users(
                    session,
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return AdminUserListResponse(
                    users=[
                        UserInfoResponse(
                            id=str(user.id),
                            email=user.email,
                            username=user.username,
                            full_name=user.full_name or "",
                            is_active=user.is_active,
                            is_system_admin=user.is_system_admin,
                            email_verified=user.email_verified,
                            accent_color=user.accent_color or "",
                        )
                        for user in users
                    ],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing users: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_create_user(
        self, request: AdminCreateUserRequest, ctx: RequestContext
    ) -> UserInfoResponse:
        """Create a new user (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                admin = await get_user_by_id(session, UUID(user_id))
                if not admin or not admin.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                # Hash password
                hashed_password = hash_password(request.password)

                # Create user
                try:
                    user = await create_user(
                        session,
                        email=request.email,
                        username=request.username,
                        hashed_password=hashed_password,
                        full_name=request.full_name if request.HasField("full_name") else None,
                        is_active=request.is_active,
                        is_system_admin=request.is_system_admin,
                        email_verified=request.email_verified,
                    )

                    # Add to organization if requested
                    if request.HasField("organization_id"):
                        try:
                            role = OrganizationRole.MEMBER
                            if request.HasField("organization_role"):
                                with contextlib.suppress(ValueError):
                                    role = OrganizationRole(request.organization_role.lower())

                            await add_user_to_organization(
                                session,
                                user.id,
                                UUID(request.organization_id),
                                role=role,
                            )
                        except Exception as e:
                            logger.warning(f"User created but failed to add to org: {e}")
                            pass

                except Exception as e:
                    logger.warning(f"Failed to create user: {e}")
                    raise ConnectError(Code.ALREADY_EXISTS, f"User creation failed: {e}")

                return UserInfoResponse(
                    id=str(user.id),
                    email=user.email,
                    username=user.username,
                    full_name=user.full_name or "",
                    is_active=user.is_active,
                    is_system_admin=user.is_system_admin,
                    email_verified=user.email_verified,
                    accent_color=user.accent_color or "",
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_user(self, request: UpdateUserRequest, ctx: RequestContext) -> UserInfoResponse:
        """Update user details (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                admin = await get_user_by_id(session, UUID(user_id))
                if not admin or not admin.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                user = await update_user(
                    session,
                    UUID(request.user_id),
                    full_name=request.full_name if request.HasField("full_name") else None,
                    username=request.username if request.HasField("username") else None,
                    email=request.email if request.HasField("email") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                    is_system_admin=request.is_system_admin
                    if request.HasField("is_system_admin")
                    else None,
                    email_verified=request.email_verified
                    if request.HasField("email_verified")
                    else None,
                    accent_color=request.accent_color if request.HasField("accent_color") else None,
                )

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
            logger.error(f"Error updating user: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_list_user_organizations(
        self, request: AdminListUserOrganizationsRequest, ctx: RequestContext
    ) -> AdminUserOrganizationListResponse:
        """List organizations for a specific user (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                admin = await get_user_by_id(session, UUID(user_id))
                if not admin or not admin.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                orgs = await get_user_organizations(session, UUID(request.user_id))

                return AdminUserOrganizationListResponse(
                    organizations=[
                        AdminUserOrganizationInfo(
                            organization_id=str(org.id),
                            name=org.name,
                            slug=org.slug,
                            role=membership.role.value,
                            is_active=membership.is_active,
                            joined_at=membership.joined_at.isoformat(),
                        )
                        for org, membership in orgs
                    ]
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing user organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_add_user_to_organization(
        self, request: AdminAddUserToOrganizationRequest, ctx: RequestContext
    ) -> AdminUserOrganizationInfo:
        """Add user to organization (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                admin = await get_user_by_id(session, UUID(user_id))
                if not admin or not admin.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                try:
                    role = OrganizationRole(request.role.lower())
                except ValueError:
                    role = OrganizationRole.MEMBER

                membership = await add_user_to_organization(
                    session,
                    UUID(request.user_id),
                    UUID(request.organization_id),
                    role=role,
                )

                org = await get_organization_by_id(session, UUID(request.organization_id))

                return AdminUserOrganizationInfo(
                    organization_id=str(org.id),
                    name=org.name,
                    slug=org.slug,
                    role=membership.role.value,
                    is_active=membership.is_active,
                    joined_at=membership.joined_at.isoformat(),
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding user to organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_remove_user_from_organization(
        self, request: AdminRemoveUserFromOrganizationRequest, ctx: RequestContext
    ) -> Empty:
        """Remove user from organization (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                admin = await get_user_by_id(session, UUID(user_id))
                if not admin or not admin.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                await remove_user_from_organization(
                    session, UUID(request.user_id), UUID(request.organization_id)
                )

                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing user from organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_all_organizations(
        self, request: ListAllOrganizationsRequest, ctx: RequestContext
    ) -> AdminOrganizationListResponse:
        """List all organizations (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user = await get_user_by_id(session, UUID(user_id))
                if not user or not user.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                orgs, total = await list_all_organizations(
                    session,
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return AdminOrganizationListResponse(
                    organizations=[
                        AdminOrganizationInfo(
                            id=str(org.id),
                            name=org.name,
                            slug=org.slug,
                            domain=org.domain if org.domain else "",
                            plan=org.plan,
                            is_active=org.is_active,
                            created_at=org.created_at.isoformat(),
                            member_count=count,
                        )
                        for org, count in orgs
                    ],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing all organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_organization(
        self, request: UpdateOrganizationRequest, ctx: RequestContext
    ) -> AdminOrganizationInfo:
        """Update organization details (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user = await get_user_by_id(session, UUID(user_id))
                if not user or not user.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                org = await update_organization(
                    session,
                    UUID(request.organization_id),
                    name=request.name if request.HasField("name") else None,
                    domain=request.domain if request.HasField("domain") else None,
                    plan=request.plan if request.HasField("plan") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                )

                if not org:
                    raise ConnectError(Code.NOT_FOUND, "Organization not found")

                return AdminOrganizationInfo(
                    id=str(org.id),
                    name=org.name,
                    slug=org.slug,
                    domain=org.domain if org.domain else "",
                    plan=org.plan,
                    is_active=org.is_active,
                    created_at=org.created_at.isoformat(),
                    member_count=0,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_create_organization(
        self, request: AdminCreateOrganizationRequest, ctx: RequestContext
    ) -> AdminOrganizationInfo:
        """Create a new organization (System Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user = await get_user_by_id(session, UUID(user_id))
                if not user or not user.is_system_admin:
                    raise ConnectError(Code.PERMISSION_DENIED, "Requires system admin privileges")

                try:
                    org = await create_organization(
                        session,
                        name=request.name,
                        slug=request.slug,
                        owner_user_id=user.id,
                        domain=request.domain if request.HasField("domain") else None,
                        plan=request.plan,
                    )
                except Exception as e:
                    logger.warning(f"Failed to create organization: {e}")
                    raise ConnectError(Code.ALREADY_EXISTS, f"Organization creation failed: {e}")

                return AdminOrganizationInfo(
                    id=str(org.id),
                    name=org.name,
                    slug=org.slug,
                    domain=org.domain if org.domain else "",
                    plan=org.plan,
                    is_active=org.is_active,
                    created_at=org.created_at.isoformat(),
                    member_count=1,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # --- Group Management Methods ---

    async def list_groups(
        self, request: ListGroupsRequest, ctx: RequestContext
    ) -> GroupListResponse:
        """List groups in an organization (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                await self._check_org_admin(session, user_id, request.organization_id)

                groups, total = await list_groups(
                    session,
                    UUID(request.organization_id),
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return GroupListResponse(
                    groups=[
                        GroupInfo(
                            id=str(group.id),
                            organization_id=str(group.organization_id),
                            name=group.name,
                            slug=group.slug,
                            description=group.description,
                            is_private=group.is_private,
                            is_default=group.is_default,
                            created_at=group.created_at.isoformat(),
                            member_count=count,
                        )
                        for group, count in groups
                    ],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing groups: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_group(self, request: CreateGroupRequest, ctx: RequestContext) -> GroupInfo:
        """Create a new group (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                await self._check_org_admin(session, user_id, request.organization_id)

                try:
                    group = await create_group(
                        session,
                        organization_id=UUID(request.organization_id),
                        name=request.name,
                        slug=request.slug,
                        created_by_user_id=UUID(user_id),
                        description=request.description if request.HasField("description") else None,
                        is_private=request.is_private,
                        is_default=request.is_default,
                    )
                except Exception as e:
                    logger.warning(f"Failed to create group: {e}")
                    raise ConnectError(Code.ALREADY_EXISTS, f"Group creation failed: {e}")

                return GroupInfo(
                    id=str(group.id),
                    organization_id=str(group.organization_id),
                    name=group.name,
                    slug=group.slug,
                    description=group.description,
                    is_private=group.is_private,
                    is_default=group.is_default,
                    created_at=group.created_at.isoformat(),
                    member_count=0,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating group: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_group(self, request: UpdateGroupRequest, ctx: RequestContext) -> GroupInfo:
        """Update a group (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                # Verify existence and permissions
                group = await get_group_by_id(session, UUID(request.group_id))
                if not group:
                    raise ConnectError(Code.NOT_FOUND, "Group not found")

                await self._check_org_admin(session, user_id, str(group.organization_id))

                group = await update_group(
                    session,
                    UUID(request.group_id),
                    name=request.name if request.HasField("name") else None,
                    description=request.description if request.HasField("description") else None,
                    is_private=request.is_private if request.HasField("is_private") else None,
                    is_default=request.is_default if request.HasField("is_default") else None,
                )

                return GroupInfo(
                    id=str(group.id),
                    organization_id=str(group.organization_id),
                    name=group.name,
                    slug=group.slug,
                    description=group.description,
                    is_private=group.is_private,
                    is_default=group.is_default,
                    created_at=group.created_at.isoformat(),
                    # Member count not efficiently available on update, using 0 or separate query
                    # For performance, we skip it here or do a separate count
                    member_count=0,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating group: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_group(self, request: DeleteGroupRequest, ctx: RequestContext) -> Empty:
        """Delete a group (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group = await get_group_by_id(session, UUID(request.group_id))
                if not group:
                    raise ConnectError(Code.NOT_FOUND, "Group not found")

                await self._check_org_admin(session, user_id, str(group.organization_id))

                await delete_group(session, UUID(request.group_id))

                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting group: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_group_members(
        self, request: ListGroupMembersRequest, ctx: RequestContext
    ) -> GroupMemberListResponse:
        """List members of a group (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group = await get_group_by_id(session, UUID(request.group_id))
                if not group:
                    raise ConnectError(Code.NOT_FOUND, "Group not found")

                await self._check_org_admin(session, user_id, str(group.organization_id))

                members, total = await list_group_members(
                    session,
                    UUID(request.group_id),
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return GroupMemberListResponse(
                    members=[
                        GroupMemberInfo(
                            user_id=str(user.id),
                            email=user.email,
                            username=user.username,
                            full_name=user.full_name,
                            role=member.role.value,
                            joined_at=member.joined_at.isoformat(),
                        )
                        for member, user in members
                    ],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing group members: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_group_member(self, request: AddGroupMemberRequest, ctx: RequestContext) -> Empty:
        """Add user to group (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group = await get_group_by_id(session, UUID(request.group_id))
                if not group:
                    raise ConnectError(Code.NOT_FOUND, "Group not found")

                await self._check_org_admin(session, user_id, str(group.organization_id))

                # Verify user is in organization
                org_member = await get_user_organization_membership(
                    session, UUID(request.user_id), group.organization_id
                )
                if not org_member:
                    raise ConnectError(
                        Code.FAILED_PRECONDITION, "User is not a member of this organization"
                    )

                try:
                    role = GroupRole(request.role.lower())
                except ValueError:
                    role = GroupRole.MEMBER

                await add_group_member(
                    session,
                    UUID(request.group_id),
                    UUID(request.user_id),
                    role=role,
                )

                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding group member: {e}", exc_info=True)
            # Handle duplicate key error if already member
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_group_member(
        self, request: RemoveGroupMemberRequest, ctx: RequestContext
    ) -> Empty:
        """Remove user from group (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group = await get_group_by_id(session, UUID(request.group_id))
                if not group:
                    raise ConnectError(Code.NOT_FOUND, "Group not found")

                await self._check_org_admin(session, user_id, str(group.organization_id))

                await remove_group_member(session, UUID(request.group_id), UUID(request.user_id))

                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing group member: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_organization_users(
        self, request: ListOrganizationUsersRequest, ctx: RequestContext
    ) -> OrganizationUserListResponse:
        """List users in an organization (Org Admin only)."""
        user_id = self._get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                await self._check_org_admin(session, user_id, request.organization_id)

                users, total = await list_organization_users(
                    session,
                    UUID(request.organization_id),
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return OrganizationUserListResponse(
                    users=[
                        UserInfoResponse(
                            id=str(user.id),
                            email=user.email,
                            username=user.username,
                            full_name=user.full_name or "",
                            is_active=user.is_active,
                            is_system_admin=user.is_system_admin,
                            email_verified=user.email_verified,
                            accent_color=user.accent_color or "",
                        )
                        for user in users
                    ],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing organization users: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
