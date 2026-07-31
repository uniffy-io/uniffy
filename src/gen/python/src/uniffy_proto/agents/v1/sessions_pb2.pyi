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
    __slots__ = ("id", "organization_id", "agent_id", "user_id", "kind", "display_name", "model_override", "total_input_tokens", "total_output_tokens", "message_count", "last_model_used", "is_archived", "created_at", "updated_at", "is_test")
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
    IS_TEST_FIELD_NUMBER: _ClassVar[int]
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
    is_test: bool
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., user_id: _Optional[str] = ..., kind: _Optional[_Union[SessionKind, str]] = ..., display_name: _Optional[str] = ..., model_override: _Optional[str] = ..., total_input_tokens: _Optional[int] = ..., total_output_tokens: _Optional[int] = ..., message_count: _Optional[int] = ..., last_model_used: _Optional[str] = ..., is_archived: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_test: _Optional[bool] = ...) -> None: ...

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
    __slots__ = ("organization_id", "agent_id", "kind", "display_name", "model_override", "is_test")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    IS_TEST_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    kind: SessionKind
    display_name: str
    model_override: str
    is_test: bool
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., kind: _Optional[_Union[SessionKind, str]] = ..., display_name: _Optional[str] = ..., model_override: _Optional[str] = ..., is_test: _Optional[bool] = ...) -> None: ...

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

class GetSessionRequest(_message.Message):
    __slots__ = ("organization_id", "session_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("organization_id", "message_id", "rating", "comment", "chat_message_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RATING_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    CHAT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    message_id: str
    rating: str
    comment: str
    chat_message_id: str
    def __init__(self, organization_id: _Optional[str] = ..., message_id: _Optional[str] = ..., rating: _Optional[str] = ..., comment: _Optional[str] = ..., chat_message_id: _Optional[str] = ...) -> None: ...

class SubmitMessageFeedbackResponse(_message.Message):
    __slots__ = ("feedback",)
    FEEDBACK_FIELD_NUMBER: _ClassVar[int]
    feedback: MessageFeedback
    def __init__(self, feedback: _Optional[_Union[MessageFeedback, _Mapping]] = ...) -> None: ...
