"""Chat channel RPC handlers - thin layer delegating to operations."""

import os
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from uniffy_proto.chat.v1.chat_pb2 import (
    AddMembersRequest,
    AddMembersResponse,
    ArchiveChannelRequest,
    ArchiveChannelResponse,
    CreateChannelRequest,
    CreateChannelResponse,
    DeleteChannelRequest,
    DeleteChannelResponse,
    GetChannelRequest,
    GetChannelResourcesRequest,
    GetChannelResourcesResponse,
    GetChannelResponse,
    GetMembersRequest,
    GetMembersResponse,
    GetUnreadCountsRequest,
    GetUnreadCountsResponse,
    JoinChannelRequest,
    JoinChannelResponse,
    LeaveChannelRequest,
    LeaveChannelResponse,
    ListChannelsRequest,
    ListChannelsResponse,
    MarkChannelReadRequest,
    MarkChannelReadResponse,
    MarkThreadReadRequest,
    MarkThreadReadResponse,
    RemoveMembersRequest,
    RemoveMembersResponse,
    SetTypingRequest,
    SetTypingResponse,
    UpdateChannelRequest,
    UpdateChannelResponse,
)

from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.channel_member import ChatChannelMember as ChatChannelMemberModel
from uniffy.db import get_async_session
from uniffy.domains.auth.context import get_sender_info_from_context, get_user_id_from_context
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.channels.converters import (
    channel_to_proto,
    channel_type_from_proto,
    member_to_proto,
)
from uniffy.domains.chat.channels.operations import ChatChannelOperations


def _handle_error(e: Exception) -> None:
    """Map domain errors to ConnectRPC errors."""
    if isinstance(e, NotFoundError):
        raise ConnectError(Code.NOT_FOUND, str(e))
    if isinstance(e, PermissionDeniedError):
        raise ConnectError(Code.PERMISSION_DENIED, str(e))
    if isinstance(e, ValidationError):
        raise ConnectError(Code.INVALID_ARGUMENT, str(e))
    if isinstance(e, ConflictError):
        raise ConnectError(Code.ALREADY_EXISTS, str(e))
    logger.exception(f"Unexpected error: {e}")
    raise ConnectError(Code.INTERNAL, "Internal error")


