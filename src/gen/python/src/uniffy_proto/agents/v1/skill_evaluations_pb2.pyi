import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvaluationStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVALUATION_STATUS_UNSPECIFIED: _ClassVar[EvaluationStatus]
    EVALUATION_STATUS_QUEUED: _ClassVar[EvaluationStatus]
    EVALUATION_STATUS_RUNNING: _ClassVar[EvaluationStatus]
    EVALUATION_STATUS_PASSED: _ClassVar[EvaluationStatus]
    EVALUATION_STATUS_FAILED: _ClassVar[EvaluationStatus]
    EVALUATION_STATUS_INCONCLUSIVE: _ClassVar[EvaluationStatus]
    EVALUATION_STATUS_ERROR: _ClassVar[EvaluationStatus]
EVALUATION_STATUS_UNSPECIFIED: EvaluationStatus
EVALUATION_STATUS_QUEUED: EvaluationStatus
EVALUATION_STATUS_RUNNING: EvaluationStatus
EVALUATION_STATUS_PASSED: EvaluationStatus
EVALUATION_STATUS_FAILED: EvaluationStatus
EVALUATION_STATUS_INCONCLUSIVE: EvaluationStatus
EVALUATION_STATUS_ERROR: EvaluationStatus

class EvaluationScope(_message.Message):
    __slots__ = ("skill_id", "draft_id")
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    skill_id: str
    draft_id: str
    def __init__(self, skill_id: _Optional[str] = ..., draft_id: _Optional[str] = ...) -> None: ...

class ToolFixture(_message.Message):
    __slots__ = ("tool_name", "response", "is_error")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_FIELD_NUMBER: _ClassVar[int]
    IS_ERROR_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    response: str
    is_error: bool
    def __init__(self, tool_name: _Optional[str] = ..., response: _Optional[str] = ..., is_error: _Optional[bool] = ...) -> None: ...

class EvaluationCaseFields(_message.Message):
    __slots__ = ("name", "input", "rubric", "expected_tools", "forbidden_tools", "fixtures")
    NAME_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    RUBRIC_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    FORBIDDEN_TOOLS_FIELD_NUMBER: _ClassVar[int]
    FIXTURES_FIELD_NUMBER: _ClassVar[int]
    name: str
    input: str
    rubric: str
    expected_tools: _containers.RepeatedScalarFieldContainer[str]
    forbidden_tools: _containers.RepeatedScalarFieldContainer[str]
    fixtures: _containers.RepeatedCompositeFieldContainer[ToolFixture]
    def __init__(self, name: _Optional[str] = ..., input: _Optional[str] = ..., rubric: _Optional[str] = ..., expected_tools: _Optional[_Iterable[str]] = ..., forbidden_tools: _Optional[_Iterable[str]] = ..., fixtures: _Optional[_Iterable[_Union[ToolFixture, _Mapping]]] = ...) -> None: ...

