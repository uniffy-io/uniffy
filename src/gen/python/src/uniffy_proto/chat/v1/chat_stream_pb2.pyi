import datetime

from calls.v1 import calls_pb2 as _calls_pb2
from chat.v1 import chat_pb2 as _chat_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChatEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHAT_EVENT_TYPE_UNSPECIFIED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MESSAGE_CREATED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MESSAGE_UPDATED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MESSAGE_DELETED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_REACTION_ADDED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_REACTION_REMOVED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_TYPING_STARTED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_TYPING_STOPPED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MEMBER_JOINED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MEMBER_LEFT: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CHANNEL_UPDATED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_THREAD_UPDATED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_HEARTBEAT: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MEMBERS_ADDED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_MEMBERS_REMOVED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_AGENT_TYPING: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_AGENT_TOKEN_DELTA: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_AGENT_TOOL_CALL: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_AGENT_CONFIRMATION_REQUESTED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_AGENT_CONFIRMATION_RESOLVED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_STARTED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_ENDED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_PARTICIPANT_JOINED: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_PARTICIPANT_LEFT: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_PARTICIPANT_STATE: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_RING: _ClassVar[ChatEventType]
    CHAT_EVENT_TYPE_CALL_HOST_CHANGED: _ClassVar[ChatEventType]

class UserChatEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    USER_CHAT_EVENT_TYPE_UNSPECIFIED: _ClassVar[UserChatEventType]
    USER_CHAT_EVENT_TYPE_UNREAD_COUNT_CHANGED: _ClassVar[UserChatEventType]
    USER_CHAT_EVENT_TYPE_THREAD_ACTIVITY: _ClassVar[UserChatEventType]
    USER_CHAT_EVENT_TYPE_MENTION_RECEIVED: _ClassVar[UserChatEventType]
    USER_CHAT_EVENT_TYPE_HEARTBEAT: _ClassVar[UserChatEventType]
    USER_CHAT_EVENT_TYPE_CHANNEL_EVENT: _ClassVar[UserChatEventType]
    USER_CHAT_EVENT_TYPE_DRAFT_CHANGED: _ClassVar[UserChatEventType]
CHAT_EVENT_TYPE_UNSPECIFIED: ChatEventType
CHAT_EVENT_TYPE_MESSAGE_CREATED: ChatEventType
CHAT_EVENT_TYPE_MESSAGE_UPDATED: ChatEventType
CHAT_EVENT_TYPE_MESSAGE_DELETED: ChatEventType
CHAT_EVENT_TYPE_REACTION_ADDED: ChatEventType
CHAT_EVENT_TYPE_REACTION_REMOVED: ChatEventType
CHAT_EVENT_TYPE_TYPING_STARTED: ChatEventType
CHAT_EVENT_TYPE_TYPING_STOPPED: ChatEventType
CHAT_EVENT_TYPE_MEMBER_JOINED: ChatEventType
CHAT_EVENT_TYPE_MEMBER_LEFT: ChatEventType
CHAT_EVENT_TYPE_CHANNEL_UPDATED: ChatEventType
CHAT_EVENT_TYPE_THREAD_UPDATED: ChatEventType
CHAT_EVENT_TYPE_HEARTBEAT: ChatEventType
CHAT_EVENT_TYPE_MEMBERS_ADDED: ChatEventType
CHAT_EVENT_TYPE_MEMBERS_REMOVED: ChatEventType
CHAT_EVENT_TYPE_AGENT_TYPING: ChatEventType
CHAT_EVENT_TYPE_AGENT_TOKEN_DELTA: ChatEventType
CHAT_EVENT_TYPE_AGENT_TOOL_CALL: ChatEventType
CHAT_EVENT_TYPE_AGENT_CONFIRMATION_REQUESTED: ChatEventType
CHAT_EVENT_TYPE_AGENT_CONFIRMATION_RESOLVED: ChatEventType
CHAT_EVENT_TYPE_CALL_STARTED: ChatEventType
CHAT_EVENT_TYPE_CALL_ENDED: ChatEventType
CHAT_EVENT_TYPE_CALL_PARTICIPANT_JOINED: ChatEventType
CHAT_EVENT_TYPE_CALL_PARTICIPANT_LEFT: ChatEventType
CHAT_EVENT_TYPE_CALL_PARTICIPANT_STATE: ChatEventType
CHAT_EVENT_TYPE_CALL_RING: ChatEventType
CHAT_EVENT_TYPE_CALL_HOST_CHANGED: ChatEventType
USER_CHAT_EVENT_TYPE_UNSPECIFIED: UserChatEventType
USER_CHAT_EVENT_TYPE_UNREAD_COUNT_CHANGED: UserChatEventType
USER_CHAT_EVENT_TYPE_THREAD_ACTIVITY: UserChatEventType
USER_CHAT_EVENT_TYPE_MENTION_RECEIVED: UserChatEventType
USER_CHAT_EVENT_TYPE_HEARTBEAT: UserChatEventType
USER_CHAT_EVENT_TYPE_CHANNEL_EVENT: UserChatEventType
USER_CHAT_EVENT_TYPE_DRAFT_CHANGED: UserChatEventType

