from collections.abc import Collection, Mapping
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import ContentRole, ContentType, SubjectType
from uniffy.domains.permissions.resource_access.subject import AccessSubject
from uniffy.domains.permissions.resource_access.types import (
    AccessGrantKind,
    RequestTarget,
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


async def resolve_chat_resources(
    session: AsyncSession,
    subject: AccessSubject,
    candidates: Mapping[ContentType, Collection[UUID]],
) -> dict[ResourceKey, ResourceAccessDecision]:
    channel_ids = set(candidates.get(ContentType.CHAT, ())) | set(
        candidates.get(ContentType.AGENT_CHAT, ())
    )
    message_ids = set(candidates.get(ContentType.CHAT_MESSAGE, ()))
    message_rows = []
    if message_ids:
        message_rows = (
            await session.execute(
                select(ChatMessage.id, ChatMessage.is_deleted, ChatMessage.channel_id).where(
                    ChatMessage.id.in_(message_ids)
                )
            )
        ).all()
        channel_ids.update(row.channel_id for row in message_rows)

    channel_rows = []
    if channel_ids:
        channel_rows = (
            await session.execute(
                select(
                    ChatChannel.id,
                    ChatChannel.channel_type,
                    ChatChannel.is_deleted,
                    ChatChannel.is_agent_dm,
                ).where(
                    ChatChannel.organization_id == subject.organization_id,
                    ChatChannel.id.in_(channel_ids),
                )
            )
        ).all()
    channels = {row.id: row for row in channel_rows}
    memberships = set()
    if subject.is_active_member and channels:
        memberships = set(
            (
                await session.execute(
                    select(ChatChannelMember.channel_id).where(
                        ChatChannelMember.channel_id.in_(channels),
                        ChatChannelMember.subject_type == SubjectType.USER,
                        ChatChannelMember.subject_id == subject.user_id,
                    )
                )
            ).scalars()
        )

    def channel_decision(key: ResourceKey, channel) -> ResourceAccessDecision:
        if channel is None:
            return ResourceAccessDecision(key, ResourceRowState.MISSING, False)
        if channel.is_deleted:
            return ResourceAccessDecision(key, ResourceRowState.DELETED, False)
        can_view = subject.is_active_member and (
            subject.is_chat_moderator
            or channel.channel_type == ChannelType.PUBLIC
            or channel.id in memberships
        )
        target = None
        if channel.channel_type == ChannelType.PRIVATE and not channel.is_agent_dm:
            target = RequestTarget(ContentType.CHAT, channel.id, AccessGrantKind.CHAT)
        return ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE,
            can_view=can_view,
            role=ContentRole.VIEWER if can_view else None,
            request_target=target,
        )

    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    for content_id in candidates.get(ContentType.CHAT, ()):
        key = ResourceKey(ContentType.CHAT, content_id)
        channel = channels.get(content_id)
        if channel is not None and channel.is_agent_dm:
            decisions[key] = ResourceAccessDecision(key, ResourceRowState.MISSING, False)
        else:
            decisions[key] = channel_decision(key, channel)
    for content_id in candidates.get(ContentType.AGENT_CHAT, ()):
        key = ResourceKey(ContentType.AGENT_CHAT, content_id)
        channel = channels.get(content_id)
        if channel is None or not channel.is_agent_dm:
            decisions[key] = ResourceAccessDecision(key, ResourceRowState.MISSING, False)
        else:
            base = channel_decision(key, channel)
            decisions[key] = ResourceAccessDecision(
                key=key,
                row_state=base.row_state,
                can_view=base.can_view,
                role=base.role,
            )
    for message in message_rows:
        key = ResourceKey(ContentType.CHAT_MESSAGE, message.id)
        parent = channel_decision(key, channels.get(message.channel_id))
        state = (
            ResourceRowState.DELETED
            if message.is_deleted or parent.row_state == ResourceRowState.DELETED
            else parent.row_state
        )
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=state,
            can_view=state == ResourceRowState.LIVE and parent.can_view,
            role=parent.role if state == ResourceRowState.LIVE else None,
            request_target=parent.request_target if state == ResourceRowState.LIVE else None,
        )
    return decisions
