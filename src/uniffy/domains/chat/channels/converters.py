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

from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.models.chat.channel import ChannelType, ChatChannel, ChatChannelStats
from uniffy.core.models.chat.channel_category import ChatChannelCategory
from uniffy.core.models.chat.channel_member import (
    ChannelRole,
    ChatChannelMember,
    ChatNotificationLevel,
)
from uniffy.core.models.login.user import User

# Channel type mappings
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

# Channel role mappings
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
    """Convert proto ChannelType to domain ChannelType."""
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
) -> ProtoChatChannel:
    """Convert ChatChannel + stats to proto ChatChannel."""
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

    if channel.created_at:
        proto.created_at.CopyFrom(datetime_to_timestamp(channel.created_at))
    if channel.updated_at:
        proto.updated_at.CopyFrom(datetime_to_timestamp(channel.updated_at))

    # Embed stats
    if stats:
        proto.message_count = stats.message_count
        proto.root_message_count = stats.root_message_count
        proto.member_count = stats.member_count
        if stats.last_message_at:
            proto.last_message_at.CopyFrom(
                datetime_to_timestamp(stats.last_message_at)
            )
        if stats.last_root_message_at:
            proto.last_root_message_at.CopyFrom(
                datetime_to_timestamp(stats.last_root_message_at)
            )

    if current_user_role is not None:
        proto.current_user_role = CHANNEL_ROLE_TO_PROTO.get(
            current_user_role, ProtoChannelRole.CHANNEL_ROLE_MEMBER
        )
    if is_member is not None:
        proto.is_member = is_member

    if dm_member_ids:
        proto.dm_member_ids[:] = dm_member_ids

    return proto


def member_to_proto(
    member: ChatChannelMember,
    user: User | None = None,
) -> ProtoChatChannelMember:
    """Convert ChatChannelMember to proto."""
    proto = ProtoChatChannelMember(
        channel_id=str(member.channel_id),
        user_id=str(member.user_id),
        role=CHANNEL_ROLE_TO_PROTO.get(
            member.role, ProtoChannelRole.CHANNEL_ROLE_MEMBER
        ),
        notification_level=NOTIFICATION_LEVEL_TO_PROTO.get(
            member.notification_level,
            ProtoNotificationLevel.CHAT_NOTIFICATION_LEVEL_ALL,
        ),
        is_muted=member.is_muted,
    )
    if member.joined_at:
        proto.joined_at.CopyFrom(datetime_to_timestamp(member.joined_at))

    if user:
        proto.display_name = user.full_name or ""
        proto.email = user.email
        if user.avatar_key:
            proto.avatar_url = user.avatar_key

    return proto


def category_to_proto(
    category: ChatChannelCategory,
) -> ProtoChatChannelCategory:
    """Convert ChatChannelCategory to proto."""
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
