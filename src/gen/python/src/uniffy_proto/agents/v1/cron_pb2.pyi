import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CronTaskInfo(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "agent_id", "execution_user_id", "session_id", "name", "description", "prompt", "cron_expression", "timezone", "is_enabled", "last_run_at", "next_run_at", "last_run_status", "last_run_error", "run_count", "consecutive_failures", "max_consecutive_failures", "access_mode", "created_at", "updated_at", "agent_name", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_USER_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    CRON_EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    IS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    LAST_RUN_AT_FIELD_NUMBER: _ClassVar[int]
    NEXT_RUN_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_RUN_STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_RUN_ERROR_FIELD_NUMBER: _ClassVar[int]
    RUN_COUNT_FIELD_NUMBER: _ClassVar[int]
    CONSECUTIVE_FAILURES_FIELD_NUMBER: _ClassVar[int]
    MAX_CONSECUTIVE_FAILURES_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    agent_id: str
    execution_user_id: str
    session_id: str
    name: str
    description: str
    prompt: str
    cron_expression: str
    timezone: str
    is_enabled: bool
    last_run_at: _timestamp_pb2.Timestamp
    next_run_at: _timestamp_pb2.Timestamp
    last_run_status: str
    last_run_error: str
    run_count: int
    consecutive_failures: int
    max_consecutive_failures: int
    access_mode: _common_pb2.AccessMode
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    agent_name: str
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., execution_user_id: _Optional[str] = ..., session_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., prompt: _Optional[str] = ..., cron_expression: _Optional[str] = ..., timezone: _Optional[str] = ..., is_enabled: _Optional[bool] = ..., last_run_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., next_run_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_run_status: _Optional[str] = ..., last_run_error: _Optional[str] = ..., run_count: _Optional[int] = ..., consecutive_failures: _Optional[int] = ..., max_consecutive_failures: _Optional[int] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., agent_name: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CronRunLogInfo(_message.Message):
    __slots__ = ("id", "cron_task_id", "organization_id", "session_id", "status", "error", "started_at", "completed_at", "input_tokens", "output_tokens")
    ID_FIELD_NUMBER: _ClassVar[int]
    CRON_TASK_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    id: str
    cron_task_id: str
    organization_id: str
    session_id: str
    status: str
    error: str
    started_at: _timestamp_pb2.Timestamp
    completed_at: _timestamp_pb2.Timestamp
    input_tokens: int
    output_tokens: int
    def __init__(self, id: _Optional[str] = ..., cron_task_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., session_id: _Optional[str] = ..., status: _Optional[str] = ..., error: _Optional[str] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class CreateCronTaskRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "name", "prompt", "cron_expression", "timezone", "description", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    CRON_EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    name: str
    prompt: str
    cron_expression: str
    timezone: str
    description: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., name: _Optional[str] = ..., prompt: _Optional[str] = ..., cron_expression: _Optional[str] = ..., timezone: _Optional[str] = ..., description: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreateCronTaskResponse(_message.Message):
    __slots__ = ("task",)
    TASK_FIELD_NUMBER: _ClassVar[int]
    task: CronTaskInfo
    def __init__(self, task: _Optional[_Union[CronTaskInfo, _Mapping]] = ...) -> None: ...

class GetCronTaskResponse(_message.Message):
    __slots__ = ("task",)
    TASK_FIELD_NUMBER: _ClassVar[int]
    task: CronTaskInfo
    def __init__(self, task: _Optional[_Union[CronTaskInfo, _Mapping]] = ...) -> None: ...

class UpdateCronTaskResponse(_message.Message):
    __slots__ = ("task",)
    TASK_FIELD_NUMBER: _ClassVar[int]
    task: CronTaskInfo
    def __init__(self, task: _Optional[_Union[CronTaskInfo, _Mapping]] = ...) -> None: ...

class GetCronTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class ListCronTasksRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListCronTasksResponse(_message.Message):
    __slots__ = ("tasks", "pagination")
    TASKS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    tasks: _containers.RepeatedCompositeFieldContainer[CronTaskInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, tasks: _Optional[_Iterable[_Union[CronTaskInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class UpdateCronTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "name", "prompt", "cron_expression", "timezone", "description", "is_enabled")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    CRON_EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    name: str
    prompt: str
    cron_expression: str
    timezone: str
    description: str
    is_enabled: bool
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., name: _Optional[str] = ..., prompt: _Optional[str] = ..., cron_expression: _Optional[str] = ..., timezone: _Optional[str] = ..., description: _Optional[str] = ..., is_enabled: _Optional[bool] = ...) -> None: ...

class DeleteCronTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class DeleteCronTaskResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListCronRunLogsRequest(_message.Message):
    __slots__ = ("organization_id", "task_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListCronRunLogsResponse(_message.Message):
    __slots__ = ("logs", "pagination")
    LOGS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    logs: _containers.RepeatedCompositeFieldContainer[CronRunLogInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, logs: _Optional[_Iterable[_Union[CronRunLogInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class TriggerCronTaskRequest(_message.Message):
    __slots__ = ("organization_id", "task_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    task_id: str
    def __init__(self, organization_id: _Optional[str] = ..., task_id: _Optional[str] = ...) -> None: ...

class TriggerCronTaskResponse(_message.Message):
    __slots__ = ("run_log", "task")
    RUN_LOG_FIELD_NUMBER: _ClassVar[int]
    TASK_FIELD_NUMBER: _ClassVar[int]
    run_log: CronRunLogInfo
    task: CronTaskInfo
    def __init__(self, run_log: _Optional[_Union[CronRunLogInfo, _Mapping]] = ..., task: _Optional[_Union[CronTaskInfo, _Mapping]] = ...) -> None: ...
