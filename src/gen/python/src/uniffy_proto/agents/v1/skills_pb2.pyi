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

class SkillSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SKILL_SOURCE_UNSPECIFIED: _ClassVar[SkillSource]
    SKILL_SOURCE_BUNDLED: _ClassVar[SkillSource]
    SKILL_SOURCE_ORGANIZATION: _ClassVar[SkillSource]
SKILL_SOURCE_UNSPECIFIED: SkillSource
SKILL_SOURCE_BUNDLED: SkillSource
SKILL_SOURCE_ORGANIZATION: SkillSource

class SkillInfo(_message.Message):
    __slots__ = ("id", "organization_id", "name", "display_name", "description", "content", "source", "created_at", "updated_at", "requires_tools", "status", "origin", "latest_version_number", "active_version_number", "active_version_pinned", "supported_surfaces")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    LATEST_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_PINNED_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_SURFACES_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    display_name: str
    description: str
    content: str
    source: SkillSource
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    status: str
    origin: str
    latest_version_number: int
    active_version_number: int
    active_version_pinned: bool
    supported_surfaces: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., source: _Optional[_Union[SkillSource, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., requires_tools: _Optional[_Iterable[str]] = ..., status: _Optional[str] = ..., origin: _Optional[str] = ..., latest_version_number: _Optional[int] = ..., active_version_number: _Optional[int] = ..., active_version_pinned: _Optional[bool] = ..., supported_surfaces: _Optional[_Iterable[str]] = ...) -> None: ...

class SkillVersion(_message.Message):
    __slots__ = ("id", "skill_id", "version_number", "name", "display_name", "description", "content", "requires_tools", "author_id", "author_kind", "change_summary", "parent_version_id", "created_at", "supported_surfaces")
    ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_ID_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_KIND_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    PARENT_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_SURFACES_FIELD_NUMBER: _ClassVar[int]
    id: str
    skill_id: str
    version_number: int
    name: str
    display_name: str
    description: str
    content: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    author_id: str
    author_kind: str
    change_summary: str
    parent_version_id: str
    created_at: _timestamp_pb2.Timestamp
    supported_surfaces: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, id: _Optional[str] = ..., skill_id: _Optional[str] = ..., version_number: _Optional[int] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., author_id: _Optional[str] = ..., author_kind: _Optional[str] = ..., change_summary: _Optional[str] = ..., parent_version_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., supported_surfaces: _Optional[_Iterable[str]] = ...) -> None: ...

class SkillDraft(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "target_skill_id", "kind", "proposed_by_agent_id", "session_id", "channel_id", "origin_chat_message_id", "evidence_message_ids", "rationale", "name", "display_name", "description", "content", "requires_tools", "status", "created_at", "updated_at", "supported_surfaces", "invocation_id", "target_version_id", "target_version_number", "generation_attempt", "generation_error")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    PROPOSED_BY_AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_CHAT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_MESSAGE_IDS_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_SURFACES_FIELD_NUMBER: _ClassVar[int]
    INVOCATION_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    TARGET_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ATTEMPT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    owner_id: str
    target_skill_id: str
    kind: str
    proposed_by_agent_id: str
    session_id: str
    channel_id: str
    origin_chat_message_id: str
    evidence_message_ids: _containers.RepeatedScalarFieldContainer[str]
    rationale: str
    name: str
    display_name: str
    description: str
    content: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    status: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    supported_surfaces: _containers.RepeatedScalarFieldContainer[str]
    invocation_id: str
    target_version_id: str
    target_version_number: int
    generation_attempt: int
    generation_error: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., target_skill_id: _Optional[str] = ..., kind: _Optional[str] = ..., proposed_by_agent_id: _Optional[str] = ..., session_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., origin_chat_message_id: _Optional[str] = ..., evidence_message_ids: _Optional[_Iterable[str]] = ..., rationale: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., status: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., supported_surfaces: _Optional[_Iterable[str]] = ..., invocation_id: _Optional[str] = ..., target_version_id: _Optional[str] = ..., target_version_number: _Optional[int] = ..., generation_attempt: _Optional[int] = ..., generation_error: _Optional[str] = ...) -> None: ...

