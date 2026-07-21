import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SESSION_KIND_UNSPECIFIED: _ClassVar[SessionKind]
    SESSION_KIND_DIRECT: _ClassVar[SessionKind]
    SESSION_KIND_GROUP: _ClassVar[SessionKind]
    SESSION_KIND_GLOBAL: _ClassVar[SessionKind]

class MessageRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MESSAGE_ROLE_UNSPECIFIED: _ClassVar[MessageRole]
    MESSAGE_ROLE_USER: _ClassVar[MessageRole]
    MESSAGE_ROLE_ASSISTANT: _ClassVar[MessageRole]
    MESSAGE_ROLE_TOOL: _ClassVar[MessageRole]
    MESSAGE_ROLE_SYSTEM: _ClassVar[MessageRole]
    MESSAGE_ROLE_SUMMARY: _ClassVar[MessageRole]
SESSION_KIND_UNSPECIFIED: SessionKind
SESSION_KIND_DIRECT: SessionKind
SESSION_KIND_GROUP: SessionKind
SESSION_KIND_GLOBAL: SessionKind
MESSAGE_ROLE_UNSPECIFIED: MessageRole
MESSAGE_ROLE_USER: MessageRole
MESSAGE_ROLE_ASSISTANT: MessageRole
MESSAGE_ROLE_TOOL: MessageRole
MESSAGE_ROLE_SYSTEM: MessageRole
MESSAGE_ROLE_SUMMARY: MessageRole

class SessionInfo(_message.Message):
    __slots__ = ("id", "organization_id", "agent_id", "user_id", "kind", "display_name", "model_override", "total_input_tokens", "total_output_tokens", "message_count", "last_model_used", "is_archived", "created_at", "updated_at", "model_params_override")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_MODEL_USED_FIELD_NUMBER: _ClassVar[int]
    IS_ARCHIVED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    MODEL_PARAMS_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    agent_id: str
    user_id: str
    kind: SessionKind
    display_name: str
    model_override: str
    total_input_tokens: int
    total_output_tokens: int
    message_count: int
    last_model_used: str
    is_archived: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    model_params_override: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., user_id: _Optional[str] = ..., kind: _Optional[_Union[SessionKind, str]] = ..., display_name: _Optional[str] = ..., model_override: _Optional[str] = ..., total_input_tokens: _Optional[int] = ..., total_output_tokens: _Optional[int] = ..., message_count: _Optional[int] = ..., last_model_used: _Optional[str] = ..., is_archived: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., model_params_override: _Optional[str] = ...) -> None: ...

class MessageInfo(_message.Message):
    __slots__ = ("id", "session_id", "role", "content", "input_tokens", "output_tokens", "model", "tool_name", "tool_call_id", "tool_args_json", "tool_result", "is_thinking", "is_compacted", "created_at", "file_ids", "is_invalidated", "edited_at", "previous_content", "was_cancelled", "feedback_rating", "invoked_skill_name", "thinking_json")
    ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_ARGS_JSON_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_FIELD_NUMBER: _ClassVar[int]
    IS_THINKING_FIELD_NUMBER: _ClassVar[int]
    IS_COMPACTED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    IS_INVALIDATED_FIELD_NUMBER: _ClassVar[int]
    EDITED_AT_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_CONTENT_FIELD_NUMBER: _ClassVar[int]
    WAS_CANCELLED_FIELD_NUMBER: _ClassVar[int]
    FEEDBACK_RATING_FIELD_NUMBER: _ClassVar[int]
    INVOKED_SKILL_NAME_FIELD_NUMBER: _ClassVar[int]
    THINKING_JSON_FIELD_NUMBER: _ClassVar[int]
    id: str
    session_id: str
    role: MessageRole
    content: str
    input_tokens: int
    output_tokens: int
    model: str
    tool_name: str
    tool_call_id: str
    tool_args_json: str
    tool_result: str
    is_thinking: bool
    is_compacted: bool
    created_at: _timestamp_pb2.Timestamp
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    is_invalidated: bool
    edited_at: _timestamp_pb2.Timestamp
    previous_content: str
    was_cancelled: bool
    feedback_rating: str
    invoked_skill_name: str
    thinking_json: str
    def __init__(self, id: _Optional[str] = ..., session_id: _Optional[str] = ..., role: _Optional[_Union[MessageRole, str]] = ..., content: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., model: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., tool_args_json: _Optional[str] = ..., tool_result: _Optional[str] = ..., is_thinking: _Optional[bool] = ..., is_compacted: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., file_ids: _Optional[_Iterable[str]] = ..., is_invalidated: _Optional[bool] = ..., edited_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., previous_content: _Optional[str] = ..., was_cancelled: _Optional[bool] = ..., feedback_rating: _Optional[str] = ..., invoked_skill_name: _Optional[str] = ..., thinking_json: _Optional[str] = ...) -> None: ...

class CreateSessionRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "kind", "display_name", "model_override", "model_params_override")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    MODEL_PARAMS_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    kind: SessionKind
    display_name: str
    model_override: str
    model_params_override: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., kind: _Optional[_Union[SessionKind, str]] = ..., display_name: _Optional[str] = ..., model_override: _Optional[str] = ..., model_params_override: _Optional[str] = ...) -> None: ...

class CreateSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SessionInfo
    def __init__(self, session: _Optional[_Union[SessionInfo, _Mapping]] = ...) -> None: ...

class GetSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SessionInfo
    def __init__(self, session: _Optional[_Union[SessionInfo, _Mapping]] = ...) -> None: ...

class UpdateSessionResponse(_message.Message):
    __slots__ = ("session",)
    SESSION_FIELD_NUMBER: _ClassVar[int]
    session: SessionInfo
    def __init__(self, session: _Optional[_Union[SessionInfo, _Mapping]] = ...) -> None: ...

class GetSessionRequest(_message.Message):
    __slots__ = ("organization_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class ListSessionsRequest(_message.Message):
    __slots__ = ("organization_id", "pagination", "agent_id", "kind", "is_archived")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    IS_ARCHIVED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    agent_id: str
    kind: SessionKind
    is_archived: bool
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., agent_id: _Optional[str] = ..., kind: _Optional[_Union[SessionKind, str]] = ..., is_archived: _Optional[bool] = ...) -> None: ...

