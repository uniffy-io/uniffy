from agents.v1 import sessions_pb2 as _sessions_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetUsageStatsRequest(_message.Message):
    __slots__ = ("organization_id", "days", "interval")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DAYS_FIELD_NUMBER: _ClassVar[int]
    INTERVAL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    days: int
    interval: str
    def __init__(self, organization_id: _Optional[str] = ..., days: _Optional[int] = ..., interval: _Optional[str] = ...) -> None: ...

class GetUsageStatsResponse(_message.Message):
    __slots__ = ("total_runs", "total_input_tokens", "total_output_tokens", "total_sessions", "avg_duration_ms", "daily_usage", "model_usage", "agent_usage", "tool_usage", "provider_key_usage", "cron_usage", "cron_total_runs", "cron_total_successes", "cron_total_failures", "cron_total_input_tokens", "cron_total_output_tokens")
    TOTAL_RUNS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SESSIONS_FIELD_NUMBER: _ClassVar[int]
    AVG_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    DAILY_USAGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_USAGE_FIELD_NUMBER: _ClassVar[int]
    AGENT_USAGE_FIELD_NUMBER: _ClassVar[int]
    TOOL_USAGE_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_KEY_USAGE_FIELD_NUMBER: _ClassVar[int]
    CRON_USAGE_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_RUNS_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_SUCCESSES_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_FAILURES_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    total_runs: int
    total_input_tokens: int
    total_output_tokens: int
    total_sessions: int
    avg_duration_ms: int
    daily_usage: _containers.RepeatedCompositeFieldContainer[DailyUsage]
    model_usage: _containers.RepeatedCompositeFieldContainer[ModelUsage]
    agent_usage: _containers.RepeatedCompositeFieldContainer[AgentUsageInfo]
    tool_usage: _containers.RepeatedCompositeFieldContainer[ToolUsage]
    provider_key_usage: _containers.RepeatedCompositeFieldContainer[ProviderKeyUsage]
    cron_usage: _containers.RepeatedCompositeFieldContainer[CronTaskUsage]
    cron_total_runs: int
    cron_total_successes: int
    cron_total_failures: int
    cron_total_input_tokens: int
    cron_total_output_tokens: int
    def __init__(self, total_runs: _Optional[int] = ..., total_input_tokens: _Optional[int] = ..., total_output_tokens: _Optional[int] = ..., total_sessions: _Optional[int] = ..., avg_duration_ms: _Optional[int] = ..., daily_usage: _Optional[_Iterable[_Union[DailyUsage, _Mapping]]] = ..., model_usage: _Optional[_Iterable[_Union[ModelUsage, _Mapping]]] = ..., agent_usage: _Optional[_Iterable[_Union[AgentUsageInfo, _Mapping]]] = ..., tool_usage: _Optional[_Iterable[_Union[ToolUsage, _Mapping]]] = ..., provider_key_usage: _Optional[_Iterable[_Union[ProviderKeyUsage, _Mapping]]] = ..., cron_usage: _Optional[_Iterable[_Union[CronTaskUsage, _Mapping]]] = ..., cron_total_runs: _Optional[int] = ..., cron_total_successes: _Optional[int] = ..., cron_total_failures: _Optional[int] = ..., cron_total_input_tokens: _Optional[int] = ..., cron_total_output_tokens: _Optional[int] = ...) -> None: ...

