import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from tags.v1 import tags_pb2 as _tags_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHANNEL_TYPE_UNSPECIFIED: _ClassVar[ChannelType]
    CHANNEL_TYPE_PUBLIC: _ClassVar[ChannelType]
    CHANNEL_TYPE_PRIVATE: _ClassVar[ChannelType]
    CHANNEL_TYPE_DIRECT: _ClassVar[ChannelType]
    CHANNEL_TYPE_GROUP_DM: _ClassVar[ChannelType]

class ChannelRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHANNEL_ROLE_UNSPECIFIED: _ClassVar[ChannelRole]
    CHANNEL_ROLE_MEMBER: _ClassVar[ChannelRole]
    CHANNEL_ROLE_ADMIN: _ClassVar[ChannelRole]
    CHANNEL_ROLE_OWNER: _ClassVar[ChannelRole]

class SenderType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SENDER_TYPE_UNSPECIFIED: _ClassVar[SenderType]
    SENDER_TYPE_USER: _ClassVar[SenderType]
    SENDER_TYPE_AGENT: _ClassVar[SenderType]
    SENDER_TYPE_SYSTEM: _ClassVar[SenderType]
    SENDER_TYPE_GUEST: _ClassVar[SenderType]

class ChatNotificationLevel(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHAT_NOTIFICATION_LEVEL_UNSPECIFIED: _ClassVar[ChatNotificationLevel]
    CHAT_NOTIFICATION_LEVEL_ALL: _ClassVar[ChatNotificationLevel]
    CHAT_NOTIFICATION_LEVEL_MENTIONS: _ClassVar[ChatNotificationLevel]
    CHAT_NOTIFICATION_LEVEL_NONE: _ClassVar[ChatNotificationLevel]

class AgentConfirmationDecision(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AGENT_CONFIRMATION_DECISION_UNSPECIFIED: _ClassVar[AgentConfirmationDecision]
    AGENT_CONFIRMATION_DECISION_APPROVE: _ClassVar[AgentConfirmationDecision]
    AGENT_CONFIRMATION_DECISION_DENY: _ClassVar[AgentConfirmationDecision]
CHANNEL_TYPE_UNSPECIFIED: ChannelType
CHANNEL_TYPE_PUBLIC: ChannelType
CHANNEL_TYPE_PRIVATE: ChannelType
CHANNEL_TYPE_DIRECT: ChannelType
CHANNEL_TYPE_GROUP_DM: ChannelType
CHANNEL_ROLE_UNSPECIFIED: ChannelRole
CHANNEL_ROLE_MEMBER: ChannelRole
CHANNEL_ROLE_ADMIN: ChannelRole
CHANNEL_ROLE_OWNER: ChannelRole
SENDER_TYPE_UNSPECIFIED: SenderType
SENDER_TYPE_USER: SenderType
SENDER_TYPE_AGENT: SenderType
SENDER_TYPE_SYSTEM: SenderType
SENDER_TYPE_GUEST: SenderType
CHAT_NOTIFICATION_LEVEL_UNSPECIFIED: ChatNotificationLevel
CHAT_NOTIFICATION_LEVEL_ALL: ChatNotificationLevel
CHAT_NOTIFICATION_LEVEL_MENTIONS: ChatNotificationLevel
CHAT_NOTIFICATION_LEVEL_NONE: ChatNotificationLevel
AGENT_CONFIRMATION_DECISION_UNSPECIFIED: AgentConfirmationDecision
AGENT_CONFIRMATION_DECISION_APPROVE: AgentConfirmationDecision
AGENT_CONFIRMATION_DECISION_DENY: AgentConfirmationDecision

class ChatSubject(_message.Message):
    __slots__ = ("type", "id")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    type: _common_pb2.SubjectType
    id: str
    def __init__(self, type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., id: _Optional[str] = ...) -> None: ...

class ChatChannel(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "name", "slug", "description", "channel_type", "is_encrypted", "is_archived", "is_default", "icon", "category_id", "created_at", "updated_at", "message_count", "root_message_count", "member_count", "last_message_at", "last_root_message_at", "current_user_role", "is_member", "dm_member_ids", "is_agent_dm", "custom_name", "agent_id", "tags")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_ENCRYPTED_FIELD_NUMBER: _ClassVar[int]
    IS_ARCHIVED_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_MESSAGE_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_ROOT_MESSAGE_AT_FIELD_NUMBER: _ClassVar[int]
    CURRENT_USER_ROLE_FIELD_NUMBER: _ClassVar[int]
    IS_MEMBER_FIELD_NUMBER: _ClassVar[int]
    DM_MEMBER_IDS_FIELD_NUMBER: _ClassVar[int]
    IS_AGENT_DM_FIELD_NUMBER: _ClassVar[int]
    CUSTOM_NAME_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    name: str
    slug: str
    description: str
    channel_type: ChannelType
    is_encrypted: bool
    is_archived: bool
    is_default: bool
    icon: str
    category_id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    message_count: int
    root_message_count: int
    member_count: int
    last_message_at: _timestamp_pb2.Timestamp
    last_root_message_at: _timestamp_pb2.Timestamp
    current_user_role: ChannelRole
    is_member: bool
    dm_member_ids: _containers.RepeatedScalarFieldContainer[str]
    is_agent_dm: bool
    custom_name: str
    agent_id: str
    tags: _containers.RepeatedCompositeFieldContainer[_tags_pb2.Tag]
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., description: _Optional[str] = ..., channel_type: _Optional[_Union[ChannelType, str]] = ..., is_encrypted: _Optional[bool] = ..., is_archived: _Optional[bool] = ..., is_default: _Optional[bool] = ..., icon: _Optional[str] = ..., category_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., message_count: _Optional[int] = ..., root_message_count: _Optional[int] = ..., member_count: _Optional[int] = ..., last_message_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_root_message_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., current_user_role: _Optional[_Union[ChannelRole, str]] = ..., is_member: _Optional[bool] = ..., dm_member_ids: _Optional[_Iterable[str]] = ..., is_agent_dm: _Optional[bool] = ..., custom_name: _Optional[str] = ..., agent_id: _Optional[str] = ..., tags: _Optional[_Iterable[_Union[_tags_pb2.Tag, _Mapping]]] = ...) -> None: ...

class ThreadInfo(_message.Message):
    __slots__ = ("reply_count", "last_reply_at", "participant_ids", "has_unread")
    REPLY_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_REPLY_AT_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_IDS_FIELD_NUMBER: _ClassVar[int]
    HAS_UNREAD_FIELD_NUMBER: _ClassVar[int]
    reply_count: int
    last_reply_at: _timestamp_pb2.Timestamp
    participant_ids: _containers.RepeatedScalarFieldContainer[str]
    has_unread: bool
    def __init__(self, reply_count: _Optional[int] = ..., last_reply_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., participant_ids: _Optional[_Iterable[str]] = ..., has_unread: _Optional[bool] = ...) -> None: ...

class ReplyContext(_message.Message):
    __slots__ = ("id", "sender_name", "content_preview")
    ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_NAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    id: str
    sender_name: str
    content_preview: str
    def __init__(self, id: _Optional[str] = ..., sender_name: _Optional[str] = ..., content_preview: _Optional[str] = ...) -> None: ...

class ChatMessage(_message.Message):
    __slots__ = ("id", "channel_id", "sender_id", "sender_type", "content", "root_id", "edited_at", "is_deleted", "is_pinned", "metadata", "created_at", "reply_to_id", "thread", "reactions", "sender_name", "sender_avatar_url", "reply_context")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    ROOT_ID_FIELD_NUMBER: _ClassVar[int]
    EDITED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_DELETED_FIELD_NUMBER: _ClassVar[int]
    IS_PINNED_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_ID_FIELD_NUMBER: _ClassVar[int]
    THREAD_FIELD_NUMBER: _ClassVar[int]
    REACTIONS_FIELD_NUMBER: _ClassVar[int]
    SENDER_NAME_FIELD_NUMBER: _ClassVar[int]
    SENDER_AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    REPLY_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    id: str
    channel_id: str
    sender_id: str
    sender_type: SenderType
    content: str
    root_id: str
    edited_at: _timestamp_pb2.Timestamp
    is_deleted: bool
    is_pinned: bool
    metadata: _containers.ScalarMap[str, str]
    created_at: _timestamp_pb2.Timestamp
    reply_to_id: str
    thread: ThreadInfo
    reactions: _containers.RepeatedCompositeFieldContainer[ReactionGroup]
    sender_name: str
    sender_avatar_url: str
    reply_context: ReplyContext
    def __init__(self, id: _Optional[str] = ..., channel_id: _Optional[str] = ..., sender_id: _Optional[str] = ..., sender_type: _Optional[_Union[SenderType, str]] = ..., content: _Optional[str] = ..., root_id: _Optional[str] = ..., edited_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_deleted: _Optional[bool] = ..., is_pinned: _Optional[bool] = ..., metadata: _Optional[_Mapping[str, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., reply_to_id: _Optional[str] = ..., thread: _Optional[_Union[ThreadInfo, _Mapping]] = ..., reactions: _Optional[_Iterable[_Union[ReactionGroup, _Mapping]]] = ..., sender_name: _Optional[str] = ..., sender_avatar_url: _Optional[str] = ..., reply_context: _Optional[_Union[ReplyContext, _Mapping]] = ...) -> None: ...

class ReactionGroup(_message.Message):
    __slots__ = ("emoji", "count", "user_ids", "current_user_reacted")
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    COUNT_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    CURRENT_USER_REACTED_FIELD_NUMBER: _ClassVar[int]
    emoji: str
    count: int
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    current_user_reacted: bool
    def __init__(self, emoji: _Optional[str] = ..., count: _Optional[int] = ..., user_ids: _Optional[_Iterable[str]] = ..., current_user_reacted: _Optional[bool] = ...) -> None: ...

class ChatChannelMember(_message.Message):
    __slots__ = ("channel_id", "user_id", "role", "notification_level", "is_muted", "joined_at", "display_name", "email", "avatar_url", "muted_until", "follow_all_threads", "subject")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    IS_MUTED_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    MUTED_UNTIL_FIELD_NUMBER: _ClassVar[int]
    FOLLOW_ALL_THREADS_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    user_id: str
    role: ChannelRole
    notification_level: ChatNotificationLevel
    is_muted: bool
    joined_at: _timestamp_pb2.Timestamp
    display_name: str
    email: str
    avatar_url: str
    muted_until: _timestamp_pb2.Timestamp
    follow_all_threads: bool
    subject: ChatSubject
    def __init__(self, channel_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[ChannelRole, str]] = ..., notification_level: _Optional[_Union[ChatNotificationLevel, str]] = ..., is_muted: _Optional[bool] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., display_name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., muted_until: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., follow_all_threads: _Optional[bool] = ..., subject: _Optional[_Union[ChatSubject, _Mapping]] = ...) -> None: ...

class ChatChannelCategory(_message.Message):
    __slots__ = ("id", "organization_id", "name", "position", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    POSITION_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    position: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., position: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ThreadInboxItem(_message.Message):
    __slots__ = ("root_message_id", "channel_id", "channel_name", "root_message", "reply_count", "last_reply_at", "participant_ids", "has_unread", "latest_reply")
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_NAME_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    REPLY_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_REPLY_AT_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_IDS_FIELD_NUMBER: _ClassVar[int]
    HAS_UNREAD_FIELD_NUMBER: _ClassVar[int]
    LATEST_REPLY_FIELD_NUMBER: _ClassVar[int]
    root_message_id: str
    channel_id: str
    channel_name: str
    root_message: ChatMessage
    reply_count: int
    last_reply_at: _timestamp_pb2.Timestamp
    participant_ids: _containers.RepeatedScalarFieldContainer[str]
    has_unread: bool
    latest_reply: ChatMessage
    def __init__(self, root_message_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., channel_name: _Optional[str] = ..., root_message: _Optional[_Union[ChatMessage, _Mapping]] = ..., reply_count: _Optional[int] = ..., last_reply_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., participant_ids: _Optional[_Iterable[str]] = ..., has_unread: _Optional[bool] = ..., latest_reply: _Optional[_Union[ChatMessage, _Mapping]] = ...) -> None: ...

class ChatResource(_message.Message):
    __slots__ = ("id", "channel_id", "urn", "content_type", "first_mentioned_at", "last_mentioned_at", "mention_count", "first_mentioned_by", "title", "description")
    ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    URN_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    FIRST_MENTIONED_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_MENTIONED_AT_FIELD_NUMBER: _ClassVar[int]
    MENTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    FIRST_MENTIONED_BY_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    id: str
    channel_id: str
    urn: str
    content_type: str
    first_mentioned_at: _timestamp_pb2.Timestamp
    last_mentioned_at: _timestamp_pb2.Timestamp
    mention_count: int
    first_mentioned_by: str
    title: str
    description: str
    def __init__(self, id: _Optional[str] = ..., channel_id: _Optional[str] = ..., urn: _Optional[str] = ..., content_type: _Optional[str] = ..., first_mentioned_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_mentioned_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., mention_count: _Optional[int] = ..., first_mentioned_by: _Optional[str] = ..., title: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class TypingUser(_message.Message):
    __slots__ = ("user_id", "display_name")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ...) -> None: ...

class CreateChannelRequest(_message.Message):
    __slots__ = ("organization_id", "name", "channel_type", "description", "icon", "is_default", "category_id", "member_ids", "members", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_TYPE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    MEMBER_IDS_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    channel_type: ChannelType
    description: str
    icon: str
    is_default: bool
    category_id: str
    member_ids: _containers.RepeatedScalarFieldContainer[str]
    members: _containers.RepeatedCompositeFieldContainer[ChatSubject]
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., channel_type: _Optional[_Union[ChannelType, str]] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., is_default: _Optional[bool] = ..., category_id: _Optional[str] = ..., member_ids: _Optional[_Iterable[str]] = ..., members: _Optional[_Iterable[_Union[ChatSubject, _Mapping]]] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class CreateChannelResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class GetChannelRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class GetChannelResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class UpdateChannelRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "name", "description", "icon", "is_default", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    name: str
    description: str
    icon: str
    is_default: bool
    tag_ids: ChannelTagIds
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon: _Optional[str] = ..., is_default: _Optional[bool] = ..., tag_ids: _Optional[_Union[ChannelTagIds, _Mapping]] = ...) -> None: ...

class ChannelTagIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class UpdateChannelResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class ArchiveChannelRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class ArchiveChannelResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class DeleteChannelRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class DeleteChannelResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListChannelsRequest(_message.Message):
    __slots__ = ("organization_id", "browse_public", "cursor", "page_size", "tag_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    BROWSE_PUBLIC_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TAG_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    browse_public: bool
    cursor: str
    page_size: int
    tag_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., browse_public: _Optional[bool] = ..., cursor: _Optional[str] = ..., page_size: _Optional[int] = ..., tag_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListChannelsResponse(_message.Message):
    __slots__ = ("channels", "next_cursor")
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    NEXT_CURSOR_FIELD_NUMBER: _ClassVar[int]
    channels: _containers.RepeatedCompositeFieldContainer[ChatChannel]
    next_cursor: str
    def __init__(self, channels: _Optional[_Iterable[_Union[ChatChannel, _Mapping]]] = ..., next_cursor: _Optional[str] = ...) -> None: ...

class JoinChannelRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class JoinChannelResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class LeaveChannelRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class LeaveChannelResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AddMembersRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "user_ids", "subjects")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    SUBJECTS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    subjects: _containers.RepeatedCompositeFieldContainer[ChatSubject]
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., user_ids: _Optional[_Iterable[str]] = ..., subjects: _Optional[_Iterable[_Union[ChatSubject, _Mapping]]] = ...) -> None: ...

class AddMembersResponse(_message.Message):
    __slots__ = ("members",)
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[ChatChannelMember]
    def __init__(self, members: _Optional[_Iterable[_Union[ChatChannelMember, _Mapping]]] = ...) -> None: ...

class RemoveMembersRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "user_ids", "subjects")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    SUBJECTS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    subjects: _containers.RepeatedCompositeFieldContainer[ChatSubject]
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., user_ids: _Optional[_Iterable[str]] = ..., subjects: _Optional[_Iterable[_Union[ChatSubject, _Mapping]]] = ...) -> None: ...

class RemoveMembersResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetMembersRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "cursor", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    cursor: str
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., cursor: _Optional[str] = ..., page_size: _Optional[int] = ...) -> None: ...

class GetMembersResponse(_message.Message):
    __slots__ = ("members", "next_cursor")
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    NEXT_CURSOR_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[ChatChannelMember]
    next_cursor: str
    def __init__(self, members: _Optional[_Iterable[_Union[ChatChannelMember, _Mapping]]] = ..., next_cursor: _Optional[str] = ...) -> None: ...

class UpdateChannelMemberRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "user_id", "is_muted", "notification_level", "muted_until", "follow_all_threads", "badge_all_messages")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    IS_MUTED_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    MUTED_UNTIL_FIELD_NUMBER: _ClassVar[int]
    FOLLOW_ALL_THREADS_FIELD_NUMBER: _ClassVar[int]
    BADGE_ALL_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    user_id: str
    is_muted: bool
    notification_level: ChatNotificationLevel
    muted_until: _timestamp_pb2.Timestamp
    follow_all_threads: bool
    badge_all_messages: bool
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., user_id: _Optional[str] = ..., is_muted: _Optional[bool] = ..., notification_level: _Optional[_Union[ChatNotificationLevel, str]] = ..., muted_until: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., follow_all_threads: _Optional[bool] = ..., badge_all_messages: _Optional[bool] = ...) -> None: ...

class UpdateChannelMemberResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: ChatChannelMember
    def __init__(self, member: _Optional[_Union[ChatChannelMember, _Mapping]] = ...) -> None: ...

class SendMessageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "content", "root_id", "metadata", "reply_to_id", "attachment_file_ids")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    ROOT_ID_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    REPLY_TO_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENT_FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    content: str
    root_id: str
    metadata: _containers.ScalarMap[str, str]
    reply_to_id: str
    attachment_file_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., content: _Optional[str] = ..., root_id: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ..., reply_to_id: _Optional[str] = ..., attachment_file_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SendMessageResponse(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: ChatMessage
    def __init__(self, message: _Optional[_Union[ChatMessage, _Mapping]] = ...) -> None: ...

class GetMessagesRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "before_id", "after_id", "limit", "root_only", "around_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    BEFORE_ID_FIELD_NUMBER: _ClassVar[int]
    AFTER_ID_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    ROOT_ONLY_FIELD_NUMBER: _ClassVar[int]
    AROUND_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    before_id: str
    after_id: str
    limit: int
    root_only: bool
    around_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., before_id: _Optional[str] = ..., after_id: _Optional[str] = ..., limit: _Optional[int] = ..., root_only: _Optional[bool] = ..., around_id: _Optional[str] = ...) -> None: ...