class EvaluationCase(_message.Message):
    __slots__ = ("id", "scope", "fields", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    scope: EvaluationScope
    fields: EvaluationCaseFields
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., scope: _Optional[_Union[EvaluationScope, _Mapping]] = ..., fields: _Optional[_Union[EvaluationCaseFields, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateEvaluationCaseRequest(_message.Message):
    __slots__ = ("organization_id", "scope", "fields")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    scope: EvaluationScope
    fields: EvaluationCaseFields
    def __init__(self, organization_id: _Optional[str] = ..., scope: _Optional[_Union[EvaluationScope, _Mapping]] = ..., fields: _Optional[_Union[EvaluationCaseFields, _Mapping]] = ...) -> None: ...

class UpdateEvaluationCaseRequest(_message.Message):
    __slots__ = ("organization_id", "case_id", "fields")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CASE_ID_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    case_id: str
    fields: EvaluationCaseFields
    def __init__(self, organization_id: _Optional[str] = ..., case_id: _Optional[str] = ..., fields: _Optional[_Union[EvaluationCaseFields, _Mapping]] = ...) -> None: ...

class EvaluationCaseResponse(_message.Message):
    __slots__ = ("evaluation_case",)
    EVALUATION_CASE_FIELD_NUMBER: _ClassVar[int]
    evaluation_case: EvaluationCase
    def __init__(self, evaluation_case: _Optional[_Union[EvaluationCase, _Mapping]] = ...) -> None: ...

class DeleteEvaluationCaseRequest(_message.Message):
    __slots__ = ("organization_id", "case_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CASE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    case_id: str
    def __init__(self, organization_id: _Optional[str] = ..., case_id: _Optional[str] = ...) -> None: ...

class DeleteEvaluationCaseResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListEvaluationCasesRequest(_message.Message):
    __slots__ = ("organization_id", "scope")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    scope: EvaluationScope
    def __init__(self, organization_id: _Optional[str] = ..., scope: _Optional[_Union[EvaluationScope, _Mapping]] = ...) -> None: ...

class ListEvaluationCasesResponse(_message.Message):
    __slots__ = ("cases",)
    CASES_FIELD_NUMBER: _ClassVar[int]
    cases: _containers.RepeatedCompositeFieldContainer[EvaluationCase]
    def __init__(self, cases: _Optional[_Iterable[_Union[EvaluationCase, _Mapping]]] = ...) -> None: ...

class EvaluationTarget(_message.Message):
    __slots__ = ("skill_version_id", "draft_id", "draft_content")
    SKILL_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_CONTENT_FIELD_NUMBER: _ClassVar[int]
    skill_version_id: str
    draft_id: str
    draft_content: str
    def __init__(self, skill_version_id: _Optional[str] = ..., draft_id: _Optional[str] = ..., draft_content: _Optional[str] = ...) -> None: ...

class RunSkillEvaluationRequest(_message.Message):
    __slots__ = ("organization_id", "request_id", "agent_id", "target", "case_ids", "judge", "model_override", "judge_model")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_FIELD_NUMBER: _ClassVar[int]
    CASE_IDS_FIELD_NUMBER: _ClassVar[int]
    JUDGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_OVERRIDE_FIELD_NUMBER: _ClassVar[int]
    JUDGE_MODEL_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    request_id: str
    agent_id: str
    target: EvaluationTarget
    case_ids: _containers.RepeatedScalarFieldContainer[str]
    judge: bool
    model_override: str
    judge_model: str
    def __init__(self, organization_id: _Optional[str] = ..., request_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., target: _Optional[_Union[EvaluationTarget, _Mapping]] = ..., case_ids: _Optional[_Iterable[str]] = ..., judge: _Optional[bool] = ..., model_override: _Optional[str] = ..., judge_model: _Optional[str] = ...) -> None: ...

class EvaluationToolAttempt(_message.Message):
    __slots__ = ("tool_name", "input_json", "fixture_response", "fixture_used", "issue")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    INPUT_JSON_FIELD_NUMBER: _ClassVar[int]
    FIXTURE_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    FIXTURE_USED_FIELD_NUMBER: _ClassVar[int]
    ISSUE_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    input_json: str
    fixture_response: str
    fixture_used: bool
    issue: str
    def __init__(self, tool_name: _Optional[str] = ..., input_json: _Optional[str] = ..., fixture_response: _Optional[str] = ..., fixture_used: _Optional[bool] = ..., issue: _Optional[str] = ...) -> None: ...

class EvaluationAssertion(_message.Message):
    __slots__ = ("tool_name", "kind", "passed")
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    tool_name: str
    kind: str
    passed: bool
    def __init__(self, tool_name: _Optional[str] = ..., kind: _Optional[str] = ..., passed: _Optional[bool] = ...) -> None: ...

class EvaluationJudge(_message.Message):
    __slots__ = ("status", "score", "rationale", "error")
    STATUS_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    status: str
    score: float
    rationale: str
    error: str
    def __init__(self, status: _Optional[str] = ..., score: _Optional[float] = ..., rationale: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class EvaluationRun(_message.Message):
    __slots__ = ("id", "request_id", "case_id", "agent_id", "skill_id", "skill_version_id", "version_number", "draft_id", "target_digest", "status", "error", "case_snapshot", "target_content", "output", "tool_attempts", "assertions", "judge", "model", "cost", "cost_currency", "input_tokens", "output_tokens", "duration_ms", "created_at", "completed_at", "rule_version_ids", "outcome_reason", "run_log_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    CASE_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_DIGEST_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    CASE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    TARGET_CONTENT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    TOOL_ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    ASSERTIONS_FIELD_NUMBER: _ClassVar[int]
    JUDGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    COST_FIELD_NUMBER: _ClassVar[int]
    COST_CURRENCY_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    RULE_VERSION_IDS_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_REASON_FIELD_NUMBER: _ClassVar[int]
    RUN_LOG_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    request_id: str
    case_id: str
    agent_id: str
    skill_id: str
    skill_version_id: str
    version_number: int
    draft_id: str
    target_digest: str
    status: EvaluationStatus
    error: str
    case_snapshot: EvaluationCaseFields
    target_content: str
    output: str
    tool_attempts: _containers.RepeatedCompositeFieldContainer[EvaluationToolAttempt]
    assertions: _containers.RepeatedCompositeFieldContainer[EvaluationAssertion]
    judge: EvaluationJudge
    model: str
    cost: str
    cost_currency: str
    input_tokens: int
    output_tokens: int
    duration_ms: int
    created_at: _timestamp_pb2.Timestamp
    completed_at: _timestamp_pb2.Timestamp
    rule_version_ids: _containers.RepeatedScalarFieldContainer[str]
    outcome_reason: str
    run_log_id: str
    def __init__(self, id: _Optional[str] = ..., request_id: _Optional[str] = ..., case_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., skill_version_id: _Optional[str] = ..., version_number: _Optional[int] = ..., draft_id: _Optional[str] = ..., target_digest: _Optional[str] = ..., status: _Optional[_Union[EvaluationStatus, str]] = ..., error: _Optional[str] = ..., case_snapshot: _Optional[_Union[EvaluationCaseFields, _Mapping]] = ..., target_content: _Optional[str] = ..., output: _Optional[str] = ..., tool_attempts: _Optional[_Iterable[_Union[EvaluationToolAttempt, _Mapping]]] = ..., assertions: _Optional[_Iterable[_Union[EvaluationAssertion, _Mapping]]] = ..., judge: _Optional[_Union[EvaluationJudge, _Mapping]] = ..., model: _Optional[str] = ..., cost: _Optional[str] = ..., cost_currency: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., duration_ms: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., rule_version_ids: _Optional[_Iterable[str]] = ..., outcome_reason: _Optional[str] = ..., run_log_id: _Optional[str] = ...) -> None: ...

class RunSkillEvaluationResponse(_message.Message):
    __slots__ = ("runs",)
    RUNS_FIELD_NUMBER: _ClassVar[int]
    runs: _containers.RepeatedCompositeFieldContainer[EvaluationRun]
    def __init__(self, runs: _Optional[_Iterable[_Union[EvaluationRun, _Mapping]]] = ...) -> None: ...

class ListEvaluationRunsRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "scope", "page_size", "cursor")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    scope: EvaluationScope
    page_size: int
    cursor: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., scope: _Optional[_Union[EvaluationScope, _Mapping]] = ..., page_size: _Optional[int] = ..., cursor: _Optional[str] = ...) -> None: ...

class ListEvaluationRunsResponse(_message.Message):
    __slots__ = ("runs", "next_cursor")
    RUNS_FIELD_NUMBER: _ClassVar[int]
    NEXT_CURSOR_FIELD_NUMBER: _ClassVar[int]
    runs: _containers.RepeatedCompositeFieldContainer[EvaluationRun]
    next_cursor: str
    def __init__(self, runs: _Optional[_Iterable[_Union[EvaluationRun, _Mapping]]] = ..., next_cursor: _Optional[str] = ...) -> None: ...

class GetEvaluationRunRequest(_message.Message):
    __slots__ = ("organization_id", "run_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    run_id: str
    def __init__(self, organization_id: _Optional[str] = ..., run_id: _Optional[str] = ...) -> None: ...

class EvaluationRunResponse(_message.Message):
    __slots__ = ("run",)
    RUN_FIELD_NUMBER: _ClassVar[int]
    run: EvaluationRun
    def __init__(self, run: _Optional[_Union[EvaluationRun, _Mapping]] = ...) -> None: ...
