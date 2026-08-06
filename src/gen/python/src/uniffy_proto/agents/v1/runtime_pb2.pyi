from agents.v1 import sessions_pb2 as _sessions_pb2
from agents.v1 import skills_pb2 as _skills_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RuntimeSettings(_message.Message):
    __slots__ = ("send_deadline_seconds", "failover_enabled", "resume_enabled", "circuit_breaker_failure_threshold", "circuit_breaker_recovery_seconds", "personal_memory_bridge_enabled", "default_provider_key_id", "default_chat_model", "image_max_resolution", "image_max_quality")
    SEND_DEADLINE_SECONDS_FIELD_NUMBER: _ClassVar[int]
    FAILOVER_ENABLED_FIELD_NUMBER: _ClassVar[int]
    RESUME_ENABLED_FIELD_NUMBER: _ClassVar[int]
    CIRCUIT_BREAKER_FAILURE_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    CIRCUIT_BREAKER_RECOVERY_SECONDS_FIELD_NUMBER: _ClassVar[int]
    PERSONAL_MEMORY_BRIDGE_ENABLED_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CHAT_MODEL_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MAX_RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    IMAGE_MAX_QUALITY_FIELD_NUMBER: _ClassVar[int]
    send_deadline_seconds: int
    failover_enabled: bool
    resume_enabled: bool
    circuit_breaker_failure_threshold: int
    circuit_breaker_recovery_seconds: int
    personal_memory_bridge_enabled: bool
    default_provider_key_id: str
    default_chat_model: str
    image_max_resolution: str
    image_max_quality: str
    def __init__(self, send_deadline_seconds: _Optional[int] = ..., failover_enabled: _Optional[bool] = ..., resume_enabled: _Optional[bool] = ..., circuit_breaker_failure_threshold: _Optional[int] = ..., circuit_breaker_recovery_seconds: _Optional[int] = ..., personal_memory_bridge_enabled: _Optional[bool] = ..., default_provider_key_id: _Optional[str] = ..., default_chat_model: _Optional[str] = ..., image_max_resolution: _Optional[str] = ..., image_max_quality: _Optional[str] = ...) -> None: ...

class GetRuntimeSettingsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class UpdateRuntimeSettingsRequest(_message.Message):
    __slots__ = ("organization_id", "settings")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    settings: RuntimeSettings
    def __init__(self, organization_id: _Optional[str] = ..., settings: _Optional[_Union[RuntimeSettings, _Mapping]] = ...) -> None: ...

class GetRuntimeSettingsResponse(_message.Message):
    __slots__ = ("settings", "configured")
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    CONFIGURED_FIELD_NUMBER: _ClassVar[int]
    settings: RuntimeSettings
    configured: bool
    def __init__(self, settings: _Optional[_Union[RuntimeSettings, _Mapping]] = ..., configured: _Optional[bool] = ...) -> None: ...

class UpdateRuntimeSettingsResponse(_message.Message):
    __slots__ = ("settings", "configured")
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    CONFIGURED_FIELD_NUMBER: _ClassVar[int]
    settings: RuntimeSettings
    configured: bool
    def __init__(self, settings: _Optional[_Union[RuntimeSettings, _Mapping]] = ..., configured: _Optional[bool] = ...) -> None: ...

class RegenerateImageRequest(_message.Message):
    __slots__ = ("organization_id", "channel_id", "message_id", "params_patch")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    PARAMS_PATCH_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    channel_id: str
    message_id: str
    params_patch: str
    def __init__(self, organization_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., message_id: _Optional[str] = ..., params_patch: _Optional[str] = ...) -> None: ...

