"""Chat channel RPC handlers - thin layer delegating to operations."""

import os
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.chat.v1.chat_pb2 import (
    AddMembersRequest,
    AddMembersResponse,
    ArchiveChannelRequest,
    ArchiveChannelResponse,
    CreateAgentChatRequest,
    CreateAgentChatResponse,
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
    ListAgentChatsRequest,
    ListAgentChatsResponse,
    ListChannelsRequest,
    ListChannelsResponse,
    MarkChannelReadRequest,
    MarkChannelReadResponse,
    MarkThreadReadRequest,
    MarkThreadReadResponse,
    RemoveMembersRequest,
    RemoveMembersResponse,
    RenameAgentChatRequest,
    RenameAgentChatResponse,
    SetTypingRequest,
    SetTypingResponse,
    UpdateChannelMemberRequest,
    UpdateChannelMemberResponse,
    UpdateChannelRequest,
    UpdateChannelResponse,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatNotificationLevel as ProtoNL,
)

from uniffy.core.converters import SUBJECT_TYPE_FROM_PROTO
from uniffy.core.errors import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.models.chat.channel import ChannelType
from uniffy.core.models.chat.channel_member import ChatChannelMember as ChatChannelMemberModel
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType, SubjectType
from uniffy.db import open_session
from uniffy.domains.auth.context import get_sender_info_from_context, get_user_id_from_context
from uniffy.domains.chat.access import ChatAccessChecker
from uniffy.domains.chat.cache import (
    get_cached_dm_peers,
    get_cached_dm_peers_many,
    set_cached_dm_peers,
)
from uniffy.domains.chat.channels.converters import (
    channel_to_proto,
    channel_type_from_proto,
    member_to_proto,
)
from uniffy.domains.chat.channels.operations import ChatChannelOperations
from uniffy.domains.chat.subjects import ChatSubject
from uniffy.domains.notifications.operations import NotificationOperations
from uniffy.domains.tags import Tag, TagOperations


