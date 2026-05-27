"""Groups service RPC handlers."""

from uuid import UUID

from connectrpc.request import RequestContext
from uniffy_proto.common.v1 import common_pb2 as common
from uniffy_proto.groups.v1 import groups_pb2 as pb

from uniffy.core.converters import (
    group_info_to_proto,
    group_member_info_to_proto,
    group_role_from_proto,
)
from uniffy.db import open_session
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.groups.converters import group_with_count_to_proto
from uniffy.domains.groups.operations import GroupOperations


class GroupsHandlers:
    """Handlers for GroupsService RPC methods."""

    async def list_groups(
        self,
        request: pb.ListGroupsRequest,
        ctx: RequestContext,
    ) -> pb.ListGroupsResponse:
        get_user_id_from_context(ctx)
        org_id = UUID(request.organization_id)

        page = 1
        page_size = 20
        if request.HasField("pagination"):
            page = request.pagination.page or 1
            page_size = request.pagination.page_size or 20

        async with open_session() as session:
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
    ) -> pb.GetGroupResponse:
        get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)

        async with open_session() as session:
            ops = GroupOperations(session)
            group = await ops.get_by_id(group_id)

        return pb.GetGroupResponse(group=group_info_to_proto(group))

    async def create_group(
        self,
        request: pb.CreateGroupRequest,
        ctx: RequestContext,
    ) -> pb.CreateGroupResponse:
        user_id = get_user_id_from_context(ctx)
        org_id = UUID(request.organization_id)

        async with open_session() as session:
            ops = GroupOperations(session)
            group = await ops.create(
                organization_id=org_id,
                name=request.name,
                created_by_user_id=user_id,
                description=request.description if request.HasField("description") else None,
                is_private=request.is_private,
                is_default=request.is_default,
            )

        return pb.CreateGroupResponse(group=group_info_to_proto(group))

    async def update_group(
        self,
        request: pb.UpdateGroupRequest,
        ctx: RequestContext,
    ) -> pb.UpdateGroupResponse:
        user_id = get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)

        async with open_session() as session:
            ops = GroupOperations(session)
            group = await ops.update(
                group_id=group_id,
                name=request.name if request.HasField("name") else None,
                description=request.description if request.HasField("description") else None,
                is_private=request.is_private if request.HasField("is_private") else None,
                is_default=request.is_default if request.HasField("is_default") else None,
                actor_user_id=user_id,
            )

        return pb.UpdateGroupResponse(group=group_info_to_proto(group))

    async def delete_group(
        self,
        request: pb.DeleteGroupRequest,
        ctx: RequestContext,
    ) -> pb.DeleteGroupResponse:
        user_id = get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)

        async with open_session() as session:
            ops = GroupOperations(session)
            await ops.delete(group_id, actor_user_id=user_id)

        return pb.DeleteGroupResponse(success=True)

    async def list_group_members(
        self,
        request: pb.ListGroupMembersRequest,
        ctx: RequestContext,
    ) -> pb.ListGroupMembersResponse:
        get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)

        page = 1
        page_size = 20
        if request.HasField("pagination"):
            page = request.pagination.page or 1
            page_size = request.pagination.page_size or 20

        role_filter = None
        if request.HasField("role_filter"):
            role_filter = group_role_from_proto(request.role_filter)

        async with open_session() as session:
            ops = GroupOperations(session)
            members, total = await ops.list_members(
                group_id=group_id,
                page=page,
                page_size=page_size,
                role_filter=role_filter,
            )

        return pb.ListGroupMembersResponse(
            members=[group_member_info_to_proto(u, m) for m, u in members],
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
    ) -> pb.AddGroupMemberResponse:
        user_id = get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)
        target_user_id = UUID(request.user_id)
        role = group_role_from_proto(request.role)

        async with open_session() as session:
            ops = GroupOperations(session)
            membership = await ops.add_member(
                group_id=group_id,
                user_id=target_user_id,
                role=role,
                actor_user_id=user_id,
            )
            _, user = await ops.get_member(group_id, target_user_id)

        return pb.AddGroupMemberResponse(member=group_member_info_to_proto(user, membership))

    async def update_group_member(
        self,
        request: pb.UpdateGroupMemberRequest,
        ctx: RequestContext,
    ) -> pb.UpdateGroupMemberResponse:
        get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)
        target_user_id = UUID(request.user_id)
        role = group_role_from_proto(request.role)

        async with open_session() as session:
            ops = GroupOperations(session)
            membership = await ops.update_member_role(
                group_id=group_id,
                user_id=target_user_id,
                role=role,
            )
            _, user = await ops.get_member(group_id, target_user_id)

        return pb.UpdateGroupMemberResponse(
            member=group_member_info_to_proto(user, membership)
        )

    async def remove_group_member(
        self,
        request: pb.RemoveGroupMemberRequest,
        ctx: RequestContext,
    ) -> pb.RemoveGroupMemberResponse:
        user_id = get_user_id_from_context(ctx)
        group_id = UUID(request.group_id)
        target_user_id = UUID(request.user_id)

        async with open_session() as session:
            ops = GroupOperations(session)
            await ops.remove_member(
                group_id, target_user_id, actor_user_id=user_id
            )

        return pb.RemoveGroupMemberResponse(success=True)

    async def get_user_groups(
        self,
        request: pb.GetUserGroupsRequest,
        ctx: RequestContext,
    ) -> pb.GetUserGroupsResponse:
        get_user_id_from_context(ctx)
        org_id = UUID(request.organization_id)
        target_user_id = UUID(request.user_id)

        async with open_session() as session:
            ops = GroupOperations(session)
            groups = await ops.get_user_groups(target_user_id, org_id)

        return pb.GetUserGroupsResponse(
            groups=[group_info_to_proto(g) for g in groups],
        )