class ChatEvent(_message.Message):
    __slots__ = ("event_type", "timestamp", "channel_id", "message", "message_deleted", "reaction", "typing", "member", "channel_updated", "thread_updated", "agent_typing", "agent_token_delta", "agent_tool_call", "agent_confirmation_requested", "agent_confirmation_resolved", "members_changed", "call_lifecycle", "call_participant", "call_ring", "call_host_changed")
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_DELETED_FIELD_NUMBER: _ClassVar[int]
    REACTION_FIELD_NUMBER: _ClassVar[int]
    TYPING_FIELD_NUMBER: _ClassVar[int]
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_UPDATED_FIELD_NUMBER: _ClassVar[int]
    THREAD_UPDATED_FIELD_NUMBER: _ClassVar[int]
    AGENT_TYPING_FIELD_NUMBER: _ClassVar[int]
    AGENT_TOKEN_DELTA_FIELD_NUMBER: _ClassVar[int]
    AGENT_TOOL_CALL_FIELD_NUMBER: _ClassVar[int]
    AGENT_CONFIRMATION_REQUESTED_FIELD_NUMBER: _ClassVar[int]
    AGENT_CONFIRMATION_RESOLVED_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_CHANGED_FIELD_NUMBER: _ClassVar[int]
    CALL_LIFECYCLE_FIELD_NUMBER: _ClassVar[int]
    CALL_PARTICIPANT_FIELD_NUMBER: _ClassVar[int]
    CALL_RING_FIELD_NUMBER: _ClassVar[int]
    CALL_HOST_CHANGED_FIELD_NUMBER: _ClassVar[int]
    event_type: ChatEventType
    timestamp: _timestamp_pb2.Timestamp
    channel_id: str
    message: _chat_pb2.ChatMessage
    message_deleted: MessageDeletedPayload
    reaction: ReactionPayload
    typing: TypingPayload
    member: MemberPayload
    channel_updated: _chat_pb2.ChatChannel
    thread_updated: ThreadUpdatedPayload
    agent_typing: AgentTypingPayload
    agent_token_delta: AgentTokenDeltaPayload
    agent_tool_call: AgentToolCallPayload
    agent_confirmation_requested: AgentConfirmationRequestedPayload
    agent_confirmation_resolved: AgentConfirmationResolvedPayload
    members_changed: MembersChangedPayload
    call_lifecycle: CallLifecyclePayload
    call_participant: CallParticipantEventPayload
    call_ring: CallRingPayload
    call_host_changed: CallHostChangedPayload
    def __init__(self, event_type: _Optional[_Union[ChatEventType, str]] = ..., timestamp: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., channel_id: _Optional[str] = ..., message: _Optional[_Union[_chat_pb2.ChatMessage, _Mapping]] = ..., message_deleted: _Optional[_Union[MessageDeletedPayload, _Mapping]] = ..., reaction: _Optional[_Union[ReactionPayload, _Mapping]] = ..., typing: _Optional[_Union[TypingPayload, _Mapping]] = ..., member: _Optional[_Union[MemberPayload, _Mapping]] = ..., channel_updated: _Optional[_Union[_chat_pb2.ChatChannel, _Mapping]] = ..., thread_updated: _Optional[_Union[ThreadUpdatedPayload, _Mapping]] = ..., agent_typing: _Optional[_Union[AgentTypingPayload, _Mapping]] = ..., agent_token_delta: _Optional[_Union[AgentTokenDeltaPayload, _Mapping]] = ..., agent_tool_call: _Optional[_Union[AgentToolCallPayload, _Mapping]] = ..., agent_confirmation_requested: _Optional[_Union[AgentConfirmationRequestedPayload, _Mapping]] = ..., agent_confirmation_resolved: _Optional[_Union[AgentConfirmationResolvedPayload, _Mapping]] = ..., members_changed: _Optional[_Union[MembersChangedPayload, _Mapping]] = ..., call_lifecycle: _Optional[_Union[CallLifecyclePayload, _Mapping]] = ..., call_participant: _Optional[_Union[CallParticipantEventPayload, _Mapping]] = ..., call_ring: _Optional[_Union[CallRingPayload, _Mapping]] = ..., call_host_changed: _Optional[_Union[CallHostChangedPayload, _Mapping]] = ...) -> None: ...