class RegenerateImageResponse(_message.Message):
    __slots__ = ("message_id", "result_metadata")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    RESULT_METADATA_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    result_metadata: str
    def __init__(self, message_id: _Optional[str] = ..., result_metadata: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("total_runs", "total_input_tokens", "total_output_tokens", "total_sessions", "avg_duration_ms", "daily_usage", "model_usage", "agent_usage", "tool_usage", "provider_key_usage", "cron_usage", "cron_total_runs", "cron_total_successes", "cron_total_failures", "cron_total_input_tokens", "cron_total_output_tokens", "total_cache_read_input_tokens", "total_cost", "total_thinking_tokens", "total_image_count", "total_retries", "total_cancelled", "total_deadline_exceeded", "display_currency", "total_cache_creation_input_tokens", "cron_total_cache_read_input_tokens", "cron_total_cache_creation_input_tokens")
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
    TOTAL_CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COST_FIELD_NUMBER: _ClassVar[int]
    TOTAL_THINKING_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_IMAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_RETRIES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CANCELLED_FIELD_NUMBER: _ClassVar[int]
    TOTAL_DEADLINE_EXCEEDED_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    TOTAL_CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CRON_TOTAL_CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
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
    total_cache_read_input_tokens: int
    total_cost: str
    total_thinking_tokens: int
    total_image_count: int
    total_retries: int
    total_cancelled: int
    total_deadline_exceeded: int
    display_currency: str
    total_cache_creation_input_tokens: int
    cron_total_cache_read_input_tokens: int
    cron_total_cache_creation_input_tokens: int
    def __init__(self, total_runs: _Optional[int] = ..., total_input_tokens: _Optional[int] = ..., total_output_tokens: _Optional[int] = ..., total_sessions: _Optional[int] = ..., avg_duration_ms: _Optional[int] = ..., daily_usage: _Optional[_Iterable[_Union[DailyUsage, _Mapping]]] = ..., model_usage: _Optional[_Iterable[_Union[ModelUsage, _Mapping]]] = ..., agent_usage: _Optional[_Iterable[_Union[AgentUsageInfo, _Mapping]]] = ..., tool_usage: _Optional[_Iterable[_Union[ToolUsage, _Mapping]]] = ..., provider_key_usage: _Optional[_Iterable[_Union[ProviderKeyUsage, _Mapping]]] = ..., cron_usage: _Optional[_Iterable[_Union[CronTaskUsage, _Mapping]]] = ..., cron_total_runs: _Optional[int] = ..., cron_total_successes: _Optional[int] = ..., cron_total_failures: _Optional[int] = ..., cron_total_input_tokens: _Optional[int] = ..., cron_total_output_tokens: _Optional[int] = ..., total_cache_read_input_tokens: _Optional[int] = ..., total_cost: _Optional[str] = ..., total_thinking_tokens: _Optional[int] = ..., total_image_count: _Optional[int] = ..., total_retries: _Optional[int] = ..., total_cancelled: _Optional[int] = ..., total_deadline_exceeded: _Optional[int] = ..., display_currency: _Optional[str] = ..., total_cache_creation_input_tokens: _Optional[int] = ..., cron_total_cache_read_input_tokens: _Optional[int] = ..., cron_total_cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class DailyUsage(_message.Message):
    __slots__ = ("date", "runs", "input_tokens", "output_tokens", "cache_read_input_tokens", "cost", "image_count", "cache_creation_input_tokens")
    DATE_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COST_FIELD_NUMBER: _ClassVar[int]
    IMAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    date: str
    runs: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cost: str
    image_count: int
    cache_creation_input_tokens: int
    def __init__(self, date: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., cost: _Optional[str] = ..., image_count: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class ModelUsage(_message.Message):
    __slots__ = ("model", "runs", "input_tokens", "output_tokens", "cost", "image_count", "cache_read_input_tokens", "cache_creation_input_tokens")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COST_FIELD_NUMBER: _ClassVar[int]
    IMAGE_COUNT_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    model: str
    runs: int
    input_tokens: int
    output_tokens: int
    cost: str
    image_count: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    def __init__(self, model: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cost: _Optional[str] = ..., image_count: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class AgentUsageInfo(_message.Message):
    __slots__ = ("agent_id", "agent_name", "runs", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    agent_name: str
    runs: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    def __init__(self, agent_id: _Optional[str] = ..., agent_name: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class ToolUsage(_message.Message):
    __slots__ = ("tool_name", "call_count")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    call_count: int
    def __init__(self, tool_name: _Optional[str] = ..., call_count: _Optional[int] = ...) -> None: ...

class ProviderKeyUsage(_message.Message):
    __slots__ = ("provider_key_id", "key_label", "provider", "runs", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
    PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_LABEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    provider_key_id: str
    key_label: str
    provider: str
    runs: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    def __init__(self, provider_key_id: _Optional[str] = ..., key_label: _Optional[str] = ..., provider: _Optional[str] = ..., runs: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class CronTaskUsage(_message.Message):
    __slots__ = ("cron_task_id", "task_name", "agent_name", "total_runs", "successes", "failures", "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
    CRON_TASK_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    TOTAL_RUNS_FIELD_NUMBER: _ClassVar[int]
    SUCCESSES_FIELD_NUMBER: _ClassVar[int]
    FAILURES_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    cron_task_id: str
    task_name: str
    agent_name: str
    total_runs: int
    successes: int
    failures: int
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int
    def __init__(self, cron_task_id: _Optional[str] = ..., task_name: _Optional[str] = ..., agent_name: _Optional[str] = ..., total_runs: _Optional[int] = ..., successes: _Optional[int] = ..., failures: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class SendMessageRequest(_message.Message):
    __slots__ = ("organization_id", "session_id", "content", "file_ids", "user_timezone", "chat_context", "invoked_skill_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    USER_TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    CHAT_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    INVOKED_SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    content: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    user_timezone: str
    chat_context: ChatChannelContext
    invoked_skill_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., content: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ..., user_timezone: _Optional[str] = ..., chat_context: _Optional[_Union[ChatChannelContext, _Mapping]] = ..., invoked_skill_id: _Optional[str] = ...) -> None: ...

class RerunFromMessageRequest(_message.Message):
    __slots__ = ("organization_id", "message_id", "user_timezone")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    USER_TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    message_id: str
    user_timezone: str
    def __init__(self, organization_id: _Optional[str] = ..., message_id: _Optional[str] = ..., user_timezone: _Optional[str] = ...) -> None: ...

class StreamSendMessageRequest(_message.Message):
    __slots__ = ("organization_id", "session_id", "content", "file_ids", "user_timezone", "chat_context", "invoked_skill_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FILE_IDS_FIELD_NUMBER: _ClassVar[int]
    USER_TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    CHAT_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    INVOKED_SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    session_id: str
    content: str
    file_ids: _containers.RepeatedScalarFieldContainer[str]
    user_timezone: str
    chat_context: ChatChannelContext
    invoked_skill_id: str
    def __init__(self, organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., content: _Optional[str] = ..., file_ids: _Optional[_Iterable[str]] = ..., user_timezone: _Optional[str] = ..., chat_context: _Optional[_Union[ChatChannelContext, _Mapping]] = ..., invoked_skill_id: _Optional[str] = ...) -> None: ...

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

class RespondToConfirmationRequest(_message.Message):
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

class SubscribeToRunRequest(_message.Message):
    __slots__ = ("run_id", "organization_id")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    organization_id: str
    def __init__(self, run_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class CancelStreamRequest(_message.Message):
    __slots__ = ("run_id", "organization_id")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    organization_id: str
    def __init__(self, run_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class CancelStreamResponse(_message.Message):
    __slots__ = ("cancelled",)
    CANCELLED_FIELD_NUMBER: _ClassVar[int]
    cancelled: bool
    def __init__(self, cancelled: _Optional[bool] = ...) -> None: ...

class RespondToConfirmationResponse(_message.Message):
    __slots__ = ("accepted",)
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    def __init__(self, accepted: _Optional[bool] = ...) -> None: ...

class AgentStreamEvent(_message.Message):
    __slots__ = ("reply_start", "model_call_start", "model_call_end", "text_block_start", "text_block_delta", "text_block_end", "thinking_block_start", "thinking_block_delta", "thinking_block_end", "tool_call_start", "tool_call_delta", "tool_call_end", "tool_result_start", "tool_result_delta", "tool_result_end", "confirmation_required", "failover", "skill_draft", "exceed_max_iters", "message_stored", "done", "error", "run_id")
    REPLY_START_FIELD_NUMBER: _ClassVar[int]
    MODEL_CALL_START_FIELD_NUMBER: _ClassVar[int]
    MODEL_CALL_END_FIELD_NUMBER: _ClassVar[int]
    TEXT_BLOCK_START_FIELD_NUMBER: _ClassVar[int]
    TEXT_BLOCK_DELTA_FIELD_NUMBER: _ClassVar[int]
    TEXT_BLOCK_END_FIELD_NUMBER: _ClassVar[int]
    THINKING_BLOCK_START_FIELD_NUMBER: _ClassVar[int]
    THINKING_BLOCK_DELTA_FIELD_NUMBER: _ClassVar[int]
    THINKING_BLOCK_END_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_START_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_DELTA_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_END_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_START_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_DELTA_FIELD_NUMBER: _ClassVar[int]
    TOOL_RESULT_END_FIELD_NUMBER: _ClassVar[int]
    CONFIRMATION_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    FAILOVER_FIELD_NUMBER: _ClassVar[int]
    SKILL_DRAFT_FIELD_NUMBER: _ClassVar[int]
    EXCEED_MAX_ITERS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_STORED_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    reply_start: StreamReplyStartEvent
    model_call_start: StreamModelCallStartEvent
    model_call_end: StreamModelCallEndEvent
    text_block_start: StreamTextBlockStartEvent
    text_block_delta: StreamTextBlockDeltaEvent
    text_block_end: StreamTextBlockEndEvent
    thinking_block_start: StreamThinkingBlockStartEvent
    thinking_block_delta: StreamThinkingBlockDeltaEvent
    thinking_block_end: StreamThinkingBlockEndEvent
    tool_call_start: StreamToolCallStartEvent
    tool_call_delta: StreamToolCallDeltaEvent
    tool_call_end: StreamToolCallEndEvent
    tool_result_start: StreamToolResultStartEvent
    tool_result_delta: StreamToolResultDeltaEvent
    tool_result_end: StreamToolResultEndEvent
    confirmation_required: StreamConfirmationRequiredEvent
    failover: StreamFailoverEvent
    skill_draft: StreamSkillDraftEvent
    exceed_max_iters: StreamExceedMaxItersEvent
    message_stored: StreamMessageStoredEvent
    done: StreamDoneEvent
    error: StreamErrorEvent
    run_id: str
    def __init__(self, reply_start: _Optional[_Union[StreamReplyStartEvent, _Mapping]] = ..., model_call_start: _Optional[_Union[StreamModelCallStartEvent, _Mapping]] = ..., model_call_end: _Optional[_Union[StreamModelCallEndEvent, _Mapping]] = ..., text_block_start: _Optional[_Union[StreamTextBlockStartEvent, _Mapping]] = ..., text_block_delta: _Optional[_Union[StreamTextBlockDeltaEvent, _Mapping]] = ..., text_block_end: _Optional[_Union[StreamTextBlockEndEvent, _Mapping]] = ..., thinking_block_start: _Optional[_Union[StreamThinkingBlockStartEvent, _Mapping]] = ..., thinking_block_delta: _Optional[_Union[StreamThinkingBlockDeltaEvent, _Mapping]] = ..., thinking_block_end: _Optional[_Union[StreamThinkingBlockEndEvent, _Mapping]] = ..., tool_call_start: _Optional[_Union[StreamToolCallStartEvent, _Mapping]] = ..., tool_call_delta: _Optional[_Union[StreamToolCallDeltaEvent, _Mapping]] = ..., tool_call_end: _Optional[_Union[StreamToolCallEndEvent, _Mapping]] = ..., tool_result_start: _Optional[_Union[StreamToolResultStartEvent, _Mapping]] = ..., tool_result_delta: _Optional[_Union[StreamToolResultDeltaEvent, _Mapping]] = ..., tool_result_end: _Optional[_Union[StreamToolResultEndEvent, _Mapping]] = ..., confirmation_required: _Optional[_Union[StreamConfirmationRequiredEvent, _Mapping]] = ..., failover: _Optional[_Union[StreamFailoverEvent, _Mapping]] = ..., skill_draft: _Optional[_Union[StreamSkillDraftEvent, _Mapping]] = ..., exceed_max_iters: _Optional[_Union[StreamExceedMaxItersEvent, _Mapping]] = ..., message_stored: _Optional[_Union[StreamMessageStoredEvent, _Mapping]] = ..., done: _Optional[_Union[StreamDoneEvent, _Mapping]] = ..., error: _Optional[_Union[StreamErrorEvent, _Mapping]] = ..., run_id: _Optional[str] = ...) -> None: ...

class StreamSendMessageResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: AgentStreamEvent
    def __init__(self, event: _Optional[_Union[AgentStreamEvent, _Mapping]] = ...) -> None: ...

class RerunFromMessageResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: AgentStreamEvent
    def __init__(self, event: _Optional[_Union[AgentStreamEvent, _Mapping]] = ...) -> None: ...

class SubscribeToRunResponse(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: AgentStreamEvent
    def __init__(self, event: _Optional[_Union[AgentStreamEvent, _Mapping]] = ...) -> None: ...

class StreamReplyStartEvent(_message.Message):
    __slots__ = ("role",)
    ROLE_FIELD_NUMBER: _ClassVar[int]
    role: str
    def __init__(self, role: _Optional[str] = ...) -> None: ...

class StreamModelCallStartEvent(_message.Message):
    __slots__ = ("model",)
    MODEL_FIELD_NUMBER: _ClassVar[int]
    model: str
    def __init__(self, model: _Optional[str] = ...) -> None: ...

class StreamModelCallEndEvent(_message.Message):
    __slots__ = ("model", "input_tokens", "output_tokens", "cache_read_input_tokens", "thinking_tokens", "cache_creation_input_tokens")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    THINKING_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_CREATION_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    model: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    thinking_tokens: int
    cache_creation_input_tokens: int
    def __init__(self, model: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., thinking_tokens: _Optional[int] = ..., cache_creation_input_tokens: _Optional[int] = ...) -> None: ...

class StreamTextBlockStartEvent(_message.Message):
    __slots__ = ("block_id", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamTextBlockDeltaEvent(_message.Message):
    __slots__ = ("block_id", "delta", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    delta: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., delta: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamTextBlockEndEvent(_message.Message):
    __slots__ = ("block_id", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamThinkingBlockStartEvent(_message.Message):
    __slots__ = ("block_id", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamThinkingBlockDeltaEvent(_message.Message):
    __slots__ = ("block_id", "delta", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    delta: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., delta: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamThinkingBlockEndEvent(_message.Message):
    __slots__ = ("block_id", "message_id", "sequence", "elapsed_ms")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    ELAPSED_MS_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    message_id: str
    sequence: int
    elapsed_ms: int
    def __init__(self, block_id: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ..., elapsed_ms: _Optional[int] = ...) -> None: ...

class StreamToolCallStartEvent(_message.Message):
    __slots__ = ("block_id", "tool_call_id", "tool_name", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    tool_call_id: str
    tool_name: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamToolCallDeltaEvent(_message.Message):
    __slots__ = ("block_id", "tool_call_id", "tool_name", "delta", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    tool_call_id: str
    tool_name: str
    delta: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., delta: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamToolCallEndEvent(_message.Message):
    __slots__ = ("block_id", "tool_call_id", "tool_name", "tool_args_json", "message_id", "sequence")
    BLOCK_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_ARGS_JSON_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    block_id: str
    tool_call_id: str
    tool_name: str
    tool_args_json: str
    message_id: str
    sequence: int
    def __init__(self, block_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_args_json: _Optional[str] = ..., message_id: _Optional[str] = ..., sequence: _Optional[int] = ...) -> None: ...

class StreamToolResultStartEvent(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "tool_args_json", "message_id")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_ARGS_JSON_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    tool_args_json: str
    message_id: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., tool_args_json: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class StreamToolResultDeltaEvent(_message.Message):
    __slots__ = ("tool_call_id", "delta", "message_id")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    delta: str
    message_id: str
    def __init__(self, tool_call_id: _Optional[str] = ..., delta: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class StreamToolResultEndEvent(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "success", "result", "message_id")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    success: bool
    result: str
    message_id: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., success: _Optional[bool] = ..., result: _Optional[str] = ..., message_id: _Optional[str] = ...) -> None: ...

class StreamExceedMaxItersEvent(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

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

class StreamFailoverEvent(_message.Message):
    __slots__ = ("from_provider_key_id", "to_provider_key_id", "to_model", "reason", "attempt")
    FROM_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    TO_PROVIDER_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    TO_MODEL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    ATTEMPT_FIELD_NUMBER: _ClassVar[int]
    from_provider_key_id: str
    to_provider_key_id: str
    to_model: str
    reason: str
    attempt: int
    def __init__(self, from_provider_key_id: _Optional[str] = ..., to_provider_key_id: _Optional[str] = ..., to_model: _Optional[str] = ..., reason: _Optional[str] = ..., attempt: _Optional[int] = ...) -> None: ...

class StreamSkillDraftEvent(_message.Message):
    __slots__ = ("draft",)
    DRAFT_FIELD_NUMBER: _ClassVar[int]
    draft: _skills_pb2.SkillDraft
    def __init__(self, draft: _Optional[_Union[_skills_pb2.SkillDraft, _Mapping]] = ...) -> None: ...
