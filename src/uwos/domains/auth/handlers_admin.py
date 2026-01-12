"""Auth admin and group RPC handlers."""

import contextlib
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uwos.core.models.login.group_member import GroupRole
from uwos.core.models.login.organization_member import OrganizationRole
from uwos.db import get_async_session
from uwos.domains.auth.context import get_user_id_from_context
from uwos.domains.auth.converters import (
    group_member_to_proto,
    group_to_proto,
    membership_to_admin_proto,
    organization_to_admin_proto,
    user_to_proto,
)
from uwos.domains.auth.groups import GroupOperations
from uwos.domains.auth.orgs import OrganizationOperations
from uwos.domains.auth.users import UserOperations
from uwos.gen.auth.v1.auth_pb2 import (
    AddGroupMemberRequest,
    AdminAddUserToOrganizationRequest,
    AdminCreateOrganizationRequest,
    AdminListUserOrganizationsRequest,
    AdminOrganizationListResponse,
    AdminRemoveUserFromOrganizationRequest,
    AdminUserOrganizationListResponse,
    CreateGroupRequest,
    DeleteGroupRequest,
    Empty,
    GroupInfo,
    GroupListResponse,
    GroupMemberListResponse,
    ListAllOrganizationsRequest,
    ListGroupMembersRequest,
    ListGroupsRequest,
    ListOrganizationUsersRequest,
    OrganizationUserListResponse,
    RemoveGroupMemberRequest,
    UpdateGroupRequest,
    UpdateOrganizationRequest,
)