class MessageDeletedPayload(_message.Message):
    __slots__ = ("message_id", "deleted_at")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    deleted_at: _timestamp_pb2.Timestamp
    def __init__(self, message_id: _Optional[str] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ReactionPayload(_message.Message):
    __slots__ = ("message_id", "emoji", "user_id", "display_name")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    EMOJI_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    emoji: str
    user_id: str
    display_name: str
    def __init__(self, message_id: _Optional[str] = ..., emoji: _Optional[str] = ..., user_id: _Optional[str] = ..., display_name: _Optional[str] = ...) -> None: ...

class TypingPayload(_message.Message):
    __slots__ = ("user_id", "display_name")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ...) -> None: ...

class MemberPayload(_message.Message):
    __slots__ = ("user_id", "display_name", "avatar_url", "role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    avatar_url: str
    role: _chat_pb2.ChannelRole
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., avatar_url: _Optional[str] = ..., role: _Optional[_Union[_chat_pb2.ChannelRole, str]] = ...) -> None: ...

class MembersChangedPayload(_message.Message):
    __slots__ = ("user_ids",)
    USER_IDS_FIELD_NUMBER: _ClassVar[int]
    user_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, user_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ThreadUpdatedPayload(_message.Message):
    __slots__ = ("root_message_id", "reply_count", "last_reply_at", "latest_participant_id")
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    REPLY_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_REPLY_AT_FIELD_NUMBER: _ClassVar[int]
    LATEST_PARTICIPANT_ID_FIELD_NUMBER: _ClassVar[int]
    root_message_id: str
    reply_count: int
    last_reply_at: _timestamp_pb2.Timestamp
    latest_participant_id: str
    def __init__(self, root_message_id: _Optional[str] = ..., reply_count: _Optional[int] = ..., last_reply_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., latest_participant_id: _Optional[str] = ...) -> None: ...

class AgentTypingPayload(_message.Message):
    __slots__ = ("agent_id", "display_name", "started", "root_id")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    STARTED_FIELD_NUMBER: _ClassVar[int]
    ROOT_ID_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    display_name: str
    started: bool
    root_id: str
    def __init__(self, agent_id: _Optional[str] = ..., display_name: _Optional[str] = ..., started: _Optional[bool] = ..., root_id: _Optional[str] = ...) -> None: ...

class AgentTokenDeltaPayload(_message.Message):
    __slots__ = ("message_id", "agent_id", "delta", "sequence", "final")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    FINAL_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    agent_id: str
    delta: str
    sequence: int
    final: bool
    def __init__(self, message_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., delta: _Optional[str] = ..., sequence: _Optional[int] = ..., final: _Optional[bool] = ...) -> None: ...