class GetMessagesResponse(_message.Message):
    __slots__ = ("messages", "has_more")
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    HAS_MORE_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[ChatMessage]
    has_more: bool
    def __init__(self, messages: _Optional[_Iterable[_Union[ChatMessage, _Mapping]]] = ..., has_more: _Optional[bool] = ...) -> None: ...

class GetMessageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class GetMessageResponse(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: ChatMessage
    def __init__(self, message: _Optional[_Union[ChatMessage, _Mapping]] = ...) -> None: ...

class UpdateMessageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id", "content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    content: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...

class UpdateMessageResponse(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: ChatMessage
    def __init__(self, message: _Optional[_Union[ChatMessage, _Mapping]] = ...) -> None: ...

class DeleteMessageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class DeleteMessageResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class PinMessageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class PinMessageResponse(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: ChatMessage
    def __init__(self, message: _Optional[_Union[ChatMessage, _Mapping]] = ...) -> None: ...

class UnpinMessageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class UnpinMessageResponse(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: ChatMessage
    def __init__(self, message: _Optional[_Union[ChatMessage, _Mapping]] = ...) -> None: ...

class GetPinnedMessagesRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class GetPinnedMessagesResponse(_message.Message):
    __slots__ = ("messages",)
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[ChatMessage]
    def __init__(self, messages: _Optional[_Iterable[_Union[ChatMessage, _Mapping]]] = ...) -> None: ...

class GetThreadRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "root_message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    root_message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., root_message_id: _Optional[str] = ...) -> None: ...

class GetThreadResponse(_message.Message):
    __slots__ = ("root_message", "reply_count", "last_reply_at", "participant_ids", "is_following", "total_participants")
    ROOT_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    REPLY_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_REPLY_AT_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_IDS_FIELD_NUMBER: _ClassVar[int]
    IS_FOLLOWING_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PARTICIPANTS_FIELD_NUMBER: _ClassVar[int]
    root_message: ChatMessage
    reply_count: int
    last_reply_at: _timestamp_pb2.Timestamp
    participant_ids: _containers.RepeatedScalarFieldContainer[str]
    is_following: bool
    total_participants: int
    def __init__(self, root_message: _Optional[_Union[ChatMessage, _Mapping]] = ..., reply_count: _Optional[int] = ..., last_reply_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., participant_ids: _Optional[_Iterable[str]] = ..., is_following: _Optional[bool] = ..., total_participants: _Optional[int] = ...) -> None: ...

class GetThreadMessagesRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "root_message_id", "before_id", "after_id", "limit")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    BEFORE_ID_FIELD_NUMBER: _ClassVar[int]
    AFTER_ID_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    root_message_id: str
    before_id: str
    after_id: str
    limit: int
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., root_message_id: _Optional[str] = ..., before_id: _Optional[str] = ..., after_id: _Optional[str] = ..., limit: _Optional[int] = ...) -> None: ...

class GetThreadMessagesResponse(_message.Message):
    __slots__ = ("messages", "has_more")
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    HAS_MORE_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[ChatMessage]
    has_more: bool
    def __init__(self, messages: _Optional[_Iterable[_Union[ChatMessage, _Mapping]]] = ..., has_more: _Optional[bool] = ...) -> None: ...

class GetThreadsInboxRequest(_message.Message):
    __slots__ = ("organization_id", "unread_only", "limit", "cursor")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    UNREAD_ONLY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    unread_only: bool
    limit: int
    cursor: str
    def __init__(self, organization_id: _Optional[str] = ..., unread_only: _Optional[bool] = ..., limit: _Optional[int] = ..., cursor: _Optional[str] = ...) -> None: ...

class GetThreadsInboxResponse(_message.Message):
    __slots__ = ("threads", "has_more", "next_cursor")
    THREADS_FIELD_NUMBER: _ClassVar[int]
    HAS_MORE_FIELD_NUMBER: _ClassVar[int]
    NEXT_CURSOR_FIELD_NUMBER: _ClassVar[int]
    threads: _containers.RepeatedCompositeFieldContainer[ThreadInboxItem]
    has_more: bool
    next_cursor: str
    def __init__(self, threads: _Optional[_Iterable[_Union[ThreadInboxItem, _Mapping]]] = ..., has_more: _Optional[bool] = ..., next_cursor: _Optional[str] = ...) -> None: ...

class FollowThreadRequest(_message.Message):
    __slots__ = ("organization_id", "root_message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    root_message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., root_message_id: _Optional[str] = ...) -> None: ...

class FollowThreadResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class UnfollowThreadRequest(_message.Message):
    __slots__ = ("organization_id", "root_message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    root_message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., root_message_id: _Optional[str] = ...) -> None: ...

class UnfollowThreadResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AddReactionRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id", "emoji")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    emoji: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ..., emoji: _Optional[str] = ...) -> None: ...

class AddReactionResponse(_message.Message):
    __slots__ = ("reaction",)
    REACTION_FIELD_NUMBER: _ClassVar[int]
    reaction: ReactionGroup
    def __init__(self, reaction: _Optional[_Union[ReactionGroup, _Mapping]] = ...) -> None: ...

class RemoveReactionRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id", "emoji")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    emoji: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ..., emoji: _Optional[str] = ...) -> None: ...

class RemoveReactionResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SetTypingRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class SetTypingResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MarkChannelReadRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "last_read_message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    LAST_READ_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    last_read_message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., last_read_message_id: _Optional[str] = ...) -> None: ...

class MarkChannelReadResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MarkThreadReadRequest(_message.Message):
    __slots__ = ("organization_id", "root_message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    root_message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., root_message_id: _Optional[str] = ...) -> None: ...

class MarkThreadReadResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetUnreadCountsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetUnreadCountsResponse(_message.Message):
    __slots__ = ("channels",)
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    channels: _containers.RepeatedCompositeFieldContainer[ChannelUnreadCount]
    def __init__(self, channels: _Optional[_Iterable[_Union[ChannelUnreadCount, _Mapping]]] = ...) -> None: ...

class ChannelUnreadCount(_message.Message):
    __slots__ = ("channel_id", "unread_count", "mention_count", "last_read_message_id", "is_muted", "notification_level", "muted_until")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    UNREAD_COUNT_FIELD_NUMBER: _ClassVar[int]
    MENTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_READ_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    IS_MUTED_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_LEVEL_FIELD_NUMBER: _ClassVar[int]
    MUTED_UNTIL_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    unread_count: int
    mention_count: int
    last_read_message_id: str
    is_muted: bool
    notification_level: ChatNotificationLevel
    muted_until: _timestamp_pb2.Timestamp
    def __init__(self, channel_id: _Optional[str] = ..., unread_count: _Optional[int] = ..., mention_count: _Optional[int] = ..., last_read_message_id: _Optional[str] = ..., is_muted: _Optional[bool] = ..., notification_level: _Optional[_Union[ChatNotificationLevel, str]] = ..., muted_until: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetChannelResourcesRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "content_type_filter", "limit", "offset")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FILTER_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    content_type_filter: str
    limit: int
    offset: int
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., content_type_filter: _Optional[str] = ..., limit: _Optional[int] = ..., offset: _Optional[int] = ...) -> None: ...

class GetChannelResourcesResponse(_message.Message):
    __slots__ = ("resources", "total_count")
    RESOURCES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    resources: _containers.RepeatedCompositeFieldContainer[ChatResource]
    total_count: int
    def __init__(self, resources: _Optional[_Iterable[_Union[ChatResource, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class CreateAgentChatRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "custom_name")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    CUSTOM_NAME_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    custom_name: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., custom_name: _Optional[str] = ...) -> None: ...

class CreateAgentChatResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class RenameAgentChatRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "custom_name")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CUSTOM_NAME_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    custom_name: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., custom_name: _Optional[str] = ...) -> None: ...

class RenameAgentChatResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class ListAgentChatsRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "cursor", "page_size")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    cursor: str
    page_size: int
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., cursor: _Optional[str] = ..., page_size: _Optional[int] = ...) -> None: ...

class ListAgentChatsResponse(_message.Message):
    __slots__ = ("channels", "next_cursor")
    CHANNELS_FIELD_NUMBER: _ClassVar[int]
    NEXT_CURSOR_FIELD_NUMBER: _ClassVar[int]
    channels: _containers.RepeatedCompositeFieldContainer[ChatChannel]
    next_cursor: str
    def __init__(self, channels: _Optional[_Iterable[_Union[ChatChannel, _Mapping]]] = ..., next_cursor: _Optional[str] = ...) -> None: ...

class CreateCategoryRequest(_message.Message):
    __slots__ = ("organization_id", "name")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class CreateCategoryResponse(_message.Message):
    __slots__ = ("category",)
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    category: ChatChannelCategory
    def __init__(self, category: _Optional[_Union[ChatChannelCategory, _Mapping]] = ...) -> None: ...

class UpdateCategoryRequest(_message.Message):
    __slots__ = ("organization_id", "category_id", "name")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    category_id: str
    name: str
    def __init__(self, organization_id: _Optional[str] = ..., category_id: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class UpdateCategoryResponse(_message.Message):
    __slots__ = ("category",)
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    category: ChatChannelCategory
    def __init__(self, category: _Optional[_Union[ChatChannelCategory, _Mapping]] = ...) -> None: ...

class DeleteCategoryRequest(_message.Message):
    __slots__ = ("organization_id", "category_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    category_id: str
    def __init__(self, organization_id: _Optional[str] = ..., category_id: _Optional[str] = ...) -> None: ...

class DeleteCategoryResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListCategoriesRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListCategoriesResponse(_message.Message):
    __slots__ = ("categories",)
    CATEGORIES_FIELD_NUMBER: _ClassVar[int]
    categories: _containers.RepeatedCompositeFieldContainer[ChatChannelCategory]
    def __init__(self, categories: _Optional[_Iterable[_Union[ChatChannelCategory, _Mapping]]] = ...) -> None: ...

class ReorderCategoriesRequest(_message.Message):
    __slots__ = ("organization_id", "category_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    category_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., category_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ReorderCategoriesResponse(_message.Message):
    __slots__ = ("categories",)
    CATEGORIES_FIELD_NUMBER: _ClassVar[int]
    categories: _containers.RepeatedCompositeFieldContainer[ChatChannelCategory]
    def __init__(self, categories: _Optional[_Iterable[_Union[ChatChannelCategory, _Mapping]]] = ...) -> None: ...

class MoveChannelToCategoryRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "category_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    category_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., category_id: _Optional[str] = ...) -> None: ...

class MoveChannelToCategoryResponse(_message.Message):
    __slots__ = ("channel",)
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    channel: ChatChannel
    def __init__(self, channel: _Optional[_Union[ChatChannel, _Mapping]] = ...) -> None: ...

class RespondToAgentConfirmationRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id", "request_id", "decision", "rationale")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    DECISION_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    request_id: str
    decision: AgentConfirmationDecision
    rationale: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ..., request_id: _Optional[str] = ..., decision: _Optional[_Union[AgentConfirmationDecision, str]] = ..., rationale: _Optional[str] = ...) -> None: ...

class RespondToAgentConfirmationResponse(_message.Message):
    __slots__ = ("decision", "decided_at")
    DECISION_FIELD_NUMBER: _ClassVar[int]
    DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    decision: AgentConfirmationDecision
    decided_at: _timestamp_pb2.Timestamp
    def __init__(self, decision: _Optional[_Union[AgentConfirmationDecision, str]] = ..., decided_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PendingAgentApproval(_message.Message):
    __slots__ = ("request_id", "agent_id", "message_id", "tool_name", "args_preview", "actor_user_id", "requested_at", "expires_at")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    agent_id: str
    message_id: str
    tool_name: str
    args_preview: str
    actor_user_id: str
    requested_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, request_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., message_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., args_preview: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., requested_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetChannelPendingApprovalsRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ...) -> None: ...

class GetChannelPendingApprovalsResponse(_message.Message):
    __slots__ = ("approvals",)
    APPROVALS_FIELD_NUMBER: _ClassVar[int]
    approvals: _containers.RepeatedCompositeFieldContainer[PendingAgentApproval]
    def __init__(self, approvals: _Optional[_Iterable[_Union[PendingAgentApproval, _Mapping]]] = ...) -> None: ...

class ChannelAgentContextStats(_message.Message):
    __slots__ = ("total_messages", "active_messages", "compacted_messages", "summary_count", "active_tokens", "token_budget", "tokens_until_compaction", "context_window_tokens", "was_reset", "manual_reset_at", "last_input_tokens", "last_output_tokens", "last_cache_read_tokens")
    TOTAL_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    COMPACTED_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_COUNT_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOKEN_BUDGET_FIELD_NUMBER: _ClassVar[int]
    TOKENS_UNTIL_COMPACTION_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_TOKENS_FIELD_NUMBER: _ClassVar[int]
    WAS_RESET_FIELD_NUMBER: _ClassVar[int]
    MANUAL_RESET_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LAST_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LAST_CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    total_messages: int
    active_messages: int
    compacted_messages: int
    summary_count: int
    active_tokens: int
    token_budget: int
    tokens_until_compaction: int
    context_window_tokens: int
    was_reset: bool
    manual_reset_at: _timestamp_pb2.Timestamp
    last_input_tokens: int
    last_output_tokens: int
    last_cache_read_tokens: int
    def __init__(self, total_messages: _Optional[int] = ..., active_messages: _Optional[int] = ..., compacted_messages: _Optional[int] = ..., summary_count: _Optional[int] = ..., active_tokens: _Optional[int] = ..., token_budget: _Optional[int] = ..., tokens_until_compaction: _Optional[int] = ..., context_window_tokens: _Optional[int] = ..., was_reset: _Optional[bool] = ..., manual_reset_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_input_tokens: _Optional[int] = ..., last_output_tokens: _Optional[int] = ..., last_cache_read_tokens: _Optional[int] = ...) -> None: ...

class GetChannelAgentContextStatsRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class GetChannelAgentContextStatsResponse(_message.Message):
    __slots__ = ("stats",)
    STATS_FIELD_NUMBER: _ClassVar[int]
    stats: ChannelAgentContextStats
    def __init__(self, stats: _Optional[_Union[ChannelAgentContextStats, _Mapping]] = ...) -> None: ...

class GetChannelAgentContextStatsBatchRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "agent_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    agent_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., agent_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetChannelAgentContextStatsBatchResponse(_message.Message):
    __slots__ = ("stats",)
    class StatsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: ChannelAgentContextStats
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[ChannelAgentContextStats, _Mapping]] = ...) -> None: ...
    STATS_FIELD_NUMBER: _ClassVar[int]
    stats: _containers.MessageMap[str, ChannelAgentContextStats]
    def __init__(self, stats: _Optional[_Mapping[str, ChannelAgentContextStats]] = ...) -> None: ...

class CompactChannelAgentContextRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class CompactChannelAgentContextResponse(_message.Message):
    __slots__ = ("compacted", "stats", "messages_compacted", "tokens_before", "tokens_after", "tokens_saved")
    COMPACTED_FIELD_NUMBER: _ClassVar[int]
    STATS_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_COMPACTED_FIELD_NUMBER: _ClassVar[int]
    TOKENS_BEFORE_FIELD_NUMBER: _ClassVar[int]
    TOKENS_AFTER_FIELD_NUMBER: _ClassVar[int]
    TOKENS_SAVED_FIELD_NUMBER: _ClassVar[int]
    compacted: bool
    stats: ChannelAgentContextStats
    messages_compacted: int
    tokens_before: int
    tokens_after: int
    tokens_saved: int
    def __init__(self, compacted: _Optional[bool] = ..., stats: _Optional[_Union[ChannelAgentContextStats, _Mapping]] = ..., messages_compacted: _Optional[int] = ..., tokens_before: _Optional[int] = ..., tokens_after: _Optional[int] = ..., tokens_saved: _Optional[int] = ...) -> None: ...

class ResetChannelAgentContextRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class ResetChannelAgentContextResponse(_message.Message):
    __slots__ = ("divider_message_id", "reset_at", "stats")
    DIVIDER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RESET_AT_FIELD_NUMBER: _ClassVar[int]
    STATS_FIELD_NUMBER: _ClassVar[int]
    divider_message_id: str
    reset_at: _timestamp_pb2.Timestamp
    stats: ChannelAgentContextStats
    def __init__(self, divider_message_id: _Optional[str] = ..., reset_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., stats: _Optional[_Union[ChannelAgentContextStats, _Mapping]] = ...) -> None: ...