class AdminHandlers:
    """Admin-only RPC handlers for organizations and system-wide operations."""

    async def admin_list_user_organizations(
        self,
        request: AdminListUserOrganizationsRequest,
        ctx: RequestContext,
    ) -> AdminUserOrganizationListResponse:
        """List organizations for a specific user (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                orgs = await org_ops.get_user_organizations(UUID(request.user_id))

                return AdminUserOrganizationListResponse(
                    organizations=[
                        membership_to_admin_proto(org, membership) for org, membership in orgs
                    ]
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing user organizations: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_add_user_to_organization(
        self,
        request: AdminAddUserToOrganizationRequest,
        ctx: RequestContext,
    ) -> AdminUserOrganizationListResponse:
        """Add user to organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                role = OrganizationRole.MEMBER
                with contextlib.suppress(ValueError):
                    role = OrganizationRole(request.role.upper())

                org_ops = OrganizationOperations(session)
                membership = await org_ops.add_member(
                    UUID(request.user_id),
                    UUID(request.organization_id),
                    role=role,
                )
                org = await org_ops.get_by_id(UUID(request.organization_id))

                # Return list response with single item
                return AdminUserOrganizationListResponse(
                    organizations=[membership_to_admin_proto(org, membership)]
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding user to org: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_remove_user_from_organization(
        self,
        request: AdminRemoveUserFromOrganizationRequest,
        ctx: RequestContext,
    ) -> Empty:
        """Remove user from organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                await org_ops.remove_member(
                    UUID(request.user_id),
                    UUID(request.organization_id),
                )
                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing user from org: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_all_organizations(
        self,
        request: ListAllOrganizationsRequest,
        ctx: RequestContext,
    ) -> AdminOrganizationListResponse:
        """List all organizations (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                orgs_with_counts, total = await org_ops.list_all(
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return AdminOrganizationListResponse(
                    organizations=[
                        organization_to_admin_proto(org, count) for org, count in orgs_with_counts
                    ],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing all orgs: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_organization(
        self,
        request: UpdateOrganizationRequest,
        ctx: RequestContext,
    ):
        """Update organization details (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                await user_ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                org = await org_ops.update(
                    org_id=UUID(request.organization_id),
                    name=request.name if request.HasField("name") else None,
                    domain=request.domain if request.HasField("domain") else None,
                    plan=request.plan if request.HasField("plan") else None,
                    is_active=request.is_active if request.HasField("is_active") else None,
                )

                return organization_to_admin_proto(org)
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating org: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def admin_create_organization(
        self,
        request: AdminCreateOrganizationRequest,
        ctx: RequestContext,
    ):
        """Create a new organization (system admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                user_ops = UserOperations(session)
                admin = await user_ops.require_system_admin(user_id)

                org_ops = OrganizationOperations(session)
                org = await org_ops.create(
                    name=request.name,
                    slug=request.slug,
                    owner_user_id=admin.id,
                    domain=request.domain if request.HasField("domain") else None,
                    plan=request.plan,
                )

                return organization_to_admin_proto(org, member_count=1)
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating org: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_organization_users(
        self,
        request: ListOrganizationUsersRequest,
        ctx: RequestContext,
    ) -> OrganizationUserListResponse:
        """List users in an organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, UUID(request.organization_id))

                users, total = await org_ops.list_members(
                    org_id=UUID(request.organization_id),
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return OrganizationUserListResponse(
                    users=[user_to_proto(u) for u in users],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing org users: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")


class GroupHandlers:
    """Group management RPC handlers."""

    async def list_groups(
        self,
        request: ListGroupsRequest,
        ctx: RequestContext,
    ) -> GroupListResponse:
        """List groups in an organization (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, UUID(request.organization_id))

                group_ops = GroupOperations(session)
                groups_with_counts, total = await group_ops.list_in_organization(
                    organization_id=UUID(request.organization_id),
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return GroupListResponse(
                    groups=[group_to_proto(group, count) for group, count in groups_with_counts],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing groups: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def create_group(
        self,
        request: CreateGroupRequest,
        ctx: RequestContext,
    ) -> GroupInfo:
        """Create a new group (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, UUID(request.organization_id))

                group_ops = GroupOperations(session)
                group = await group_ops.create(
                    organization_id=UUID(request.organization_id),
                    name=request.name,
                    slug=request.slug,
                    created_by_user_id=user_id,
                    description=request.description if request.HasField("description") else None,
                    is_private=request.is_private,
                    is_default=request.is_default,
                )

                return group_to_proto(group, member_count=0)
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating group: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_group(
        self,
        request: UpdateGroupRequest,
        ctx: RequestContext,
    ) -> GroupInfo:
        """Update a group (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group_ops = GroupOperations(session)
                group = await group_ops.get_by_id(UUID(request.group_id))

                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, group.organization_id)

                group = await group_ops.update(
                    group_id=UUID(request.group_id),
                    name=request.name if request.HasField("name") else None,
                    description=request.description if request.HasField("description") else None,
                    is_private=request.is_private if request.HasField("is_private") else None,
                    is_default=request.is_default if request.HasField("is_default") else None,
                )

                return group_to_proto(group)
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating group: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_group(
        self,
        request: DeleteGroupRequest,
        ctx: RequestContext,
    ) -> Empty:
        """Delete a group (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group_ops = GroupOperations(session)
                group = await group_ops.get_by_id(UUID(request.group_id))

                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, group.organization_id)

                await group_ops.delete(UUID(request.group_id))
                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting group: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_group_members(
        self,
        request: ListGroupMembersRequest,
        ctx: RequestContext,
    ) -> GroupMemberListResponse:
        """List members of a group (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group_ops = GroupOperations(session)
                group = await group_ops.get_by_id(UUID(request.group_id))

                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, group.organization_id)

                members, total = await group_ops.list_members(
                    group_id=UUID(request.group_id),
                    page=request.page if request.page > 0 else 1,
                    page_size=request.page_size if request.page_size > 0 else 20,
                    query_str=request.query if request.HasField("query") else None,
                )

                return GroupMemberListResponse(
                    members=[group_member_to_proto(m, u) for m, u in members],
                    total_count=total,
                )
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing group members: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def add_group_member(
        self,
        request: AddGroupMemberRequest,
        ctx: RequestContext,
    ) -> Empty:
        """Add user to group (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group_ops = GroupOperations(session)
                group = await group_ops.get_by_id(UUID(request.group_id))

                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, group.organization_id)

                # Verify user is in organization
                membership = await org_ops.get_membership(
                    UUID(request.user_id),
                    group.organization_id,
                )
                if not membership:
                    raise ConnectError(
                        Code.FAILED_PRECONDITION,
                        "User is not a member of this organization",
                    )

                role = GroupRole.MEMBER
                with contextlib.suppress(ValueError):
                    role = GroupRole(request.role.upper())

                await group_ops.add_member(
                    group_id=UUID(request.group_id),
                    user_id=UUID(request.user_id),
                    role=role,
                )

                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error adding group member: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def remove_group_member(
        self,
        request: RemoveGroupMemberRequest,
        ctx: RequestContext,
    ) -> Empty:
        """Remove user from group (org admin only)."""
        user_id = get_user_id_from_context(ctx)

        try:
            async for session in get_async_session():
                group_ops = GroupOperations(session)
                group = await group_ops.get_by_id(UUID(request.group_id))

                org_ops = OrganizationOperations(session)
                await org_ops.require_org_admin(user_id, group.organization_id)

                await group_ops.remove_member(
                    group_id=UUID(request.group_id),
                    user_id=UUID(request.user_id),
                )

                return Empty()
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error removing group member: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")
