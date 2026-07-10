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
    SKILL_SOURCE_PERSONAL: _ClassVar[SkillSource]
SKILL_SOURCE_UNSPECIFIED: SkillSource
SKILL_SOURCE_BUNDLED: SkillSource
SKILL_SOURCE_ORGANIZATION: SkillSource
SKILL_SOURCE_PERSONAL: SkillSource

class SkillInfo(_message.Message):
    __slots__ = ("id", "organization_id", "name", "display_name", "description", "content", "source", "always_active", "created_at", "updated_at", "owner_id", "when_to_use", "requires_tools", "requires_context", "status", "origin", "latest_version_number", "active_version_number", "active_version_pinned")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    ALWAYS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    WHEN_TO_USE_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    LATEST_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_PINNED_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    display_name: str
    description: str
    content: str
    source: SkillSource
    always_active: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    owner_id: str
    when_to_use: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    requires_context: _containers.RepeatedScalarFieldContainer[str]
    status: str
    origin: str
    latest_version_number: int
    active_version_number: int
    active_version_pinned: bool
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., source: _Optional[_Union[SkillSource, str]] = ..., always_active: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., owner_id: _Optional[str] = ..., when_to_use: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., requires_context: _Optional[_Iterable[str]] = ..., status: _Optional[str] = ..., origin: _Optional[str] = ..., latest_version_number: _Optional[int] = ..., active_version_number: _Optional[int] = ..., active_version_pinned: _Optional[bool] = ...) -> None: ...

