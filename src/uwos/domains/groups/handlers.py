"""Groups service RPC handlers."""

from uuid import UUID

from connectrpc.request import RequestContext

from uwos.core.converters import (
    group_info_to_proto,
    group_member_info_to_proto,
    group_role_from_proto,
)
from uwos.db import get_async_session
from uwos.domains.auth.context import get_user_id_from_context
from uwos.domains.groups.converters import group_with_count_to_proto
from uwos.domains.groups.operations import GroupOperations
from uwos.gen.common.v1 import common_pb2 as common
from uwos.gen.groups.v1 import groups_pb2 as pb


class GroupsHandlers:
    """Handlers for GroupsService RPC methods."""

    # =========================================================================
    # Group CRUD
    # =========================================================================

    async def list_groups(
        self,
        request: pb.ListGroupsRequest,
        ctx: RequestContext,
    ) -> pb.ListGroupsResponse:
        """
        List groups in an organization.

        Parameters
        ----------
        request : pb.ListGroupsRequest
            Request with organization_id and optional pagination/search.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        pb.ListGroupsResponse
            List of groups.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        org_id = UUID(request.organization_id)

        page = 1
        page_size = 20
        if request.HasField("pagination"):
            page = request.pagination.page or 1
            page_size = request.pagination.page_size or 20

        async for session in get_async_session():
            ops = GroupOperations(session)
            groups_with_counts, total = await ops.list_in_organization(
                organization_id=org_id,
                page=page,
                page_size=page_size,
                search=request.search if request.HasField("search") else None,
                include_private=(
                    request.include_private if request.HasField("include_private") else False
                ),
            )

        return pb.ListGroupsResponse(
            groups=[group_with_count_to_proto(g, count) for g, count in groups_with_counts],
            pagination=common.PaginationResponse(
                page=page,
                page_size=page_size,
                total_count=total,
                total_pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
            ),
        )

    async def get_group(
        self,
        request: pb.GetGroupRequest,
        ctx: RequestContext,
    ) -> common.GroupInfo:
        """
        Get a specific group.

        Parameters
        ----------
        request : pb.GetGroupRequest
            Request with organization_id and group_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        common.GroupInfo
            Group info.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)

        async for session in get_async_session():
            ops = GroupOperations(session)
            group = await ops.get_by_id(group_id)

        return group_info_to_proto(group)

    async def create_group(
        self,
        request: pb.CreateGroupRequest,
        ctx: RequestContext,
    ) -> common.GroupInfo:
        """
        Create a new group.

        Parameters
        ----------
        request : pb.CreateGroupRequest
            Request with group details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        common.GroupInfo
            Created group.

        """
        user_id = get_user_id_from_context(ctx)
        org_id = UUID(request.organization_id)

        async for session in get_async_session():
            ops = GroupOperations(session)
            group = await ops.create(
                organization_id=org_id,
                name=request.name,
                created_by_user_id=user_id,
                description=request.description if request.HasField("description") else None,
                is_private=request.is_private,
                is_default=request.is_default,
            )

        return group_info_to_proto(group)

    async def update_group(
        self,
        request: pb.UpdateGroupRequest,
        ctx: RequestContext,
    ) -> common.GroupInfo:
        """
        Update a group.

        Parameters
        ----------
        request : pb.UpdateGroupRequest
            Request with group updates.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        common.GroupInfo
            Updated group.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)

        async for session in get_async_session():
            ops = GroupOperations(session)
            group = await ops.update(
                group_id=group_id,
                name=request.name if request.HasField("name") else None,
                description=request.description if request.HasField("description") else None,
                is_private=request.is_private if request.HasField("is_private") else None,
                is_default=request.is_default if request.HasField("is_default") else None,
            )

        return group_info_to_proto(group)

    async def delete_group(
        self,
        request: pb.DeleteGroupRequest,
        ctx: RequestContext,
    ) -> pb.DeleteGroupResponse:
        """
        Delete a group.

        Parameters
        ----------
        request : pb.DeleteGroupRequest
            Request with group_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        pb.DeleteGroupResponse
            Success status.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)

        async for session in get_async_session():
            ops = GroupOperations(session)
            await ops.delete(group_id)

        return pb.DeleteGroupResponse(success=True)

    # =========================================================================
    # Group Membership
    # =========================================================================

    async def list_group_members(
        self,
        request: pb.ListGroupMembersRequest,
        ctx: RequestContext,
    ) -> pb.ListGroupMembersResponse:
        """
        List members of a group.

        Parameters
        ----------
        request : pb.ListGroupMembersRequest
            Request with group_id and optional pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        pb.ListGroupMembersResponse
            List of members.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)

        page = 1
        page_size = 20
        if request.HasField("pagination"):
            page = request.pagination.page or 1
            page_size = request.pagination.page_size or 20

        role_filter = None
        if request.HasField("role_filter"):
            role_filter = group_role_from_proto(request.role_filter)

        async for session in get_async_session():
            ops = GroupOperations(session)
            members, total = await ops.list_members(
                group_id=group_id,
                page=page,
                page_size=page_size,
                role_filter=role_filter,
            )

        return pb.ListGroupMembersResponse(
            members=[group_member_info_to_proto(m, u) for m, u in members],
            pagination=common.PaginationResponse(
                page=page,
                page_size=page_size,
                total_count=total,
                total_pages=(total + page_size - 1) // page_size if page_size > 0 else 0,
            ),
        )

    async def add_group_member(
        self,
        request: pb.AddGroupMemberRequest,
        ctx: RequestContext,
    ) -> common.GroupMemberInfo:
        """
        Add a member to a group.

        Parameters
        ----------
        request : pb.AddGroupMemberRequest
            Request with group_id, user_id, and role.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        common.GroupMemberInfo
            Created membership.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)
        target_user_id = UUID(request.user_id)
        role = group_role_from_proto(request.role)

        async for session in get_async_session():
            ops = GroupOperations(session)
            membership = await ops.add_member(
                group_id=group_id,
                user_id=target_user_id,
                role=role,
            )
            # Get user info for response
            _, user = await ops.get_member(group_id, target_user_id)

        return group_member_info_to_proto(membership, user)

    async def update_group_member(
        self,
        request: pb.UpdateGroupMemberRequest,
        ctx: RequestContext,
    ) -> common.GroupMemberInfo:
        """
        Update a group member's role.

        Parameters
        ----------
        request : pb.UpdateGroupMemberRequest
            Request with group_id, user_id, and new role.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        common.GroupMemberInfo
            Updated membership.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)
        target_user_id = UUID(request.user_id)
        role = group_role_from_proto(request.role)

        async for session in get_async_session():
            ops = GroupOperations(session)
            membership = await ops.update_member_role(
                group_id=group_id,
                user_id=target_user_id,
                role=role,
            )
            # Get user info for response
            _, user = await ops.get_member(group_id, target_user_id)

        return group_member_info_to_proto(membership, user)

    async def remove_group_member(
        self,
        request: pb.RemoveGroupMemberRequest,
        ctx: RequestContext,
    ) -> pb.RemoveGroupMemberResponse:
        """
        Remove a member from a group.

        Parameters
        ----------
        request : pb.RemoveGroupMemberRequest
            Request with group_id and user_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        pb.RemoveGroupMemberResponse
            Success status.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        group_id = UUID(request.group_id)
        target_user_id = UUID(request.user_id)

        async for session in get_async_session():
            ops = GroupOperations(session)
            await ops.remove_member(group_id, target_user_id)

        return pb.RemoveGroupMemberResponse(success=True)

    # =========================================================================
    # Bulk Operations
    # =========================================================================

    async def get_user_groups(
        self,
        request: pb.GetUserGroupsRequest,
        ctx: RequestContext,
    ) -> pb.GetUserGroupsResponse:
        """
        Get all groups a user belongs to in an organization.

        Parameters
        ----------
        request : pb.GetUserGroupsRequest
            Request with organization_id and user_id.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        pb.GetUserGroupsResponse
            List of groups.

        """
        get_user_id_from_context(ctx)  # Verify authenticated
        org_id = UUID(request.organization_id)
        target_user_id = UUID(request.user_id)

        async for session in get_async_session():
            ops = GroupOperations(session)
            groups = await ops.get_user_groups(target_user_id, org_id)

        return pb.GetUserGroupsResponse(
            groups=[group_info_to_proto(g) for g in groups],
        )