class AgentToolCallPayload(_message.Message):
    __slots__ = ("message_id", "agent_id", "tool_name", "tool_call_id", "status", "preview", "error_message")
    class Status(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STATUS_UNSPECIFIED: _ClassVar[AgentToolCallPayload.Status]
        STATUS_STARTED: _ClassVar[AgentToolCallPayload.Status]
        STATUS_COMPLETED: _ClassVar[AgentToolCallPayload.Status]
        STATUS_FAILED: _ClassVar[AgentToolCallPayload.Status]
    STATUS_UNSPECIFIED: AgentToolCallPayload.Status
    STATUS_STARTED: AgentToolCallPayload.Status
    STATUS_COMPLETED: AgentToolCallPayload.Status
    STATUS_FAILED: AgentToolCallPayload.Status
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PREVIEW_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    agent_id: str
    tool_name: str
    tool_call_id: str
    status: AgentToolCallPayload.Status
    preview: str
    error_message: str
    def __init__(self, message_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., status: _Optional[_Union[AgentToolCallPayload.Status, str]] = ..., preview: _Optional[str] = ..., error_message: _Optional[str] = ...) -> None: ...

class AgentConfirmationRequestedPayload(_message.Message):
    __slots__ = ("message_id", "agent_id", "request_id", "tool_name", "args_preview", "actor_user_id", "expires_at")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    ACTOR_USER_ID_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    agent_id: str
    request_id: str
    tool_name: str
    args_preview: str
    actor_user_id: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, message_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., request_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., args_preview: _Optional[str] = ..., actor_user_id: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class AgentConfirmationResolvedPayload(_message.Message):
    __slots__ = ("request_id", "message_id", "decision", "decided_by_user_id", "decided_at")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    DECISION_FIELD_NUMBER: _ClassVar[int]
    DECIDED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    message_id: str
    decision: _chat_pb2.AgentConfirmationDecision
    decided_by_user_id: str
    decided_at: _timestamp_pb2.Timestamp
    def __init__(self, request_id: _Optional[str] = ..., message_id: _Optional[str] = ..., decision: _Optional[_Union[_chat_pb2.AgentConfirmationDecision, str]] = ..., decided_by_user_id: _Optional[str] = ..., decided_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CallLifecyclePayload(_message.Message):
    __slots__ = ("call",)
    CALL_FIELD_NUMBER: _ClassVar[int]
    call: _calls_pb2.Call
    def __init__(self, call: _Optional[_Union[_calls_pb2.Call, _Mapping]] = ...) -> None: ...

class CallParticipantEventPayload(_message.Message):
    __slots__ = ("call_id", "participant", "active_participant_count")
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    PARTICIPANT_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_PARTICIPANT_COUNT_FIELD_NUMBER: _ClassVar[int]
    call_id: str
    participant: _calls_pb2.CallParticipant
    active_participant_count: int
    def __init__(self, call_id: _Optional[str] = ..., participant: _Optional[_Union[_calls_pb2.CallParticipant, _Mapping]] = ..., active_participant_count: _Optional[int] = ...) -> None: ...

class CallRingPayload(_message.Message):
    __slots__ = ("call_id", "channel_name", "call_type", "caller_user_id", "caller_name", "caller_avatar_url", "expires_at")
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_NAME_FIELD_NUMBER: _ClassVar[int]
    CALL_TYPE_FIELD_NUMBER: _ClassVar[int]
    CALLER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    CALLER_NAME_FIELD_NUMBER: _ClassVar[int]
    CALLER_AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    call_id: str
    channel_name: str
    call_type: _calls_pb2.CallType
    caller_user_id: str
    caller_name: str
    caller_avatar_url: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, call_id: _Optional[str] = ..., channel_name: _Optional[str] = ..., call_type: _Optional[_Union[_calls_pb2.CallType, str]] = ..., caller_user_id: _Optional[str] = ..., caller_name: _Optional[str] = ..., caller_avatar_url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CallHostChangedPayload(_message.Message):
    __slots__ = ("call_id", "new_host_user_id")
    CALL_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_HOST_USER_ID_FIELD_NUMBER: _ClassVar[int]
    call_id: str
    new_host_user_id: str
    def __init__(self, call_id: _Optional[str] = ..., new_host_user_id: _Optional[str] = ...) -> None: ...

class StreamUserChatEventsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class StreamUserChatEventsResponse(_message.Message):
    __slots__ = ("event_type", "timestamp", "unread_count", "thread_activity", "mention_received", "channel_event", "draft_changed")
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    UNREAD_COUNT_FIELD_NUMBER: _ClassVar[int]
    THREAD_ACTIVITY_FIELD_NUMBER: _ClassVar[int]
    MENTION_RECEIVED_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_EVENT_FIELD_NUMBER: _ClassVar[int]
    DRAFT_CHANGED_FIELD_NUMBER: _ClassVar[int]
    event_type: UserChatEventType
    timestamp: _timestamp_pb2.Timestamp
    unread_count: UnreadCountPayload
    thread_activity: ThreadActivityPayload
    mention_received: MentionReceivedPayload
    channel_event: ChatEvent
    draft_changed: DraftChangedPayload
    def __init__(self, event_type: _Optional[_Union[UserChatEventType, str]] = ..., timestamp: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., unread_count: _Optional[_Union[UnreadCountPayload, _Mapping]] = ..., thread_activity: _Optional[_Union[ThreadActivityPayload, _Mapping]] = ..., mention_received: _Optional[_Union[MentionReceivedPayload, _Mapping]] = ..., channel_event: _Optional[_Union[ChatEvent, _Mapping]] = ..., draft_changed: _Optional[_Union[DraftChangedPayload, _Mapping]] = ...) -> None: ...

class DraftChangedPayload(_message.Message):
    __slots__ = ("channel_id", "root_message_id", "content", "deleted", "updated_at", "client_session_id")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    DELETED_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    root_message_id: str
    content: str
    deleted: bool
    updated_at: _timestamp_pb2.Timestamp
    client_session_id: str
    def __init__(self, channel_id: _Optional[str] = ..., root_message_id: _Optional[str] = ..., content: _Optional[str] = ..., deleted: _Optional[bool] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., client_session_id: _Optional[str] = ...) -> None: ...

class UnreadCountPayload(_message.Message):
    __slots__ = ("channel_id", "unread_count", "mention_count")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    UNREAD_COUNT_FIELD_NUMBER: _ClassVar[int]
    MENTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    unread_count: int
    mention_count: int
    def __init__(self, channel_id: _Optional[str] = ..., unread_count: _Optional[int] = ..., mention_count: _Optional[int] = ...) -> None: ...

class ThreadActivityPayload(_message.Message):
    __slots__ = ("root_message_id", "channel_id", "channel_name", "reply_count", "last_reply_at")
    ROOT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_NAME_FIELD_NUMBER: _ClassVar[int]
    REPLY_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_REPLY_AT_FIELD_NUMBER: _ClassVar[int]
    root_message_id: str
    channel_id: str
    channel_name: str
    reply_count: int
    last_reply_at: _timestamp_pb2.Timestamp
    def __init__(self, root_message_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., channel_name: _Optional[str] = ..., reply_count: _Optional[int] = ..., last_reply_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class MentionReceivedPayload(_message.Message):
    __slots__ = ("channel_id", "channel_name", "message_id", "sender_id", "sender_name", "preview")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_NAME_FIELD_NUMBER: _ClassVar[int]
    PREVIEW_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    channel_name: str
    message_id: str
    sender_id: str
    sender_name: str
    preview: str
    def __init__(self, channel_id: _Optional[str] = ..., channel_name: _Optional[str] = ..., message_id: _Optional[str] = ..., sender_id: _Optional[str] = ..., sender_name: _Optional[str] = ..., preview: _Optional[str] = ...) -> None: ...