def _parse_subjects(proto_subjects, user_ids_fallback: list[str]) -> list[ChatSubject]:
    """Parse proto ChatSubject[] with legacy user_ids fallback.

    When both are populated, subjects wins and user_ids are merged in as
    USER subjects (server-side union per chat.proto:350). Unsupported
    subject types (GROUP, ORGANIZATION) are rejected with INVALID_ARGUMENT.
    """
    out: list[ChatSubject] = []
    seen: set[tuple[SubjectType, UUID]] = set()

    for s in proto_subjects or ():
        dtype = SUBJECT_TYPE_FROM_PROTO.get(s.type)
        if dtype not in (SubjectType.USER, SubjectType.AGENT):
            raise ConnectError(
                Code.INVALID_ARGUMENT,
                "ChatSubject.type must be USER or AGENT",
            )
        try:
            sid = UUID(s.id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid subject id")
        key = (dtype, sid)
        if key not in seen:
            seen.add(key)
            out.append(ChatSubject(dtype, sid))

    for raw in user_ids_fallback or ():
        try:
            uid = UUID(raw)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid user id")
        key = (SubjectType.USER, uid)
        if key not in seen:
            seen.add(key)
            out.append(ChatSubject.user(uid))

    return out


def _parse_tag_ids(raw_ids: list[str]) -> list[UUID]:
    """Parse a repeated string proto field into a list of UUIDs.

    Empty input returns an empty list. Invalid UUIDs raise
    ``INVALID_ARGUMENT`` so the client gets actionable feedback before
    the operation runs.
    """
    out: list[UUID] = []
    for raw in raw_ids or ():
        try:
            out.append(UUID(raw))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid tag_id") from exc
    return out


async def _hydrate_channel_tags(
    session: AsyncSession,
    organization_id: UUID,
    channel_ids: list[UUID],
) -> dict[UUID, list[Tag]]:
    """Bulk-fetch unified-tag rows for a batch of channel ids.

    Single ``TagOperations.get_for_urns`` round-trip per request batch
    (no N+1). Returns a mapping keyed on channel id with an empty list
    for channels that have no tags. DM channels are filtered out by
    callers before hydration since they do not carry tags.
    """
    if not channel_ids:
        return {}
    urn_to_id = {
        build_content_urn(ContentType.CHAT, cid): cid for cid in channel_ids
    }
    tag_ops = TagOperations(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {cid: bulk.get(urn, []) for urn, cid in urn_to_id.items()}


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
        subjects = _parse_subjects(
            getattr(request, "members", None),
            list(request.member_ids) if request.member_ids else [],
        )

        category_id = None
        if request.HasField("category_id"):
            try:
                category_id = UUID(request.category_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid category_id")

        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                access = ChatAccessChecker(session)
                ops = ChatChannelOperations(session, access)

                from uniffy.core.models.chat.channel import ChannelType

                if channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
                    channel = await ops.create_dm_with_subjects(
                        user_id=user_id,
                        organization_id=org_id,
                        subjects=subjects,
                    )
                else:
                    user_member_ids = [
                        s.subject_id for s in subjects if s.subject_type == SubjectType.USER
                    ]
                    channel = await ops.create_channel(
                        user_id=user_id,
                        organization_id=org_id,
                        name=request.name,
                        channel_type=channel_type,
                        description=request.description if request.HasField("description") else "",
                        icon=request.icon if request.HasField("icon") else "",
                        is_default=request.is_default if request.HasField("is_default") else False,
                        category_id=category_id,
                        member_ids=user_member_ids or None,
                        tag_ids=tag_ids or None,
                    )
                    agent_subjects = [s for s in subjects if s.subject_type == SubjectType.AGENT]
                    if agent_subjects:
                        await ops.add_members_with_subjects(
                            user_id=user_id,
                            organization_id=org_id,
                            channel_id=channel.id,
                            subjects=agent_subjects,
                        )

                # Fetch stats for response
                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(ChatChannelStats.channel_id == channel.id)
                )
                stats = stats_result.scalar_one_or_none()

                tags_by_id = await _hydrate_channel_tags(session, org_id, [channel.id])

                return CreateChannelResponse(
                    channel=channel_to_proto(
                        channel, stats, tags=tags_by_id.get(channel.id)
                    )
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
            async with open_session() as session:
                access = ChatAccessChecker(session)
                ops = ChatChannelOperations(session, access)
                channel = await ops.get_by_id(user_id, org_id, channel_id)

                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(ChatChannelStats.channel_id == channel.id)
                )
                stats = stats_result.scalar_one_or_none()

                membership = await access.get_membership(channel_id, user_id)
                role = membership.role if membership else None

                # Fetch DM member IDs for DM channels. Read `subject_id` so
                # agent members surface too - `user_id` is NULL for AGENT rows.
                # Valkey DM-peer cache short-circuits the per-channel join.
                dm_ids: list[str] | None = None
                if channel.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM):
                    cached_peers = await get_cached_dm_peers(channel_id)
                    if cached_peers is not None:
                        dm_ids = cached_peers
                    else:
                        member_rows = await session.execute(
                            select(ChatChannelMemberModel.subject_id).where(
                                ChatChannelMemberModel.channel_id == channel_id
                            )
                        )
                        dm_ids = [
                            str(r[0]) for r in member_rows.all() if r[0] is not None
                        ]
                        await set_cached_dm_peers(channel_id, dm_ids)

                tags_by_id = await _hydrate_channel_tags(session, org_id, [channel.id])

                return GetChannelResponse(
                    channel=channel_to_proto(
                        channel,
                        stats,
                        current_user_role=role,
                        is_member=membership is not None,
                        dm_member_ids=dm_ids,
                        tags=tags_by_id.get(channel.id),
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
        if request.HasField("tag_ids"):
            updates["tag_ids"] = _parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                channel = await ops.update(user_id, org_id, channel_id, **updates)

                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(ChatChannelStats.channel_id == channel.id)
                )
                stats = stats_result.scalar_one_or_none()

                tags_by_id = await _hydrate_channel_tags(session, org_id, [channel.id])

                return UpdateChannelResponse(
                    channel=channel_to_proto(
                        channel, stats, tags=tags_by_id.get(channel.id)
                    )
                )
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def create_agent_chat(
        self,
        request: CreateAgentChatRequest,
        ctx: RequestContext,
    ) -> CreateAgentChatResponse:
        """Create a new named chat between the user and an agent."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        custom_name = request.custom_name if request.HasField("custom_name") else None

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                channel = await ops.create_agent_chat(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    custom_name=custom_name,
                )

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(ChatChannelStats.channel_id == channel.id)
                )
                stats = stats_result.scalar_one_or_none()

                dm_ids = [str(user_id), str(agent_id)]

                return CreateAgentChatResponse(
                    channel=channel_to_proto(
                        channel,
                        stats,
                        current_user_role=None,
                        is_member=True,
                        dm_member_ids=dm_ids,
                    )
                )
        except (NotFoundError, PermissionDeniedError, ValidationError, ConflictError) as e:
            _handle_error(e)

    async def rename_agent_chat(
        self,
        request: RenameAgentChatRequest,
        ctx: RequestContext,
    ) -> RenameAgentChatResponse:
        """Set or clear the user's custom name for an agent chat."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        custom_name = request.custom_name if request.HasField("custom_name") else None

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                channel = await ops.rename_agent_chat(
                    user_id=user_id,
                    organization_id=org_id,
                    channel_id=channel_id,
                    custom_name=custom_name,
                )

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(ChatChannelStats.channel_id == channel.id)
                )
                stats = stats_result.scalar_one_or_none()

                return RenameAgentChatResponse(channel=channel_to_proto(channel, stats))
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def list_agent_chats(
        self,
        request: ListAgentChatsRequest,
        ctx: RequestContext,
    ) -> ListAgentChatsResponse:
        """List the user's agent chats, optionally filtered by ``agent_id``."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id")

        agent_filter: UUID | None = None
        if request.HasField("agent_id"):
            try:
                agent_filter = UUID(request.agent_id)
            except ValueError:
                raise ConnectError(Code.INVALID_ARGUMENT, "Invalid agent_id")

        cursor = request.cursor if request.HasField("cursor") else None
        limit = request.page_size if request.HasField("page_size") else 0

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                rows, next_cursor = await ops.list_agent_chats(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_filter,
                    cursor=cursor,
                    limit=limit,
                )

                channel_ids = [c.id for c, _ in rows]
                dm_ids_by_channel: dict[UUID, list[str]] = {}
                if channel_ids:
                    cached_map = await get_cached_dm_peers_many(channel_ids)
                    missing = [cid for cid in channel_ids if cid not in cached_map]
                    if missing:
                        member_rows = await session.execute(
                            select(
                                ChatChannelMemberModel.channel_id,
                                ChatChannelMemberModel.subject_id,
                            ).where(ChatChannelMemberModel.channel_id.in_(missing))
                        )
                        for cid, sid in member_rows.all():
                            if sid is None:
                                continue
                            dm_ids_by_channel.setdefault(cid, []).append(str(sid))
                        for cid in missing:
                            await set_cached_dm_peers(cid, dm_ids_by_channel.get(cid, []))
                    for cid, peers in cached_map.items():
                        dm_ids_by_channel[cid] = peers

                channels_proto = [
                    channel_to_proto(
                        channel,
                        stats,
                        is_member=True,
                        dm_member_ids=dm_ids_by_channel.get(channel.id),
                    )
                    for channel, stats in rows
                ]

                response = ListAgentChatsResponse(channels=channels_proto)
                if next_cursor is not None:
                    response.next_cursor = next_cursor
                return response
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
            async with open_session() as session:
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
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                await ops.delete_channel(user_id, org_id, channel_id)
                return DeleteChannelResponse()
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
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

        cursor = request.cursor if request.HasField("cursor") else None
        page_size = (
            request.page_size if request.HasField("page_size") and request.page_size > 0 else None
        )
        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)

                if request.browse_public:
                    rows, next_cursor = await ops.list_public_channels(
                        org_id,
                        cursor=cursor,
                        limit=page_size,
                        tag_ids=tag_ids or None,
                    )
                    public_channel_ids = [
                        ch.id
                        for ch, _ in rows
                        if ch.channel_type not in (ChannelType.DIRECT, ChannelType.GROUP_DM)
                    ]
                    public_tags = await _hydrate_channel_tags(
                        session, org_id, public_channel_ids
                    )
                    channels = [
                        channel_to_proto(
                            ch,
                            stats,
                            is_member=False,
                            tags=public_tags.get(ch.id),
                        )
                        for ch, stats in rows
                    ]
                else:
                    rows, next_cursor = await ops.list_user_channels(
                        user_id,
                        org_id,
                        cursor=cursor,
                        limit=page_size,
                        tag_ids=tag_ids or None,
                    )

                    # Batch-fetch member IDs for DM channels via the
                    # DM-peer cache: one MGET against Valkey covers the
                    # hits, and a single PG round-trip backfills the misses.
                    dm_channel_ids = [
                        ch.id
                        for ch, _, _ in rows
                        if ch.channel_type in (ChannelType.DIRECT, ChannelType.GROUP_DM)
                    ]
                    dm_members_map: dict[str, list[str]] = {}
                    if dm_channel_ids:
                        hit_map, miss_cids = await get_cached_dm_peers_many(
                            dm_channel_ids
                        )
                        for cid, peers in hit_map.items():
                            dm_members_map[str(cid)] = peers
                        if miss_cids:
                            member_rows = await session.execute(
                                select(
                                    ChatChannelMemberModel.channel_id,
                                    ChatChannelMemberModel.subject_id,
                                ).where(
                                    ChatChannelMemberModel.channel_id.in_(miss_cids)
                                )
                            )
                            miss_buckets: dict[UUID, list[str]] = {
                                cid: [] for cid in miss_cids
                            }
                            for row in member_rows.all():
                                if row[1] is None:
                                    continue
                                miss_buckets.setdefault(row[0], []).append(
                                    str(row[1])
                                )
                            for cid, peers in miss_buckets.items():
                                dm_members_map[str(cid)] = peers
                                await set_cached_dm_peers(cid, peers)

                    user_channel_ids = [
                        ch.id
                        for ch, _, _ in rows
                        if ch.channel_type not in (ChannelType.DIRECT, ChannelType.GROUP_DM)
                    ]
                    user_tags = await _hydrate_channel_tags(
                        session, org_id, user_channel_ids
                    )
                    channels = [
                        channel_to_proto(
                            ch,
                            stats,
                            current_user_role=role,
                            is_member=True,
                            dm_member_ids=dm_members_map.get(str(ch.id)),
                            tags=user_tags.get(ch.id),
                        )
                        for ch, stats, role in rows
                    ]

                response = ListChannelsResponse(channels=channels)
                if next_cursor:
                    response.next_cursor = next_cursor
                return response
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
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                channel = await ops.join_channel(user_id, org_id, channel_id)

                from sqlalchemy import select

                from uniffy.core.models.chat.channel import ChatChannelStats

                stats_result = await session.execute(
                    select(ChatChannelStats).where(ChatChannelStats.channel_id == channel.id)
                )
                stats = stats_result.scalar_one_or_none()

                tags_by_id = await _hydrate_channel_tags(session, org_id, [channel.id])

                return JoinChannelResponse(
                    channel=channel_to_proto(
                        channel,
                        stats,
                        is_member=True,
                        tags=tags_by_id.get(channel.id),
                    )
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
            async with open_session() as session:
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
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        subjects = _parse_subjects(getattr(request, "subjects", None), list(request.user_ids))

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                added = await ops.add_members_with_subjects(user_id, org_id, channel_id, subjects)
                return AddMembersResponse(members=[member_to_proto(m) for m in added])
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
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        subjects = _parse_subjects(getattr(request, "subjects", None), list(request.user_ids))

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                await ops.remove_members_with_subjects(user_id, org_id, channel_id, subjects)
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

        cursor = request.cursor if request.HasField("cursor") else None
        page_size = (
            request.page_size if request.HasField("page_size") and request.page_size > 0 else None
        )

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                rows, next_cursor = await ops.get_members(
                    user_id,
                    org_id,
                    channel_id,
                    cursor=cursor,
                    limit=page_size,
                )
                response = GetMembersResponse(
                    members=[
                        member_to_proto(
                            m,
                            u,
                            display_name=a.name if a else None,
                            avatar_key=a.avatar_key if a else None,
                        )
                        for m, u, a in rows
                    ]
                )
                if next_cursor:
                    response.next_cursor = next_cursor
                return response
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
            _handle_error(e)

    async def update_channel_member(
        self,
        request: UpdateChannelMemberRequest,
        ctx: RequestContext,
    ) -> UpdateChannelMemberResponse:
        """Update a channel member's preferences (mute, notification level)."""
        user_id = get_user_id_from_context(ctx)
        try:
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            target_user_id = UUID(request.user_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        is_muted = request.is_muted if request.HasField("is_muted") else None
        notification_level = None
        if request.HasField("notification_level"):
            nl_map = {
                ProtoNL.CHAT_NOTIFICATION_LEVEL_ALL: "ALL",
                ProtoNL.CHAT_NOTIFICATION_LEVEL_MENTIONS: "MENTIONS",
                ProtoNL.CHAT_NOTIFICATION_LEVEL_NONE: "NONE",
            }
            notification_level = nl_map.get(request.notification_level)

        muted_until = ChatChannelOperations._MUTED_UNTIL_UNSET
        if request.HasField("muted_until"):
            muted_until = request.muted_until.ToDatetime()

        follow_all_threads = None
        if request.HasField("follow_all_threads"):
            follow_all_threads = request.follow_all_threads

        badge_all_messages = None
        if request.HasField("badge_all_messages"):
            badge_all_messages = request.badge_all_messages

        try:
            async with open_session() as session:
                ops = ChatChannelOperations(session)
                member, user = await ops.update_member(
                    user_id,
                    org_id,
                    channel_id,
                    target_user_id,
                    is_muted=is_muted,
                    notification_level=notification_level,
                    muted_until=muted_until,
                    follow_all_threads=follow_all_threads,
                    badge_all_messages=badge_all_messages,
                )
                return UpdateChannelMemberResponse(
                    member=member_to_proto(member, user),
                )
        except (NotFoundError, PermissionDeniedError, ValidationError) as e:
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

            async with open_session() as session:
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
            org_id = UUID(request.organization_id)
            channel_id = UUID(request.channel_id)
            message_id = UUID(request.last_read_message_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        async with open_session() as session:
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            ops = ChatReadStateOperations(session)
            await ops.mark_channel_read(user_id, channel_id, message_id)

            # Cascade to in-app notifications: every notification emitted
            # for this channel (mention, DM, thread reply) carries
            # source_urn == channel_urn, so reading the channel must
            # clear the matching unread bell entries in one shot.
            channel_urn = f"urn:uniffy:content:CHAT:{channel_id}"
            await NotificationOperations(session).mark_read_by_source_urn(
                user_id=user_id,
                organization_id=org_id,
                source_urn=channel_urn,
            )

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

        async with open_session() as session:
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

        async with open_session() as session:
            from sqlalchemy import select as sa_select

            from uniffy.core.models.chat.channel_member import (
                ChatChannelMember as MemberModel,
            )
            from uniffy.domains.chat.channels.converters import NOTIFICATION_LEVEL_TO_PROTO
            from uniffy.domains.chat.channels.operations import ChatChannelOperations
            from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

            ch_ops = ChatChannelOperations(session)
            channel_ids = await ch_ops.list_user_channel_ids(user_id, org_id)

            read_ops = ChatReadStateOperations(session)
            counts = await read_ops.get_unread_counts(user_id, channel_ids)

            prefs_result = await session.execute(
                sa_select(
                    MemberModel.channel_id,
                    MemberModel.is_muted,
                    MemberModel.notification_level,
                    MemberModel.muted_until,
                ).where(
                    MemberModel.user_id == user_id,
                    MemberModel.channel_id.in_(channel_ids),
                )
            )
            prefs_map = {row[0]: (row[1], row[2], row[3]) for row in prefs_result.all()}

            from uniffy_proto.chat.v1.chat_pb2 import ChannelUnreadCount

            from uniffy.core.converters import datetime_to_timestamp

            items = []
            for cid, data in counts.items():
                is_muted, nl, muted_until = prefs_map.get(cid, (False, None, None))
                nl_proto = (
                    NOTIFICATION_LEVEL_TO_PROTO.get(nl, ProtoNL.CHAT_NOTIFICATION_LEVEL_ALL)
                    if nl
                    else ProtoNL.CHAT_NOTIFICATION_LEVEL_ALL
                )
                item = ChannelUnreadCount(
                    channel_id=str(cid),
                    unread_count=data["unread_count"],
                    mention_count=data["mention_count"],
                    is_muted=is_muted,
                    notification_level=nl_proto,
                )
                if data["last_read_message_id"]:
                    item.last_read_message_id = str(data["last_read_message_id"])
                if muted_until:
                    item.muted_until.CopyFrom(datetime_to_timestamp(muted_until))
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
            async with open_session() as session:
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

                # Resolve titles for mention-tracked resources (single Meilisearch call)
                title_map = await self._resolve_resource_titles(
                    session,
                    resources,
                    org_id,
                )

                from uniffy_proto.chat.v1.chat_pb2 import ChatResource as ProtoChatResource

                # Collect URNs from mention-tracked resources to deduplicate against attachments
                mention_urns: set[str] = set()
                proto_resources = []
                for r in resources:
                    mention_urns.add(r.urn)
                    title = title_map.get(r.urn, "")
                    proto_resources.append(
                        ProtoChatResource(
                            id=str(r.id),
                            channel_id=str(r.channel_id),
                            urn=r.urn,
                            content_type=r.content_type.value,
                            mention_count=r.mention_count,
                            first_mentioned_by=str(r.first_mentioned_by),
                            title=title,
                        )
                    )

                # Fetch inline file attachments for this channel's messages
                if not ct_filter or ct_filter.upper() == "FILE":
                    attachment_resources = await self._get_channel_attachments(
                        session,
                        channel_id,
                        mention_urns,
                    )
                    proto_resources.extend(attachment_resources)
                    total += len(attachment_resources)

                return GetChannelResourcesResponse(
                    resources=proto_resources,
                    total_count=total,
                )
        except (NotFoundError, PermissionDeniedError) as e:
            _handle_error(e)

    async def _get_channel_attachments(
        self,
        session: AsyncSession,
        channel_id: UUID,
        exclude_urns: set[str],
    ) -> list:
        """Fetch file attachments from channel messages, excluding already-tracked URNs."""
        from uniffy.core.models.attachments.attachment import Attachment
        from uniffy.core.models.chat.message import ChatMessage
        from uniffy.core.models.files.file import File
        from uniffy.core.models.shared import ContentType

        try:
            result = await session.execute(
                select(
                    Attachment.id,
                    Attachment.file_id,
                    Attachment.attached_by_user_id,
                    Attachment.attached_at,
                    File.filename,
                )
                .join(
                    ChatMessage,
                    (Attachment.content_id == ChatMessage.id)
                    & (Attachment.content_type == ContentType.CHAT_MESSAGE),
                )
                .join(
                    File,
                    File.id == Attachment.file_id,
                )
                .where(
                    ChatMessage.channel_id == channel_id,
                    ChatMessage.is_deleted == False,  # noqa: E712
                )
                .order_by(Attachment.attached_at.desc())
            )
            rows = result.all()

            from uniffy_proto.chat.v1.chat_pb2 import ChatResource as ProtoChatResource

            items = []
            for row in rows:
                att_id, file_id, user_id, attached_at, filename = row
                urn = f"urn:uniffy:content:FILE:{file_id}"
                if urn in exclude_urns:
                    continue
                items.append(
                    ProtoChatResource(
                        id=str(att_id),
                        channel_id=str(channel_id),
                        urn=urn,
                        content_type="FILE",
                        mention_count=1,
                        first_mentioned_by=str(user_id),
                        title=filename or "Untitled File",
                    )
                )
            return items
        except Exception:
            logger.warning(f"Failed to fetch attachments for channel {channel_id}")
            return []

    async def _resolve_resource_titles(
        self,
        session: AsyncSession,
        resources: list,
        organization_id: UUID,
    ) -> dict[str, str]:
        """Resolve display titles for resources via Meilisearch (single batch fetch).

        All indexed content stores `title` in Meilisearch, so one call resolves
        everything regardless of content type - no per-type PG queries needed.
        Falls back to User table for USER type since users may not be in the
        search index.
        """
        if not resources:
            return {}

        urns = [r.urn for r in resources]

        title_map: dict[str, str] = {}

        try:
            from uniffy.core.search.meilisearch import MeilisearchClient

            async with MeilisearchClient() as ms_client:
                docs = await ms_client.get_documents_by_urns(urns, organization_id)
                for urn, doc in docs.items():
                    title_map[urn] = doc.get("title", "")
        except Exception:
            logger.warning("Meilisearch title resolve failed, skipping")

        # Fallback for USER type (may not be in search index)
        user_urns = [
            r.urn for r in resources if r.content_type.value == "USER" and r.urn not in title_map
        ]
        if user_urns:
            from uniffy.core.models.login.user import User

            user_ids = []
            urn_id_map: dict[UUID, str] = {}
            for urn in user_urns:
                parts = urn.split(":")
                if len(parts) >= 5:
                    uid = UUID(parts[-1])
                    user_ids.append(uid)
                    urn_id_map[uid] = urn

            if user_ids:
                result = await session.execute(
                    select(User.id, User.full_name).where(User.id.in_(user_ids))
                )
                for row in result.all():
                    urn = urn_id_map.get(row[0])
                    if urn:
                        title_map[urn] = row[1] or "Unknown User"

        return title_map
