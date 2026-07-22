"""Proto <-> domain converters for chat channels."""

from uniffy_proto.chat.v1.chat_pb2 import (
    ChannelRole as ProtoChannelRole,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChannelType as ProtoChannelType,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatChannel as ProtoChatChannel,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatChannelCategory as ProtoChatChannelCategory,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatChannelMember as ProtoChatChannelMember,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatNotificationLevel as ProtoNotificationLevel,
)
from uniffy_proto.chat.v1.chat_pb2 import (
    ChatSubject as ProtoChatSubject,
)
from uniffy_proto.common.v1.common_pb2 import SubjectType as ProtoSubjectType

from uuid import UUID

from uniffy.core.avatars import get_avatar_url
from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
    ChatNotificationLevel,
)
from uniffy.core.models.login.user import User
from uniffy.core.types import SubjectType
from uniffy.domains.tags import Tag
from uniffy.domains.tags.converters import tag_to_proto

_SUBJECT_TYPE_TO_PROTO = {
    SubjectType.USER: ProtoSubjectType.SUBJECT_TYPE_USER,
    SubjectType.GROUP: ProtoSubjectType.SUBJECT_TYPE_GROUP,
    SubjectType.ORGANIZATION: ProtoSubjectType.SUBJECT_TYPE_ORGANIZATION,
    SubjectType.AGENT: ProtoSubjectType.SUBJECT_TYPE_AGENT,
}

CHANNEL_TYPE_TO_PROTO = {
    ChannelType.PUBLIC: ProtoChannelType.CHANNEL_TYPE_PUBLIC,
    ChannelType.PRIVATE: ProtoChannelType.CHANNEL_TYPE_PRIVATE,
    ChannelType.DIRECT: ProtoChannelType.CHANNEL_TYPE_DIRECT,
    ChannelType.GROUP_DM: ProtoChannelType.CHANNEL_TYPE_GROUP_DM,
}

CHANNEL_TYPE_FROM_PROTO = {
    ProtoChannelType.CHANNEL_TYPE_PUBLIC: ChannelType.PUBLIC,
    ProtoChannelType.CHANNEL_TYPE_PRIVATE: ChannelType.PRIVATE,
    ProtoChannelType.CHANNEL_TYPE_DIRECT: ChannelType.DIRECT,
    ProtoChannelType.CHANNEL_TYPE_GROUP_DM: ChannelType.GROUP_DM,
}

CHANNEL_ROLE_TO_PROTO = {
    ChannelRole.OWNER: ProtoChannelRole.CHANNEL_ROLE_OWNER,
    ChannelRole.ADMIN: ProtoChannelRole.CHANNEL_ROLE_ADMIN,
    ChannelRole.MEMBER: ProtoChannelRole.CHANNEL_ROLE_MEMBER,
}

CHANNEL_ROLE_FROM_PROTO = {
    ProtoChannelRole.CHANNEL_ROLE_OWNER: ChannelRole.OWNER,
    ProtoChannelRole.CHANNEL_ROLE_ADMIN: ChannelRole.ADMIN,
    ProtoChannelRole.CHANNEL_ROLE_MEMBER: ChannelRole.MEMBER,
}

NOTIFICATION_LEVEL_TO_PROTO = {
    ChatNotificationLevel.ALL: ProtoNotificationLevel.CHAT_NOTIFICATION_LEVEL_ALL,
    ChatNotificationLevel.MENTIONS: ProtoNotificationLevel.CHAT_NOTIFICATION_LEVEL_MENTIONS,
    ChatNotificationLevel.NONE: ProtoNotificationLevel.CHAT_NOTIFICATION_LEVEL_NONE,
}


def channel_type_from_proto(
    proto_type: ProtoChannelType.ValueType,
) -> ChannelType:
    ct = CHANNEL_TYPE_FROM_PROTO.get(proto_type)
    if ct is None:
        return ChannelType.PUBLIC
    return ct