class DailyUsage(_message.Message):
    __slots__ = ("date", "runs", "input_tokens", "output_tokens")
    DATE_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    date: str
    runs: int
    input_tokens: int
    output_tokens: int
    def __init__(self, date: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class ModelUsage(_message.Message):
    __slots__ = ("model", "runs", "input_tokens", "output_tokens")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    model: str
    runs: int
    input_tokens: int
    output_tokens: int
    def __init__(self, model: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class AgentUsageInfo(_message.Message):
    __slots__ = ("agent_id", "agent_name", "runs", "input_tokens", "output_tokens")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    agent_name: str
    runs: int
    input_tokens: int
    output_tokens: int
    def __init__(self, agent_id: _Optional[str] = ..., agent_name: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class ToolUsage(_message.Message):
    __slots__ = ("tool_name", "call_count")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    call_count: int
    def __init__(self, tool_name: _Optional[str] = ..., call_count: _Optional[int] = ...) -> None: ...

class ProviderKeyUsage(_message.Message):
    __slots__ = ("provider_key_id", "key_label", "provider", "runs", "input_tokens", "output_tokens")
    PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_LABEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    provider_key_id: str
    key_label: str
    provider: str
    runs: int
    input_tokens: int
    output_tokens: int
    def __init__(self, provider_key_id: _Optional[str] = ..., key_label: _Optional[str] = ..., provider: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class CronTaskUsage(_message.Message):
    __slots__ = ("cron_task_id", "task_name", "agent_name", "total_runs", "successes", "failures", "input_tokens", "output_tokens")
    CRON_TASK_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    TOTAL_RUNS_FIELD_NUMBER: _ClassVar[int]
    SUCCESSES_FIELD_NUMBER: _ClassVar[int]
    FAILURES_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    cron_task_id: str
    task_name: str
    agent_name: str
    total_runs: int
    successes: int
    failures: int
    input_tokens: int
    output_tokens: int
    def __init__(self, cron_task_id: _Optional[str] = ..., task_name: _Optional[str] = ..., agent_name: _Optional[str] = ..., total_runs: _Optional[int] = ..., successes: _Optional[int] = ..., failures: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class SendMessageRequest(_message.Message):
    __slots__ = ("organization_id", "session_id", "content", "file_ids", "user_timezone", "chat_context")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    USER_TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    CHAT_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    content: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    user_timezone: str
    chat_context: ChatChannelContext
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., content: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ..., user_timezone: _Optional[str] = ..., chat_context: _Optional[_Union[ChatChannelContext, _Mapping]] = ...) -> None: ...

class ChatChannelContext(_message.Message):
    __slots__ = ("channel_id", "agent_id", "trigger_message_id", "context_urn")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    TRIGGER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_URN_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    agent_id: str
    trigger_message_id: str
    context_urn: str
    def __init__(self, channel_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., trigger_message_id: _Optional[str] = ..., context_urn: _Optional[str] = ...) -> None: ...

class SendMessageResponse(_message.Message):
    __slots__ = ("user_message", "assistant_message", "model_used")
    USER_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ASSISTANT_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_USED_FIELD_NUMBER: _ClassVar[int]
    user_message: _sessions_pb2.MessageInfo
    assistant_message: _sessions_pb2.MessageInfo
    model_used: str
    def __init__(self, user_message: _Optional[_Union[_sessions_pb2.MessageInfo, _Mapping]] = ..., assistant_message: _Optional[_Union[_sessions_pb2.MessageInfo, _Mapping]] = ..., model_used: _Optional[str] = ...) -> None: ...

class ConfirmationResponse(_message.Message):
    __slots__ = ("organization_id", "session_id", "tool_call_id", "approved")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    APPROVED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    tool_call_id: str
    approved: bool
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., approved: _Optional[bool] = ...) -> None: ...

class ConfirmationResponseAck(_message.Message):
    __slots__ = ("accepted",)
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    def __init__(self, accepted: _Optional[bool] = ...) -> None: ...

class StreamSendMessageEvent(_message.Message):
    __slots__ = ("token", "tool_call", "tool_result", "message_stored", "done", "error", "confirmation_required")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_STORED_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    CONFIRMATION_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    token: StreamTokenEvent
    tool_call: StreamToolCallEvent
    tool_result: StreamToolResultEvent
    message_stored: StreamMessageStoredEvent
    done: StreamDoneEvent
    error: StreamErrorEvent
    confirmation_required: StreamConfirmationRequiredEvent
    def __init__(self, token: _Optional[_Union[StreamTokenEvent, _Mapping]] = ..., tool_call: _Optional[_Union[StreamToolCallEvent, _Mapping]] = ..., tool_result: _Optional[_Union[StreamToolResultEvent, _Mapping]] = ..., message_stored: _Optional[_Union[StreamMessageStoredEvent, _Mapping]] = ..., done: _Optional[_Union[StreamDoneEvent, _Mapping]] = ..., error: _Optional[_Union[StreamErrorEvent, _Mapping]] = ..., confirmation_required: _Optional[_Union[StreamConfirmationRequiredEvent, _Mapping]] = ...) -> None: ...

class StreamTokenEvent(_message.Message):
    __slots__ = ("text",)
    TEXT_FIELD_NUMBER: _ClassVar[int]
    text: str
    def __init__(self, text: _Optional[str] = ...) -> None: ...

class StreamToolCallEvent(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "tool_args_json")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_ARGS_JSON_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    tool_args_json: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_args_json: _Optional[str] = ...) -> None: ...

class StreamToolResultEvent(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "success", "result")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    success: bool
    result: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., success: _Optional[bool] = ..., result: _Optional[str] = ...) -> None: ...

class StreamMessageStoredEvent(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: _sessions_pb2.MessageInfo
    def __init__(self, message: _Optional[_Union[_sessions_pb2.MessageInfo, _Mapping]] = ...) -> None: ...

class StreamDoneEvent(_message.Message):
    __slots__ = ("assistant_message", "model_used")
    ASSISTANT_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_USED_FIELD_NUMBER: _ClassVar[int]
    assistant_message: _sessions_pb2.MessageInfo
    model_used: str
    def __init__(self, assistant_message: _Optional[_Union[_sessions_pb2.MessageInfo, _Mapping]] = ..., model_used: _Optional[str] = ...) -> None: ...

class StreamErrorEvent(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: str
    def __init__(self, message: _Optional[str] = ...) -> None: ...

class StreamConfirmationRequiredEvent(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "tool_args_json", "description")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_ARGS_JSON_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    tool_args_json: str
    description: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_args_json: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...
