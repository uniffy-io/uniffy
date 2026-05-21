"""Organizations RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.common.v1.common_pb2 import (
    PaginationResponse,
)
from uniffy_proto.organizations.v1.organizations_pb2 import (
    AddMemberRequest,
    AddMemberResponse,
    CreateOrganizationRequest,
    CreateOrganizationResponse,
    DeleteOrganizationRequest,
    DeleteOrganizationResponse,
    GetOrganizationOverviewRequest,
    GetOrganizationOverviewResponse,
    GetOrganizationRequest,
    GetOrganizationResponse,
    GetOrganizationSettingsRequest,
    GetOrganizationSettingsResponse,
    GetPermissionDefaultsRequest,
    GetPermissionDefaultsResponse,
    GetUserDomainAdminsRequest,
    GetUserDomainAdminsResponse,
    GrantDomainAdminRequest,
    GrantDomainAdminResponse,
    ListDomainAdminsRequest,
    ListDomainAdminsResponse,
    ListMembersRequest,
    ListMembersResponse,
    ListMyOrganizationsRequest,
    ListMyOrganizationsResponse,
    ListOrganizationsRequest,
    ListOrganizationsResponse,
    RemoveMemberRequest,
    RemoveMemberResponse,
    RevokeDomainAdminRequest,
    RevokeDomainAdminResponse,
    UpdateMemberRoleRequest,
    UpdateMemberRoleResponse,
    UpdateOrganizationRequest,
    UpdateOrganizationResponse,
    UpdateOrganizationSettingsRequest,
    UpdateOrganizationSettingsResponse,
    UpdatePermissionDefaultsRequest,
    UpdatePermissionDefaultsResponse,
)

from uniffy.core.converters import (
    content_type_from_proto,
    domain_admin_info_to_proto,
    domain_type_from_proto,
    domain_type_to_proto,
    member_info_to_proto,
    org_info_to_proto,
    org_role_from_proto,
)
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.organization_member import OrganizationRole
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.organizations.converters import (
    my_organization_to_proto,
    organization_detail_to_proto,
    organization_overview_to_proto,
    organization_settings_to_proto,
    permission_defaults_to_proto,
)
from uniffy.domains.organizations.operations import OrganizationOperations


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
            async with open_session() as session:
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
            async with open_session() as session:
                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
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
    ) -> GetOrganizationResponse:
        """Get organization by ID."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                # Verify user has access (is member or system admin)
                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
                user = await user_ops.get_by_id(user_id)
                if not user.is_system_admin:
                    membership = await ops.get_membership(user_id, org_id)
                    if not membership:
                        raise PermissionDeniedError("Not a member of this organization")

                overview = await ops.get_overview(org_id)
                org = overview["organization"]

                return GetOrganizationResponse(
                    organization=organization_detail_to_proto(
                        org,
                        overview["member_count"],
                        overview["group_count"],
                    )
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
    ) -> CreateOrganizationResponse:
        """Create a new organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        if not request.name or not request.slug:
            raise ConnectError(Code.INVALID_ARGUMENT, "Name and slug are required")

        try:
            async with open_session() as session:
                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
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
                    actor_user_id=user_id,
                )

                return CreateOrganizationResponse(organization=org_info_to_proto(org))
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
    ) -> UpdateOrganizationResponse:
        """Update organization details."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                # Verify user is org admin or system admin
                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
                user = await user_ops.get_by_id(user_id)
                if not user.is_system_admin:
                    await ops.require_org_admin(user_id, org_id)

                org = await ops.update(
                    org_id=org_id,
                    name=request.name if request.HasField("name") else None,
                    slug=request.slug if request.HasField("slug") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                    actor_user_id=user_id,
                )

                return UpdateOrganizationResponse(organization=org_info_to_proto(org))
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
            async with open_session() as session:
                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
                await user_ops.require_system_admin(user_id)

                ops = OrganizationOperations(session)
                await ops.delete(org_id, actor_user_id=user_id)

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
    ) -> GetOrganizationOverviewResponse:
        """Get organization overview (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                overview = await ops.get_overview(org_id)

                return GetOrganizationOverviewResponse(
                    overview=organization_overview_to_proto(
                        overview["organization"],
                        overview["member_count"],
                        overview["group_count"],
                    )
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
            async with open_session() as session:
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
    ) -> AddMemberResponse:
        """Add a member to the organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                # Get role from proto
                role = org_role_from_proto(request.role)
                if role is None:
                    role = OrganizationRole.MEMBER

                # Get target user
                from uniffy.domains.users.operations import UserOperations as _UserOps

                user_ops = _UserOps(session)
                target_user = await user_ops.get_by_id(target_user_id)

                membership = await ops.add_member(
                    target_user_id, org_id, role, actor_user_id=user_id
                )

                return AddMemberResponse(member=member_info_to_proto(target_user, membership))
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
    ) -> UpdateMemberRoleResponse:
        """Update a member's role (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
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

                return UpdateMemberRoleResponse(
                    member=member_info_to_proto(target_user, membership)
                )
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
            async with open_session() as session:
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
    ) -> GetPermissionDefaultsResponse:
        """Get permission defaults for the organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                defaults = await ops.get_permission_defaults(org_id)

                return GetPermissionDefaultsResponse(
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
    ) -> UpdatePermissionDefaultsResponse:
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
            async with open_session() as session:
                ops = OrganizationOperations(session)

                default_access_mode = None
                if request.HasField("default_access_mode"):
                    default_access_mode = access_mode_from_proto(request.default_access_mode)

                default_baseline_role = None
                if request.HasField("default_baseline_role"):
                    default_baseline_role = content_role_from_proto(request.default_baseline_role)

                defaults = await ops.update_permission_defaults(
                    user_id=user_id,
                    org_id=org_id,
                    content_type=content_type,
                    default_access_mode=default_access_mode,
                    default_baseline_role=default_baseline_role,
                )

                return UpdatePermissionDefaultsResponse(
                    defaults=permission_defaults_to_proto(defaults)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except Exception as e:
            logger.error(f"Error updating permission defaults: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_organization_settings(
        self,
        request: GetOrganizationSettingsRequest,
        ctx: RequestContext,
    ) -> GetOrganizationSettingsResponse:
        """Get the organization settings blob (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)
                settings = await ops.get_organization_settings(org_id)
                return GetOrganizationSettingsResponse(
                    settings=organization_settings_to_proto(settings)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error getting organization settings: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_organization_settings(
        self,
        request: UpdateOrganizationSettingsRequest,
        ctx: RequestContext,
    ) -> UpdateOrganizationSettingsResponse:
        """Merge-update the organization settings blob (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        chat_agents_enabled: bool | None = None
        if request.HasField("chat"):
            chat_agents_enabled = request.chat.agents_enabled

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                settings = await ops.update_organization_settings(
                    user_id=user_id,
                    org_id=org_id,
                    chat_agents_enabled=chat_agents_enabled,
                )
                return UpdateOrganizationSettingsResponse(
                    settings=organization_settings_to_proto(settings)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error updating organization settings: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    # ─────────────────────────────────────────────────────────────
    # Domain Admin Management (Org Admin)
    # ─────────────────────────────────────────────────────────────

    async def grant_domain_admin(
        self,
        request: GrantDomainAdminRequest,
        ctx: RequestContext,
    ) -> GrantDomainAdminResponse:
        """Grant domain admin to a user (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        domain = domain_type_from_proto(request.domain)
        if domain is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid domain")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                da, target_user = await ops.grant_domain_admin(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                    domain=domain,
                )
                return GrantDomainAdminResponse(
                    domain_admin=domain_admin_info_to_proto(da, target_user)
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error granting domain admin: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def revoke_domain_admin(
        self,
        request: RevokeDomainAdminRequest,
        ctx: RequestContext,
    ) -> RevokeDomainAdminResponse:
        """Revoke domain admin from a user (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        domain = domain_type_from_proto(request.domain)
        if domain is None:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid domain")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.revoke_domain_admin(
                    admin_user_id=user_id,
                    org_id=org_id,
                    target_user_id=target_user_id,
                    domain=domain,
                )
                return RevokeDomainAdminResponse(success=True)
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error revoking domain admin: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_domain_admins(
        self,
        request: ListDomainAdminsRequest,
        ctx: RequestContext,
    ) -> ListDomainAdminsResponse:
        """List domain admins for the organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)
                await ops.require_org_admin(user_id, org_id)

                domain_filter = None
                if request.HasField("domain_filter"):
                    domain_filter = domain_type_from_proto(request.domain_filter)

                page = 1
                page_size = 50
                if request.HasField("pagination"):
                    page = request.pagination.page if request.pagination.page > 0 else 1
                    page_size = (
                        request.pagination.page_size if request.pagination.page_size > 0 else 50
                    )

                items, total = await ops.list_domain_admins(
                    org_id=org_id,
                    domain_filter=domain_filter,
                    page=page,
                    page_size=page_size,
                )

                total_pages = (total + page_size - 1) // page_size

                return ListDomainAdminsResponse(
                    domain_admins=[domain_admin_info_to_proto(da, user) for da, user in items],
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
            logger.error(f"Error listing domain admins: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_user_domain_admins(
        self,
        request: GetUserDomainAdminsRequest,
        ctx: RequestContext,
    ) -> GetUserDomainAdminsResponse:
        """Get domains where a user is domain admin."""
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id or user_id")

        try:
            async with open_session() as session:
                ops = OrganizationOperations(session)

                # Any org member can check their own; org admin can check anyone
                if user_id != target_user_id:
                    await ops.require_org_admin(user_id, org_id)
                else:
                    await ops.require_org_member(user_id, org_id)

                domains = await ops.get_user_domain_admins(org_id, target_user_id)
                return GetUserDomainAdminsResponse(
                    domains=[domain_type_to_proto(d) for d in domains],
                )
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except NotFoundError as e:
            raise ConnectError(Code.NOT_FOUND, str(e))
        except Exception as e:
            logger.error(f"Error getting user domain admins: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