class GenerateSkillDraftRequest(_message.Message):
    __slots__ = ("organization_id", "request_id", "agent_id", "session_id", "channel_id", "thread_root_id", "evidence_message_ids", "rationale", "invocation_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    THREAD_ROOT_ID_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_MESSAGE_IDS_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    INVOCATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    request_id: str
    agent_id: str
    session_id: str
    channel_id: str
    thread_root_id: str
    evidence_message_ids: _containers.RepeatedScalarFieldContainer[str]
    rationale: str
    invocation_id: str
    def __init__(self, organization_id: _Optional[str] = ..., request_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., session_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., thread_root_id: _Optional[str] = ..., evidence_message_ids: _Optional[_Iterable[str]] = ..., rationale: _Optional[str] = ..., invocation_id: _Optional[str] = ...) -> None: ...

class GenerateSkillDraftResponse(_message.Message):
    __slots__ = ("draft",)
    DRAFT_FIELD_NUMBER: _ClassVar[int]
    draft: SkillDraft
    def __init__(self, draft: _Optional[_Union[SkillDraft, _Mapping]] = ...) -> None: ...

class RetrySkillDraftGenerationRequest(_message.Message):
    __slots__ = ("organization_id", "draft_id", "expected_attempt")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_ATTEMPT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    draft_id: str
    expected_attempt: int
    def __init__(self, organization_id: _Optional[str] = ..., draft_id: _Optional[str] = ..., expected_attempt: _Optional[int] = ...) -> None: ...

class RetrySkillDraftGenerationResponse(_message.Message):
    __slots__ = ("draft",)
    DRAFT_FIELD_NUMBER: _ClassVar[int]
    draft: SkillDraft
    def __init__(self, draft: _Optional[_Union[SkillDraft, _Mapping]] = ...) -> None: ...

class CreateSkillRequest(_message.Message):
    __slots__ = ("organization_id", "name", "display_name", "description", "content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    display_name: str
    description: str
    content: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...

class CreateSkillResponse(_message.Message):
    __slots__ = ("skill",)
    SKILL_FIELD_NUMBER: _ClassVar[int]
    skill: SkillInfo
    def __init__(self, skill: _Optional[_Union[SkillInfo, _Mapping]] = ...) -> None: ...

class GetSkillResponse(_message.Message):
    __slots__ = ("skill",)
    SKILL_FIELD_NUMBER: _ClassVar[int]
    skill: SkillInfo
    def __init__(self, skill: _Optional[_Union[SkillInfo, _Mapping]] = ...) -> None: ...

class UpdateSkillResponse(_message.Message):
    __slots__ = ("skill",)
    SKILL_FIELD_NUMBER: _ClassVar[int]
    skill: SkillInfo
    def __init__(self, skill: _Optional[_Union[SkillInfo, _Mapping]] = ...) -> None: ...

class GetSkillRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ...) -> None: ...

class ListSkillsRequest(_message.Message):
    __slots__ = ("organization_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListSkillsResponse(_message.Message):
    __slots__ = ("skills", "pagination")
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    skills: _containers.RepeatedCompositeFieldContainer[SkillInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, skills: _Optional[_Iterable[_Union[SkillInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class UpdateSkillRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id", "name", "display_name", "description", "content")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    name: str
    display_name: str
    description: str
    content: str
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...

class DeleteSkillRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ...) -> None: ...

class DeleteSkillResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class RunnableSkill(_message.Message):
    __slots__ = ("id", "name", "display_name", "description")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    display_name: str
    description: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class ListRunnableSkillsRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "surface")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    SURFACE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    surface: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., surface: _Optional[str] = ...) -> None: ...

class ListRunnableSkillsResponse(_message.Message):
    __slots__ = ("skills",)
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    skills: _containers.RepeatedCompositeFieldContainer[RunnableSkill]
    def __init__(self, skills: _Optional[_Iterable[_Union[RunnableSkill, _Mapping]]] = ...) -> None: ...

class GetSkillCompatibilityRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class SkillCompatibility(_message.Message):
    __slots__ = ("skill_id", "version_id", "version_number", "missing_tools", "unsupported_surfaces", "unavailable", "display_name", "retired")
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    MISSING_TOOLS_FIELD_NUMBER: _ClassVar[int]
    UNSUPPORTED_SURFACES_FIELD_NUMBER: _ClassVar[int]
    UNAVAILABLE_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    RETIRED_FIELD_NUMBER: _ClassVar[int]
    skill_id: str
    version_id: str
    version_number: int
    missing_tools: _containers.RepeatedScalarFieldContainer[str]
    unsupported_surfaces: _containers.RepeatedScalarFieldContainer[str]
    unavailable: bool
    display_name: str
    retired: bool
    def __init__(self, skill_id: _Optional[str] = ..., version_id: _Optional[str] = ..., version_number: _Optional[int] = ..., missing_tools: _Optional[_Iterable[str]] = ..., unsupported_surfaces: _Optional[_Iterable[str]] = ..., unavailable: _Optional[bool] = ..., display_name: _Optional[str] = ..., retired: _Optional[bool] = ...) -> None: ...

class GetSkillCompatibilityResponse(_message.Message):
    __slots__ = ("skills",)
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    skills: _containers.RepeatedCompositeFieldContainer[SkillCompatibility]
    def __init__(self, skills: _Optional[_Iterable[_Union[SkillCompatibility, _Mapping]]] = ...) -> None: ...

class CreateSkillDraftRequest(_message.Message):
    __slots__ = ("organization_id", "kind", "target_skill_id", "name", "display_name", "description", "content", "requires_tools", "rationale", "supported_surfaces")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    TARGET_SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_SURFACES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    kind: str
    target_skill_id: str
    name: str
    display_name: str
    description: str
    content: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    rationale: str
    supported_surfaces: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., kind: _Optional[str] = ..., target_skill_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., rationale: _Optional[str] = ..., supported_surfaces: _Optional[_Iterable[str]] = ...) -> None: ...

class CreateSkillDraftResponse(_message.Message):
    __slots__ = ("draft",)
    DRAFT_FIELD_NUMBER: _ClassVar[int]
    draft: SkillDraft
    def __init__(self, draft: _Optional[_Union[SkillDraft, _Mapping]] = ...) -> None: ...

class GetSkillDraftRequest(_message.Message):
    __slots__ = ("organization_id", "draft_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    draft_id: str
    def __init__(self, organization_id: _Optional[str] = ..., draft_id: _Optional[str] = ...) -> None: ...

class GetSkillDraftResponse(_message.Message):
    __slots__ = ("draft",)
    DRAFT_FIELD_NUMBER: _ClassVar[int]
    draft: SkillDraft
    def __init__(self, draft: _Optional[_Union[SkillDraft, _Mapping]] = ...) -> None: ...

class ListSkillDraftsRequest(_message.Message):
    __slots__ = ("organization_id", "status", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    status: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., status: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListSkillDraftsResponse(_message.Message):
    __slots__ = ("drafts", "pagination")
    DRAFTS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    drafts: _containers.RepeatedCompositeFieldContainer[SkillDraft]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, drafts: _Optional[_Iterable[_Union[SkillDraft, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class SaveSkillDraftRequest(_message.Message):
    __slots__ = ("organization_id", "draft_id", "name", "display_name", "description", "content", "requires_tools", "change_summary", "allow_replace", "supported_surfaces")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    ALLOW_REPLACE_FIELD_NUMBER: _ClassVar[int]
    SUPPORTED_SURFACES_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    draft_id: str
    name: str
    display_name: str
    description: str
    content: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    change_summary: str
    allow_replace: bool
    supported_surfaces: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., draft_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., change_summary: _Optional[str] = ..., allow_replace: _Optional[bool] = ..., supported_surfaces: _Optional[_Iterable[str]] = ...) -> None: ...

class SaveSkillDraftResponse(_message.Message):
    __slots__ = ("skill", "version")
    SKILL_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    skill: SkillInfo
    version: SkillVersion
    def __init__(self, skill: _Optional[_Union[SkillInfo, _Mapping]] = ..., version: _Optional[_Union[SkillVersion, _Mapping]] = ...) -> None: ...

class DiscardSkillDraftRequest(_message.Message):
    __slots__ = ("organization_id", "draft_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    draft_id: str
    def __init__(self, organization_id: _Optional[str] = ..., draft_id: _Optional[str] = ...) -> None: ...

class DiscardSkillDraftResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListSkillVersionsRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListSkillVersionsResponse(_message.Message):
    __slots__ = ("versions", "pagination", "active_version_number", "active_version_pinned", "latest_version_number")
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_PINNED_FIELD_NUMBER: _ClassVar[int]
    LATEST_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    versions: _containers.RepeatedCompositeFieldContainer[SkillVersion]
    pagination: _common_pb2.PaginationResponse
    active_version_number: int
    active_version_pinned: bool
    latest_version_number: int
    def __init__(self, versions: _Optional[_Iterable[_Union[SkillVersion, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ..., active_version_number: _Optional[int] = ..., active_version_pinned: _Optional[bool] = ..., latest_version_number: _Optional[int] = ...) -> None: ...

class GetSkillVersionRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id", "version_number")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    version_number: int
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., version_number: _Optional[int] = ...) -> None: ...

class GetSkillVersionResponse(_message.Message):
    __slots__ = ("version",)
    VERSION_FIELD_NUMBER: _ClassVar[int]
    version: SkillVersion
    def __init__(self, version: _Optional[_Union[SkillVersion, _Mapping]] = ...) -> None: ...

class SetMainSkillVersionRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id", "version_number", "follow_latest")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    FOLLOW_LATEST_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    version_number: int
    follow_latest: bool
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., version_number: _Optional[int] = ..., follow_latest: _Optional[bool] = ...) -> None: ...

class SetMainSkillVersionResponse(_message.Message):
    __slots__ = ("skill",)
    SKILL_FIELD_NUMBER: _ClassVar[int]
    skill: SkillInfo
    def __init__(self, skill: _Optional[_Union[SkillInfo, _Mapping]] = ...) -> None: ...

class RevertSkillRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id", "version_number")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    version_number: int
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., version_number: _Optional[int] = ...) -> None: ...

class RevertSkillResponse(_message.Message):
    __slots__ = ("skill", "version")
    SKILL_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    skill: SkillInfo
    version: SkillVersion
    def __init__(self, skill: _Optional[_Union[SkillInfo, _Mapping]] = ..., version: _Optional[_Union[SkillVersion, _Mapping]] = ...) -> None: ...

class SkillMetric(_message.Message):
    __slots__ = ("skill_id", "display_name", "skill_version_id", "skill_version_number", "invocation_count", "started_count", "completed_count", "failed_count", "rejected_count", "cancelled_count", "tool_error_run_count", "tool_error_rate", "unique_users", "run_log_count", "duration_ms", "input_tokens", "output_tokens", "costs")
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    SKILL_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    INVOCATION_COUNT_FIELD_NUMBER: _ClassVar[int]
    STARTED_COUNT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_COUNT_FIELD_NUMBER: _ClassVar[int]
    FAILED_COUNT_FIELD_NUMBER: _ClassVar[int]
    REJECTED_COUNT_FIELD_NUMBER: _ClassVar[int]
    CANCELLED_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOOL_ERROR_RUN_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOOL_ERROR_RATE_FIELD_NUMBER: _ClassVar[int]
    UNIQUE_USERS_FIELD_NUMBER: _ClassVar[int]
    RUN_LOG_COUNT_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COSTS_FIELD_NUMBER: _ClassVar[int]
    skill_id: str
    display_name: str
    skill_version_id: str
    skill_version_number: int
    invocation_count: int
    started_count: int
    completed_count: int
    failed_count: int
    rejected_count: int
    cancelled_count: int
    tool_error_run_count: int
    tool_error_rate: float
    unique_users: int
    run_log_count: int
    duration_ms: int
    input_tokens: int
    output_tokens: int
    costs: _containers.RepeatedCompositeFieldContainer[SkillMetricCost]
    def __init__(self, skill_id: _Optional[str] = ..., display_name: _Optional[str] = ..., skill_version_id: _Optional[str] = ..., skill_version_number: _Optional[int] = ..., invocation_count: _Optional[int] = ..., started_count: _Optional[int] = ..., completed_count: _Optional[int] = ..., failed_count: _Optional[int] = ..., rejected_count: _Optional[int] = ..., cancelled_count: _Optional[int] = ..., tool_error_run_count: _Optional[int] = ..., tool_error_rate: _Optional[float] = ..., unique_users: _Optional[int] = ..., run_log_count: _Optional[int] = ..., duration_ms: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., costs: _Optional[_Iterable[_Union[SkillMetricCost, _Mapping]]] = ...) -> None: ...

class SkillMetricCost(_message.Message):
    __slots__ = ("currency", "amount", "run_count")
    CURRENCY_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_FIELD_NUMBER: _ClassVar[int]
    RUN_COUNT_FIELD_NUMBER: _ClassVar[int]
    currency: str
    amount: str
    run_count: int
    def __init__(self, currency: _Optional[str] = ..., amount: _Optional[str] = ..., run_count: _Optional[int] = ...) -> None: ...

class GetSkillMetricsRequest(_message.Message):
    __slots__ = ("organization_id", "skill_id", "window_days", "page_size", "cursor")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    WINDOW_DAYS_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    window_days: int
    page_size: int
    cursor: str
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., window_days: _Optional[int] = ..., page_size: _Optional[int] = ..., cursor: _Optional[str] = ...) -> None: ...

class GetSkillMetricsResponse(_message.Message):
    __slots__ = ("metrics", "next_cursor", "window_start", "window_end")
    METRICS_FIELD_NUMBER: _ClassVar[int]
    NEXT_CURSOR_FIELD_NUMBER: _ClassVar[int]
    WINDOW_START_FIELD_NUMBER: _ClassVar[int]
    WINDOW_END_FIELD_NUMBER: _ClassVar[int]
    metrics: _containers.RepeatedCompositeFieldContainer[SkillMetric]
    next_cursor: str
    window_start: _timestamp_pb2.Timestamp
    window_end: _timestamp_pb2.Timestamp
    def __init__(self, metrics: _Optional[_Iterable[_Union[SkillMetric, _Mapping]]] = ..., next_cursor: _Optional[str] = ..., window_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., window_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