def channel_to_proto(
    channel: ChatChannel,
    stats: ChatChannelStats | None = None,
    current_user_role: ChannelRole | None = None,
    is_member: bool | None = None,
    dm_member_ids: list[str] | None = None,
    tags: list[Tag] | None = None,
    agent_folder_id: UUID | None = None,
) -> ProtoChatChannel:
    proto = ProtoChatChannel(
        id=str(channel.id),
        organization_id=str(channel.organization_id),
        owner_id=str(channel.owner_id),
        name=channel.name,
        slug=channel.slug,
        description=channel.description or "",
        channel_type=CHANNEL_TYPE_TO_PROTO.get(
            channel.channel_type, ProtoChannelType.CHANNEL_TYPE_PUBLIC
        ),
        is_encrypted=channel.is_encrypted,
        is_archived=channel.is_archived,
        is_default=channel.is_default,
        icon=channel.icon or "",
    )

    if channel.category_id:
        proto.category_id = str(channel.category_id)

    proto.is_agent_dm = channel.is_agent_dm
    if channel.custom_name is not None:
        proto.custom_name = channel.custom_name
    if channel.agent_id is not None:
        proto.agent_id = str(channel.agent_id)
    if agent_folder_id is not None:
        proto.agent_folder_id = str(agent_folder_id)

    if channel.created_at:
        proto.created_at.CopyFrom(datetime_to_timestamp(channel.created_at))
    if channel.updated_at:
        proto.updated_at.CopyFrom(datetime_to_timestamp(channel.updated_at))

    if stats:
        proto.message_count = stats.message_count
        proto.root_message_count = stats.root_message_count
        proto.member_count = stats.member_count
        if stats.last_message_at:
            proto.last_message_at.CopyFrom(datetime_to_timestamp(stats.last_message_at))
        if stats.last_root_message_at:
            proto.last_root_message_at.CopyFrom(datetime_to_timestamp(stats.last_root_message_at))

    if current_user_role is not None:
        proto.current_user_role = CHANNEL_ROLE_TO_PROTO.get(
            current_user_role, ProtoChannelRole.CHANNEL_ROLE_MEMBER
        )
    if is_member is not None:
        proto.is_member = is_member

    if dm_member_ids:
        proto.dm_member_ids[:] = dm_member_ids

    if tags:
        proto.tags.extend(tag_to_proto(t) for t in tags)

    return proto


def member_to_proto(
    member: ChatChannelMember,
    user: User | None = None,
    display_name: str | None = None,
    avatar_key: str | None = None,
) -> ProtoChatChannelMember:
    # user_id stays populated for SUBJECT_TYPE_USER rows (empty for agents) until readers migrate.
    proto = ProtoChatChannelMember(
        channel_id=str(member.channel_id),
        user_id=str(member.user_id) if member.user_id is not None else "",
        role=CHANNEL_ROLE_TO_PROTO.get(member.role, ProtoChannelRole.CHANNEL_ROLE_MEMBER),
        notification_level=NOTIFICATION_LEVEL_TO_PROTO.get(
            member.notification_level,
            ProtoNotificationLevel.CHAT_NOTIFICATION_LEVEL_ALL,
        ),
        is_muted=member.is_muted,
        follow_all_threads=member.follow_all_threads,
        subject=ProtoChatSubject(
            type=_SUBJECT_TYPE_TO_PROTO.get(member.subject_type, ProtoSubjectType.SUBJECT_TYPE_USER),
            id=str(member.subject_id),
        ),
    )
    if member.joined_at:
        proto.joined_at.CopyFrom(datetime_to_timestamp(member.joined_at))
    if member.muted_until:
        proto.muted_until.CopyFrom(datetime_to_timestamp(member.muted_until))

    if user:
        proto.display_name = user.full_name or ""
        proto.email = user.email
        if user.avatar_key:
            proto.avatar_url = get_avatar_url(user.id, user.avatar_key)
    else:
        if display_name:
            proto.display_name = display_name
        # The keyless branch carries agent rows (GetMembers joins agents).
        if avatar_key:
            proto.avatar_url = get_avatar_url(
                member.subject_id, avatar_key, url_prefix="/api/agents/avatars"
            )

    return proto


def category_to_proto(
    category: ChatChannelCategory,
) -> ProtoChatChannelCategory:
    proto = ProtoChatChannelCategory(
        id=str(category.id),
        organization_id=str(category.organization_id),
        name=category.name,
        position=category.position,
    )
    if category.created_at:
        proto.created_at.CopyFrom(datetime_to_timestamp(category.created_at))
    if category.updated_at:
        proto.updated_at.CopyFrom(datetime_to_timestamp(category.updated_at))
    return proto
