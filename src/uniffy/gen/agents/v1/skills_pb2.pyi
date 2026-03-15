import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from common.v1 import common_pb2 as _common_pb2
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
    __slots__ = ("id", "organization_id", "name", "display_name", "description", "content", "source", "always_active", "created_at", "updated_at", "owner_id")
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
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., source: _Optional[_Union[SkillSource, str]] = ..., always_active: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., owner_id: _Optional[str] = ...) -> None: ...

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

class SkillResponse(_message.Message):
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