class ChannelHandlers:
    """Channel RPC handlers."""

    async def create_channel(
        self,
        request: CreateChannelRequest,
        ctx: RequestContext,
    ) -> CreateChannelResponse:
        """Create a new channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        channel_type = channel_type_from_proto(request.channel_type)
        member_ids = [UUID(m) for m in request.member_ids] if request.member_ids else None

        category_id = None
        if request.HasField("category_id"):
            try:
                category_id = UUID(request.category_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid category_id")

        try:
            async for session in get_async_session():
                access = ChatAccessChecker(session)
                ops = ChatChannelOperations(session, access)

                from uniffy.core.models.chat.channel import ChannelType

                if channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
                    channel = await ops.create_dm(
                        user_id=user_id,
                        organization_id=org_id,
                        target_user_ids=member_ids or [],
                    )
                else:
                    channel = await ops.create_channel(
                        user_id=user_id,
                        organization_id=org_id,
                        name=request.name,
                        channel_type=channel_type,
                        description=request.description if request.HasField("description") else "",
                        icon=request.icon if request.HasField("icon") else "",
                        is_default=request.is_default if request.HasField("is_default") else False,
                        category_id=category_id,
                        member_ids=member_ids,
                    )

                # Fetch stats for response
                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(
                        ChatChannelStats.channel_id == channel.id
                    )
                )
                stats = stats_result.scalar_one_or_none()

                return CreateChannelResponse(
                    channel=channel_to_proto(channel, stats)
                )
        except (NotFoundError, PermissionDeniedError, ValidationError, ConflictError) as e:
            _handle_error(e)

    async def get_channel(
        self,
        request: GetChannelRequest,
        ctx: RequestContext,
    ) -> GetChannelResponse:
        """Get a channel by ID."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                access = ChatAccessChecker(session)
                ops = ChatChannelOperations(session, access)
                channel = await ops.get_by_id(user_id, org_id, channel_id)

                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(
                        ChatChannelStats.channel_id == channel.id
                    )
                )
                stats = stats_result.scalar_one_or_none()

                membership = await access.get_membership(channel_id, user_id)
                role = membership.role if membership else None

                # Fetch DM member IDs for DM channels
                dm_ids: list[str] | None = None
                if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
                    member_rows = await session.execute(
                        select(ChatChannelMemberModel.user_id).where(
                            ChatChannelMemberModel.channel_id == channel_id
                        )
                    )
                    dm_ids = [str(r[0]) for r in member_rows.all()]

                return GetChannelResponse(
                    channel=channel_to_proto(
                        channel, stats,
                        current_user_role=role,
                        is_member=membership is not None,
                        dm_member_ids=dm_ids,
                    )
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def update_channel(
        self,
        request: UpdateChannelRequest,
        ctx: RequestContext,
    ) -> UpdateChannelResponse:
        """Update a channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        updates = {}
        if request.HasField("name"):
            updates["name"] = request.name
        if request.HasField("description"):
            updates["description"] = request.description
        if request.HasField("icon"):
            updates["icon"] = request.icon
        if request.HasField("is_default"):
            updates["is_default"] = request.is_default

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                channel = await ops.update(
                    user_id, org_id, channel_id, **updates
                )

                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(
                        ChatChannelStats.channel_id == channel.id
                    )
                )
                stats = stats_result.scalar_one_or_none()

                return UpdateChannelResponse(
                    channel=channel_to_proto(channel, stats)
                )
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def archive_channel(
        self,
        request: ArchiveChannelRequest,
        ctx: RequestContext,
    ) -> ArchiveChannelResponse:
        """Archive a channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                await ops.archive_channel(user_id, org_id, channel_id)
                return ArchiveChannelResponse()
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def delete_channel(
        self,
        request: DeleteChannelRequest,
        ctx: RequestContext,
    ) -> DeleteChannelResponse:
        """Delete a channel (soft delete)."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                await ops.delete(user_id, org_id, channel_id)
                return DeleteChannelResponse()
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def list_channels(
        self,
        request: ListChannelsRequest,
        ctx: RequestContext,
    ) -> ListChannelsResponse:
        """List channels (user's channels or all public)."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)

                if request.browse_public:
                    rows = await ops.list_public_channels(org_id)
                    channels = [
                        channel_to_proto(ch, stats, is_member=False)
                        for ch, stats in rows
                    ]
                else:
                    rows = await ops.list_user_channels(user_id, org_id)

                    # Batch-fetch member IDs for DM channels
                    dm_channel_ids = [
                        ch.id for ch, _, _ in rows
                        if ch.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM)
                    ]
                    dm_members_map: dict[str, list[str]] = {}
                    if dm_channel_ids:
                        member_rows = await session.execute(
                            select(
                                ChatChannelMemberModel.channel_id,
                                ChatChannelMemberModel.user_id,
                            ).where(
                                ChatChannelMemberModel.channel_id.in_(dm_channel_ids)
                            )
                        )
                        for row in member_rows.all():
                            cid = str(row[0])
                            uid = str(row[1])
                            dm_members_map.setdefault(cid, []).append(uid)

                    channels = [
                        channel_to_proto(
                            ch, stats,
                            current_user_role=role,
                            is_member=True,
                            dm_member_ids=dm_members_map.get(str(ch.id)),
                        )
                        for ch, stats, role in rows
                    ]

                return ListChannelsResponse(channels=channels)
        except Exception as e:
            _handle_error(e)

    async def join_channel(
        self,
        request: JoinChannelRequest,
        ctx: RequestContext,
    ) -> JoinChannelResponse:
        """Self-join a public channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                channel = await ops.join_channel(user_id, org_id, channel_id)

                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(
                        ChatChannelStats.channel_id == channel.id
                    )
                )
                stats = stats_result.scalar_one_or_none()

                return JoinChannelResponse(
                    channel=channel_to_proto(channel, stats, is_member=True)
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def leave_channel(
        self,
        request: LeaveChannelRequest,
        ctx: RequestContext,
    ) -> LeaveChannelResponse:
        """Leave a channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                await ops.leave_channel(user_id, org_id, channel_id)
                return LeaveChannelResponse()
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def add_members(
        self,
        request: AddMembersRequest,
        ctx: RequestContext,
    ) -> AddMembersResponse:
        """Add members to a channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            member_ids = [UUID(m) for m in request.user_ids]
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                added = await ops.add_members(
                    user_id, org_id, channel_id, member_ids
                )
                return AddMembersResponse(
                    members=[member_to_proto(m) for m in added]
                )
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def remove_members(
        self,
        request: RemoveMembersRequest,
        ctx: RequestContext,
    ) -> RemoveMembersResponse:
        """Remove members from a channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            member_ids = [UUID(m) for m in request.user_ids]
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                await ops.remove_members(
                    user_id, org_id, channel_id, member_ids
                )
                return RemoveMembersResponse()
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def get_members(
        self,
        request: GetMembersRequest,
        ctx: RequestContext,
    ) -> GetMembersResponse:
        """Get channel members."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = ChatChannelOperations(session)
                rows = await ops.get_members(user_id, org_id, channel_id)
                return GetMembersResponse(
                    members=[member_to_proto(m, u) for m, u in rows]
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def set_typing(
        self,
        request: SetTypingRequest,
        ctx: RequestContext,
    ) -> SetTypingResponse:
        """Publish a typing indicator for the current user."""
        user_id = get_user_id_from_context(ctx)
        jwt_name, _ = get_sender_info_from_context(ctx)
        try:
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid channel_id")

        try:
            from sqlalchemy import select

            from uniffy.core.models.chat.channel_member import ChatChannelMember
            from uniffy.domains.chat.streaming.events import (
                TYPING_STARTED,
                build_typing_payload,
            )
            from uniffy.domains.chat.streaming.publisher import (
                publish_channel_event_to_members,
            )

            async for session in get_async_session():
                member_result = await session.execute(
                    select(ChatChannelMember.user_id).where(
                        ChatChannelMember.channel_id == channel_id
                    )
                )
                member_ids = [r[0] for r in member_result.all()]

                # Skip typing fan-out for large channels. The N publish
                # commands per keystroke overwhelm the stream and provide
                # diminishing value in busy channels.
                limit = int(os.getenv("CHAT_TYPING_MEMBER_LIMIT", "50"))
                if len(member_ids) > limit:
                    return SetTypingResponse()

                await publish_channel_event_to_members(
                    member_ids,
                    TYPING_STARTED,
                    build_typing_payload(user_id, jwt_name),
                    channel_id=channel_id,
                    exclude_user_id=user_id,
                )
                return SetTypingResponse()
        except Exception as e:
            logger.warning(f"SetTyping failed: {e}")
            return SetTypingResponse()

    async def mark_channel_read(
        self,
        request: MarkChannelReadRequest,
        ctx: RequestContext,
    ) -> MarkChannelReadResponse:
        """Mark a channel as read up to a message."""
        user_id = get_user_id_from_context(ctx)
        try:
            UUID(request.organization_id)  # validate format
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.last_read_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        async for session in get_async_session():
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            ops = ChatReadStateOperations(session)
            await ops.mark_channel_read(user_id, channel_id, message_id)
            return MarkChannelReadResponse()

    async def mark_thread_read(
        self,
        request: MarkThreadReadRequest,
        ctx: RequestContext,
    ) -> MarkThreadReadResponse:
        """Mark a thread as read."""
        user_id = get_user_id_from_context(ctx)
        try:
            root_id = UUID(request.root_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid root_message_id")

        async for session in get_async_session():
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            ops = ChatReadStateOperations(session)
            await ops.mark_thread_read(user_id, root_id)
            return MarkThreadReadResponse()

    async def get_unread_counts(
        self,
        request: GetUnreadCountsRequest,
        ctx: RequestContext,
    ) -> GetUnreadCountsResponse:
        """Get unread counts for all user's channels."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        async for session in get_async_session():
            from uniffy.domains.chat.channels.operations import ChatChannelOperations
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            ch_ops = ChatChannelOperations(session)
            rows = await ch_ops.list_user_channels(user_id, org_id)
            channel_ids = [ch.id for ch, _, _ in rows]

            read_ops = ChatReadStateOperations(session)
            counts = await read_ops.get_unread_counts(user_id, channel_ids)

            from uniffy_proto.chat.v1.chat_pb2 import ChannelUnreadCount

            items = []
            for cid, data in counts.items():
                item = ChannelUnreadCount(
                    channel_id=str(cid),
                    unread_count=data["unread_count"],
                    mention_count=data["mention_count"],
                )
                if data["last_read_message_id"]:
                    item.last_read_message_id = str(data["last_read_message_id"])
                items.append(item)

            return GetUnreadCountsResponse(channels=items)

    async def get_channel_resources(
        self,
        request: GetChannelResourcesRequest,
        ctx: RequestContext,
    ) -> GetChannelResourcesResponse:
        """Get auto-tracked resources for a channel."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                # Verify access
                access = ChatAccessChecker(session)
                channel = await access.get_channel(channel_id, org_id)
                await access.check_access(user_id, org_id, channel)

                from uniffy.domains.chat.resources.operations import (
                    ChatResourceOperations,
                )

                ops = ChatResourceOperations(session)
                ct_filter = None
                if request.HasField("content_type_filter"):
                    ct_filter = request.content_type_filter

                resources, total = await ops.get_channel_resources(
                    channel_id,
                    content_type_filter=ct_filter,
                    limit=request.limit or 50,
                    offset=request.offset or 0,
                )

                from uniffy_proto.chat.v1.chat_pb2 import ChatResource

                proto_resources = []
                for r in resources:
                    proto_resources.append(ChatResource(
                        id=str(r.id),
                        channel_id=str(r.channel_id),
                        urn=r.urn,
                        content_type=r.content_type.value,
                        mention_count=r.mention_count,
                        first_mentioned_by=str(r.first_mentioned_by),
                    ))

                return GetChannelResourcesResponse(
                    resources=proto_resources,
                    total_count=total,
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)