class SkillVersion(_message.Message):
    __slots__ = ("id", "skill_id", "version_number", "name", "display_name", "description", "content", "when_to_use", "requires_tools", "requires_context", "author_id", "author_kind", "change_summary", "parent_version_id", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    WHEN_TO_USE_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_ID_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_KIND_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    PARENT_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    skill_id: str
    version_number: int
    name: str
    display_name: str
    description: str
    content: str
    when_to_use: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    requires_context: _containers.RepeatedScalarFieldContainer[str]
    author_id: str
    author_kind: str
    change_summary: str
    parent_version_id: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., skill_id: _Optional[str] = ..., version_number: _Optional[int] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., when_to_use: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., requires_context: _Optional[_Iterable[str]] = ..., author_id: _Optional[str] = ..., author_kind: _Optional[str] = ..., change_summary: _Optional[str] = ..., parent_version_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SkillDraft(_message.Message):
    __slots__ = ("id", "organization_id", "owner_id", "target_skill_id", "kind", "proposed_by_agent_id", "session_id", "channel_id", "origin_chat_message_id", "evidence_message_ids", "rationale", "name", "display_name", "description", "content", "when_to_use", "requires_tools", "requires_context", "suggested_scope", "suggested_always_active", "status", "created_at", "updated_at")
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
    WHEN_TO_USE_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_SCOPE_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_ALWAYS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
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
    when_to_use: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    requires_context: _containers.RepeatedScalarFieldContainer[str]
    suggested_scope: str
    suggested_always_active: bool
    status: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., target_skill_id: _Optional[str] = ..., kind: _Optional[str] = ..., proposed_by_agent_id: _Optional[str] = ..., session_id: _Optional[str] = ..., channel_id: _Optional[str] = ..., origin_chat_message_id: _Optional[str] = ..., evidence_message_ids: _Optional[_Iterable[str]] = ..., rationale: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., when_to_use: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., requires_context: _Optional[_Iterable[str]] = ..., suggested_scope: _Optional[str] = ..., suggested_always_active: _Optional[bool] = ..., status: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateSkillRequest(_message.Message):
    __slots__ = ("organization_id", "name", "display_name", "description", "content", "always_active", "owner_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    ALWAYS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    display_name: str
    description: str
    content: str
    always_active: bool
    owner_id: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., always_active: _Optional[bool] = ..., owner_id: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("organization_id", "skill_id", "name", "display_name", "description", "content", "always_active")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    ALWAYS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    skill_id: str
    name: str
    display_name: str
    description: str
    content: str
    always_active: bool
    def __init__(self, organization_id: _Optional[str] = ..., skill_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., always_active: _Optional[bool] = ...) -> None: ...

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
    __slots__ = ("id", "name", "display_name", "description", "when_to_use")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    WHEN_TO_USE_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    display_name: str
    description: str
    when_to_use: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., when_to_use: _Optional[str] = ...) -> None: ...

class ListRunnableSkillsRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class ListRunnableSkillsResponse(_message.Message):
    __slots__ = ("skills",)
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    skills: _containers.RepeatedCompositeFieldContainer[RunnableSkill]
    def __init__(self, skills: _Optional[_Iterable[_Union[RunnableSkill, _Mapping]]] = ...) -> None: ...

class CreateSkillDraftRequest(_message.Message):
    __slots__ = ("organization_id", "kind", "target_skill_id", "name", "display_name", "description", "content", "when_to_use", "requires_tools", "requires_context", "suggested_scope", "suggested_always_active", "rationale")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    TARGET_SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    WHEN_TO_USE_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_SCOPE_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_ALWAYS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    kind: str
    target_skill_id: str
    name: str
    display_name: str
    description: str
    content: str
    when_to_use: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    requires_context: _containers.RepeatedScalarFieldContainer[str]
    suggested_scope: str
    suggested_always_active: bool
    rationale: str
    def __init__(self, organization_id: _Optional[str] = ..., kind: _Optional[str] = ..., target_skill_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., when_to_use: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., requires_context: _Optional[_Iterable[str]] = ..., suggested_scope: _Optional[str] = ..., suggested_always_active: _Optional[bool] = ..., rationale: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("organization_id", "draft_id", "name", "display_name", "description", "content", "when_to_use", "requires_tools", "requires_context", "suggested_scope", "suggested_always_active", "change_summary")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DRAFT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    WHEN_TO_USE_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_TOOLS_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_SCOPE_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_ALWAYS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    draft_id: str
    name: str
    display_name: str
    description: str
    content: str
    when_to_use: str
    requires_tools: _containers.RepeatedScalarFieldContainer[str]
    requires_context: _containers.RepeatedScalarFieldContainer[str]
    suggested_scope: str
    suggested_always_active: bool
    change_summary: str
    def __init__(self, organization_id: _Optional[str] = ..., draft_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., when_to_use: _Optional[str] = ..., requires_tools: _Optional[_Iterable[str]] = ..., requires_context: _Optional[_Iterable[str]] = ..., suggested_scope: _Optional[str] = ..., suggested_always_active: _Optional[bool] = ..., change_summary: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("skill_id", "display_name", "origin", "injected_count", "viewed_count", "invoked_count")
    SKILL_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    INJECTED_COUNT_FIELD_NUMBER: _ClassVar[int]
    VIEWED_COUNT_FIELD_NUMBER: _ClassVar[int]
    INVOKED_COUNT_FIELD_NUMBER: _ClassVar[int]
    skill_id: str
    display_name: str
    origin: str
    injected_count: int
    viewed_count: int
    invoked_count: int
    def __init__(self, skill_id: _Optional[str] = ..., display_name: _Optional[str] = ..., origin: _Optional[str] = ..., injected_count: _Optional[int] = ..., viewed_count: _Optional[int] = ..., invoked_count: _Optional[int] = ...) -> None: ...

class GetSkillMetricsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetSkillMetricsResponse(_message.Message):
    __slots__ = ("metrics", "positive_feedback_count", "negative_feedback_count", "pending_agent_drafts")
    METRICS_FIELD_NUMBER: _ClassVar[int]
    POSITIVE_FEEDBACK_COUNT_FIELD_NUMBER: _ClassVar[int]
    NEGATIVE_FEEDBACK_COUNT_FIELD_NUMBER: _ClassVar[int]
    PENDING_AGENT_DRAFTS_FIELD_NUMBER: _ClassVar[int]
    metrics: _containers.RepeatedCompositeFieldContainer[SkillMetric]
    positive_feedback_count: int
    negative_feedback_count: int
    pending_agent_drafts: int
    def __init__(self, metrics: _Optional[_Iterable[_Union[SkillMetric, _Mapping]]] = ..., positive_feedback_count: _Optional[int] = ..., negative_feedback_count: _Optional[int] = ..., pending_agent_drafts: _Optional[int] = ...) -> None: ...