class ListSessionsResponse(_message.Message):
    __slots__ = ("sessions", "pagination")
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    sessions: _containers.RepeatedCompositeFieldContainer[SessionInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, sessions: _Optional[_Iterable[_Union[SessionInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class UpdateSessionRequest(_message.Message):
    __slots__ = ("organization_id", "session_id", "display_name", "model_override", "model_params_override")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    MODEL_PARAMS_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    display_name: str
    model_override: str
    model_params_override: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., display_name: _Optional[str] = ..., model_override: _Optional[str] = ..., model_params_override: _Optional[str] = ...) -> None: ...

class ArchiveSessionRequest(_message.Message):
    __slots__ = ("organization_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class ArchiveSessionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class AddMessageRequest(_message.Message):
    __slots__ = ("organization_id", "session_id", "role", "content", "input_tokens", "output_tokens", "model", "tool_name", "tool_call_id", "tool_args_json", "tool_result", "is_thinking")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_ARGS_JSON_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_FIELD_NUMBER: _ClassVar[int]
    IS_THINKING_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    role: MessageRole
    content: str
    input_tokens: int
    output_tokens: int
    model: str
    tool_name: str
    tool_call_id: str
    tool_args_json: str
    tool_result: str
    is_thinking: bool
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., role: _Optional[_Union[MessageRole, str]] = ..., content: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., model: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., tool_args_json: _Optional[str] = ..., tool_result: _Optional[str] = ..., is_thinking: _Optional[bool] = ...) -> None: ...

class AddMessageResponse(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: MessageInfo
    def __init__(self, message: _Optional[_Union[MessageInfo, _Mapping]] = ...) -> None: ...

class ListMessagesRequest(_message.Message):
    __slots__ = ("organization_id", "session_id", "pagination", "include_compacted")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_COMPACTED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    pagination: _common_pb2.PaginationRequest
    include_compacted: bool
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., include_compacted: _Optional[bool] = ...) -> None: ...

class ListMessagesResponse(_message.Message):
    __slots__ = ("messages", "pagination")
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[MessageInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, messages: _Optional[_Iterable[_Union[MessageInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class GetSessionContextRequest(_message.Message):
    __slots__ = ("organization_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class GetSessionContextResponse(_message.Message):
    __slots__ = ("messages", "total_messages")
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    messages: _containers.RepeatedCompositeFieldContainer[MessageInfo]
    total_messages: int
    def __init__(self, messages: _Optional[_Iterable[_Union[MessageInfo, _Mapping]]] = ..., total_messages: _Optional[int] = ...) -> None: ...

class GetSessionContextStatsRequest(_message.Message):
    __slots__ = ("organization_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class GetSessionContextStatsResponse(_message.Message):
    __slots__ = ("total_messages", "active_messages", "compacted_messages", "summary_count", "active_tokens", "token_budget", "tokens_until_compaction", "context_window_tokens", "last_input_tokens", "last_output_tokens", "last_cache_read_tokens")
    TOTAL_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    COMPACTED_MESSAGES_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_COUNT_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOKEN_BUDGET_FIELD_NUMBER: _ClassVar[int]
    TOKENS_UNTIL_COMPACTION_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_TOKENS_FIELD_NUMBER: _ClassVar[int]
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
    last_input_tokens: int
    last_output_tokens: int
    last_cache_read_tokens: int
    def __init__(self, total_messages: _Optional[int] = ..., active_messages: _Optional[int] = ..., compacted_messages: _Optional[int] = ..., summary_count: _Optional[int] = ..., active_tokens: _Optional[int] = ..., token_budget: _Optional[int] = ..., tokens_until_compaction: _Optional[int] = ..., context_window_tokens: _Optional[int] = ..., last_input_tokens: _Optional[int] = ..., last_output_tokens: _Optional[int] = ..., last_cache_read_tokens: _Optional[int] = ...) -> None: ...

class CompactSessionRequest(_message.Message):
    __slots__ = ("organization_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

class CompactSessionResponse(_message.Message):
    __slots__ = ("compacted", "stats", "messages_compacted", "tokens_before", "tokens_after", "tokens_saved", "summary_tokens")
    COMPACTED_FIELD_NUMBER: _ClassVar[int]
    STATS_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_COMPACTED_FIELD_NUMBER: _ClassVar[int]
    TOKENS_BEFORE_FIELD_NUMBER: _ClassVar[int]
    TOKENS_AFTER_FIELD_NUMBER: _ClassVar[int]
    TOKENS_SAVED_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_TOKENS_FIELD_NUMBER: _ClassVar[int]
    compacted: bool
    stats: GetSessionContextStatsResponse
    messages_compacted: int
    tokens_before: int
    tokens_after: int
    tokens_saved: int
    summary_tokens: int
    def __init__(self, compacted: _Optional[bool] = ..., stats: _Optional[_Union[GetSessionContextStatsResponse, _Mapping]] = ..., messages_compacted: _Optional[int] = ..., tokens_before: _Optional[int] = ..., tokens_after: _Optional[int] = ..., tokens_saved: _Optional[int] = ..., summary_tokens: _Optional[int] = ...) -> None: ...

class EditMessageRequest(_message.Message):
    __slots__ = ("organization_id", "message_id", "new_content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    message_id: str
    new_content: str
    def __init__(self, organization_id: _Optional[str] = ..., message_id: _Optional[str] = ..., new_content: _Optional[str] = ...) -> None: ...

class EditMessageResponse(_message.Message):
    __slots__ = ("message", "downstream_invalidated")
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    DOWNSTREAM_INVALIDATED_FIELD_NUMBER: _ClassVar[int]
    message: MessageInfo
    downstream_invalidated: int
    def __init__(self, message: _Optional[_Union[MessageInfo, _Mapping]] = ..., downstream_invalidated: _Optional[int] = ...) -> None: ...

class DeleteMessageRequest(_message.Message):
    __slots__ = ("organization_id", "message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class DeleteMessageResponse(_message.Message):
    __slots__ = ("invalidated_count",)
    INVALIDATED_COUNT_FIELD_NUMBER: _ClassVar[int]
    invalidated_count: int
    def __init__(self, invalidated_count: _Optional[int] = ...) -> None: ...

class RetryMessageRequest(_message.Message):
    __slots__ = ("organization_id", "message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class RetryMessageResponse(_message.Message):
    __slots__ = ("content", "file_ids")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    content: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, content: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class MessageFeedback(_message.Message):
    __slots__ = ("message_id", "rating", "comment", "created_at")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RATING_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    rating: str
    comment: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, message_id: _Optional[str] = ..., rating: _Optional[str] = ..., comment: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SubmitMessageFeedbackRequest(_message.Message):
    __slots__ = ("organization_id", "message_id", "rating", "comment")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RATING_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    message_id: str
    rating: str
    comment: str
    def __init__(self, organization_id: _Optional[str] = ..., message_id: _Optional[str] = ..., rating: _Optional[str] = ..., comment: _Optional[str] = ...) -> None: ...

class SubmitMessageFeedbackResponse(_message.Message):
    __slots__ = ("feedback",)
    FEEDBACK_FIELD_NUMBER: _ClassVar[int]
    feedback: MessageFeedback
    def __init__(self, feedback: _Optional[_Union[MessageFeedback, _Mapping]] = ...) -> None: ...
