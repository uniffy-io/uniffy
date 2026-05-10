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

class PromptSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PROMPT_SOURCE_UNSPECIFIED: _ClassVar[PromptSource]
    PROMPT_SOURCE_BUNDLED: _ClassVar[PromptSource]
    PROMPT_SOURCE_ORGANIZATION: _ClassVar[PromptSource]
    PROMPT_SOURCE_PERSONAL: _ClassVar[PromptSource]
PROMPT_SOURCE_UNSPECIFIED: PromptSource
PROMPT_SOURCE_BUNDLED: PromptSource
PROMPT_SOURCE_ORGANIZATION: PromptSource
PROMPT_SOURCE_PERSONAL: PromptSource

class PromptInfo(_message.Message):
    __slots__ = ("id", "organization_id", "name", "display_name", "description", "content", "source", "owner_id", "created_at", "updated_at", "access_mode", "created_by", "baseline_role")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    display_name: str
    description: str
    content: str
    source: PromptSource
    owner_id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    access_mode: _common_pb2.AccessMode
    created_by: str
    baseline_role: _common_pb2.ContentRole
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., source: _Optional[_Union[PromptSource, str]] = ..., owner_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., created_by: _Optional[str] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreatePromptRequest(_message.Message):
    __slots__ = ("organization_id", "name", "display_name", "description", "content", "owner_id", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    display_name: str
    description: str
    content: str
    owner_id: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., owner_id: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class CreatePromptResponse(_message.Message):
    __slots__ = ("prompt",)
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    prompt: PromptInfo
    def __init__(self, prompt: _Optional[_Union[PromptInfo, _Mapping]] = ...) -> None: ...

class GetPromptResponse(_message.Message):
    __slots__ = ("prompt",)
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    prompt: PromptInfo
    def __init__(self, prompt: _Optional[_Union[PromptInfo, _Mapping]] = ...) -> None: ...

class UpdatePromptResponse(_message.Message):
    __slots__ = ("prompt",)
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    prompt: PromptInfo
    def __init__(self, prompt: _Optional[_Union[PromptInfo, _Mapping]] = ...) -> None: ...

class GetPromptRequest(_message.Message):
    __slots__ = ("organization_id", "prompt_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    prompt_id: str
    def __init__(self, organization_id: _Optional[str] = ..., prompt_id: _Optional[str] = ...) -> None: ...

class ListPromptsRequest(_message.Message):
    __slots__ = ("organization_id", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListPromptsResponse(_message.Message):
    __slots__ = ("prompts", "pagination")
    PROMPTS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    prompts: _containers.RepeatedCompositeFieldContainer[PromptInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, prompts: _Optional[_Iterable[_Union[PromptInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class UpdatePromptRequest(_message.Message):
    __slots__ = ("organization_id", "prompt_id", "name", "display_name", "description", "content", "access_mode", "baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    prompt_id: str
    name: str
    display_name: str
    description: str
    content: str
    access_mode: _common_pb2.AccessMode
    baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., prompt_id: _Optional[str] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class DeletePromptRequest(_message.Message):
    __slots__ = ("organization_id", "prompt_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    prompt_id: str
    def __init__(self, organization_id: _Optional[str] = ..., prompt_id: _Optional[str] = ...) -> None: ...

class DeletePromptResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...
