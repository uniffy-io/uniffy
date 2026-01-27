"""Organizations RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uwos.core.converters import (
    content_type_from_proto,
    member_info_to_proto,
    org_info_to_proto,
    org_role_from_proto,
    visibility_from_proto,
)
from uwos.core.errors import NotFoundError, PermissionDeniedError
from uwos.core.models.login.organization_member import OrganizationRole
from uwos.db import get_async_session
from uwos.domains.auth.context import get_user_id_from_context
from uwos.domains.organizations.converters import (
    my_organization_to_proto,
    organization_detail_to_proto,
    organization_overview_to_proto,
    permission_defaults_to_proto,
)
from uwos.domains.organizations.operations import OrganizationOperations
from uwos.domains.users.operations import UserOperations
from uwos.gen.common.v1.common_pb2 import MemberInfo, OrganizationInfo, PaginationResponse
from uwos.gen.organizations.v1.organizations_pb2 import (
    AddMemberRequest,
    ContentTypeDefaults,
    CreateOrganizationRequest,
    DeleteOrganizationRequest,
    DeleteOrganizationResponse,
    GetOrganizationOverviewRequest,
    GetOrganizationRequest,
    GetPermissionDefaultsRequest,
    ListMembersRequest,
    ListMembersResponse,
    ListMyOrganizationsRequest,
    ListMyOrganizationsResponse,
    ListOrganizationsRequest,
    ListOrganizationsResponse,
    OrganizationDetail,
    OrganizationOverview,
    PermissionDefaultsResponse,
    RemoveMemberRequest,
    RemoveMemberResponse,
    UpdateMemberRoleRequest,
    UpdateOrganizationRequest,
    UpdatePermissionDefaultsRequest,
)


class OrganizationsHandlers:
    """Organizations RPC handlers."""

    # ─────────────────────────────────────────────────────────────
    # User's Organizations
    # ─────────────────────────────────────────────────────────────

    async def list_my_organizations(
        self,
        request: ListMyOrganizationsRequest,
        ctx: RequestContext,
    ) -> ListMyOrganizationsResponse:
        """List organizations the current user belongs to."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)
                orgs_with_memberships = await ops.get_user_organizations(user_id)

                return ListMyOrganizationsResponse(
                    organizations=[
                        my_organization_to_proto(org, membership)
                        for org, membership in orgs_with_memberships
                    ]
                )
        except Exception as e:
            logger.error(f"Error listing user organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # ─────────────────────────────────────────────────────────────
    # Organization CRUD (System Admin)
    # ─────────────────────────────────────────────────────────────

    async def list_organizations(
        self,
        request: ListOrganizationsRequest,
        ctx: RequestContext,
    ) -> ListOrganizationsResponse:
        """List all organizations (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                ops = OrganizationOperations(session)

                page = 1
                page_size = 20
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = (
                        request.pagination.page_size if request.pagination.page_size > 0 else 20
                    )

                orgs_with_counts, total = await ops.list_all(
                    page=page,
                    page_size=page_size,
                    query_str=request.search if request.HasField("search") else None,
                )

                total_pages = (total + page_size - 1) // page_size

                return ListOrganizationsResponse(
                    organizations=[
                        organization_detail_to_proto(org, member_count, group_count)
                        for org, member_count, group_count in orgs_with_counts
                    ],
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
            logger.error(f"Error listing organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_organization(
        self,
        request: GetOrganizationRequest,
        ctx: RequestContext,
    ) -> OrganizationDetail:
        """Get organization by ID."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)

                # Verify user has access (is member or system admin)
                user_ops = UserOperations(session)
                user = await user_ops.get_by_id(user_id)
                if not user.is_system_admin:
                    membership = await ops.get_membership(user_id, org_id)
                    if not membership:
                        raise PermissionDeniedError("Not a member of this organization")

                overview = await ops.get_overview(org_id)
                org = overview["organization"]

                return organization_detail_to_proto(
                    org,
                    overview["member_count"],
                    overview["group_count"],
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error getting organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_organization(
        self,
        request: CreateOrganizationRequest,
        ctx: RequestContext,
    ) -> OrganizationInfo:
        """Create a new organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        if not request.name or not request.slug:
            raise ConnectError(Code.INVALID_ARGUMENT, "Name and slug are required")

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                ops = OrganizationOperations(session)

                # Check if slug already exists
                existing = await ops.get_by_slug(request.slug)
                if existing:
                    raise ConnectError(Code.ALREADY_EXISTS, "Organization slug already exists")

                # Determine owner
                owner_id = user_id
                if request.HasField("owner_user_id"):
                    owner_id = UUID(request.owner_user_id)

                org = await ops.create(
                    name=request.name,
                    slug=request.slug,
                    owner_user_id=owner_id,
                )

                return org_info_to_proto(org)
        except ConnectError:
            raise
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error creating organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_organization(
        self,
        request: UpdateOrganizationRequest,
        ctx: RequestContext,
    ) -> OrganizationInfo:
        """Update organization details."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)

                # Verify user is org admin or system admin
                user_ops = UserOperations(session)
                user = await user_ops.get_by_id(user_id)
                if not user.is_system_admin:
                    await ops.require_org_admin(user_id, org_id)

                org = await ops.update(
                    org_id=org_id,
                    name=request.name if request.HasField("name") else None,
                    slug=request.slug if request.HasField("slug") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                )

                return org_info_to_proto(org)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error updating organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_organization(
        self,
        request: DeleteOrganizationRequest,
        ctx: RequestContext,
    ) -> DeleteOrganizationResponse:
        """Delete an organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                ops = OrganizationOperations(session)
                await ops.delete(org_id)

                return DeleteOrganizationResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error deleting organization: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # ─────────────────────────────────────────────────────────────
    # Organization Overview (Org Admin)
    # ─────────────────────────────────────────────────────────────

    async def get_organization_overview(
        self,
        request: GetOrganizationOverviewRequest,
        ctx: RequestContext,
    ) -> OrganizationOverview:
        """Get organization overview (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                overview = await ops.get_overview(org_id)

                return organization_overview_to_proto(
                    overview["organization"],
                    overview["member_count"],
                    overview["group_count"],
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error getting organization overview: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # ─────────────────────────────────────────────────────────────
    # Member Management (Org Admin)
    # ─────────────────────────────────────────────────────────────

    async def list_members(
        self,
        request: ListMembersRequest,
        ctx: RequestContext,
    ) -> ListMembersResponse:
        """List organization members (available to all members)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)
                await ops.require_org_member(user_id, org_id)

                page = 1
                page_size = 50
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = (
                        request.pagination.page_size if request.pagination.page_size > 0 else 50
                    )

                role_filter = None
                if request.HasField("role_filter"):
                    role_filter = org_role_from_proto(request.role_filter)

                members, total = await ops.list_members(
                    org_id=org_id,
                    page=page,
                    page_size=page_size,
                    role_filter=role_filter,
                    search=request.search if request.HasField("search") else None,
                    include_inactive=(
                        request.include_inactive if request.HasField("include_inactive") else False
                    ),
                )

                total_pages = (total + page_size - 1) // page_size

                return ListMembersResponse(
                    members=[member_info_to_proto(user, membership) for membership, user in members],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error listing members: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_member(
        self,
        request: AddMemberRequest,
        ctx: RequestContext,
    ) -> MemberInfo:
        """Add a member to the organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                # Get role from proto
                role = org_role_from_proto(request.role)
                if role is None:
                    role = OrganizationRole.MEMBER

                # Get target user
                user_ops = UserOperations(session)
                target_user = await user_ops.get_by_id(target_user_id)

                membership = await ops.add_member(target_user_id, org_id, role)

                return member_info_to_proto(target_user, membership)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error adding member: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_member_role(
        self,
        request: UpdateMemberRoleRequest,
        ctx: RequestContext,
    ) -> MemberInfo:
        """Update a member's role (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)

                # Get role from proto
                new_role = org_role_from_proto(request.role)
                if new_role is None:
                    raise ConnectError(Code.INVALID_ARGUMENT, "Invalid role")

                membership, target_user = await ops.update_member_role(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                    new_role=new_role,
                )

                return member_info_to_proto(target_user, membership)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error updating member role: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_member(
        self,
        request: RemoveMemberRequest,
        ctx: RequestContext,
    ) -> RemoveMemberResponse:
        """Remove a member from the organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)

                await ops.remove_member(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                )

                return RemoveMemberResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error removing member: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # ─────────────────────────────────────────────────────────────
    # Permission Defaults (Org Admin)
    # ─────────────────────────────────────────────────────────────

    async def get_permission_defaults(
        self,
        request: GetPermissionDefaultsRequest,
        ctx: RequestContext,
    ) -> PermissionDefaultsResponse:
        """Get permission defaults for the organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                defaults = await ops.get_permission_defaults(org_id)

                return PermissionDefaultsResponse(
                    defaults=[permission_defaults_to_proto(d) for d in defaults]
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error getting permission defaults: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_permission_defaults(
        self,
        request: UpdatePermissionDefaultsRequest,
        ctx: RequestContext,
    ) -> ContentTypeDefaults:
        """Update permission defaults for a content type (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        content_type = content_type_from_proto(request.content_type)
        if content_type is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid content_type")

        try:
            async for session in get_async_session():
                ops = OrganizationOperations(session)

                default_visibility = None
                if request.HasField("default_visibility"):
                    default_visibility = visibility_from_proto(request.default_visibility)

                defaults = await ops.update_permission_defaults(
                    user_id=user_id,
                    org_id=org_id,
                    content_type=content_type,
                    default_visibility=default_visibility,
                    members_can_view=(
                        request.members_can_view if request.HasField("members_can_view") else None
                    ),
                    members_can_edit=(
                        request.members_can_edit if request.HasField("members_can_edit") else None
                    ),
                    members_can_delete=(
                        request.members_can_delete
                        if request.HasField("members_can_delete")
                        else None
                    ),
                    members_can_share=(
                        request.members_can_share if request.HasField("members_can_share") else None
                    ),
                )

                return permission_defaults_to_proto(defaults)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error updating permission defaults: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
