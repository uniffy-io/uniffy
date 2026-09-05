import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RuleSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RULE_SOURCE_UNSPECIFIED: _ClassVar[RuleSource]
    RULE_SOURCE_BUNDLED: _ClassVar[RuleSource]
    RULE_SOURCE_ORGANIZATION: _ClassVar[RuleSource]

class RuleStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RULE_STATUS_UNSPECIFIED: _ClassVar[RuleStatus]
    RULE_STATUS_ACTIVE: _ClassVar[RuleStatus]
    RULE_STATUS_RETIRED: _ClassVar[RuleStatus]
RULE_SOURCE_UNSPECIFIED: RuleSource
RULE_SOURCE_BUNDLED: RuleSource
RULE_SOURCE_ORGANIZATION: RuleSource
RULE_STATUS_UNSPECIFIED: RuleStatus
RULE_STATUS_ACTIVE: RuleStatus
RULE_STATUS_RETIRED: RuleStatus

class RuleInfo(_message.Message):
    __slots__ = ("id", "organization_id", "source", "name", "display_name", "description", "content", "status", "latest_version_number", "active_version_id", "active_version_pinned", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    LATEST_VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_VERSION_PINNED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    source: RuleSource
    name: str
    display_name: str
    description: str
    content: str
    status: RuleStatus
    latest_version_number: int
    active_version_id: str
    active_version_pinned: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., source: _Optional[_Union[RuleSource, str]] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., status: _Optional[_Union[RuleStatus, str]] = ..., latest_version_number: _Optional[int] = ..., active_version_id: _Optional[str] = ..., active_version_pinned: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RuleVersion(_message.Message):
    __slots__ = ("id", "rule_id", "version_number", "name", "display_name", "description", "content", "author_id", "change_summary", "parent_version_id", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_ID_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    PARENT_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    rule_id: str
    version_number: int
    name: str
    display_name: str
    description: str
    content: str
    author_id: str
    change_summary: str
    parent_version_id: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., rule_id: _Optional[str] = ..., version_number: _Optional[int] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., author_id: _Optional[str] = ..., change_summary: _Optional[str] = ..., parent_version_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreateRuleRequest(_message.Message):
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

class CreateRuleResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class GetRuleRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ...) -> None: ...

class GetRuleResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class ListRulesRequest(_message.Message):
    __slots__ = ("organization_id", "page_size", "page_token", "include_retired")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_RETIRED_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    page_size: int
    page_token: str
    include_retired: bool
    def __init__(self, organization_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., include_retired: _Optional[bool] = ...) -> None: ...

class ListRulesResponse(_message.Message):
    __slots__ = ("rules", "next_page_token")
    RULES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    rules: _containers.RepeatedCompositeFieldContainer[RuleInfo]
    next_page_token: str
    def __init__(self, rules: _Optional[_Iterable[_Union[RuleInfo, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class UpdateRuleRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id", "display_name", "description", "content", "change_summary")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    display_name: str
    description: str
    content: str
    change_summary: str
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., content: _Optional[str] = ..., change_summary: _Optional[str] = ...) -> None: ...

class UpdateRuleResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class RetireRuleRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ...) -> None: ...

class RetireRuleResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class RestoreRuleRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ...) -> None: ...

class RestoreRuleResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class ListRuleVersionsRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id", "page_size", "page_token")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    page_size: int
    page_token: str
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListRuleVersionsResponse(_message.Message):
    __slots__ = ("versions", "next_page_token")
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    versions: _containers.RepeatedCompositeFieldContainer[RuleVersion]
    next_page_token: str
    def __init__(self, versions: _Optional[_Iterable[_Union[RuleVersion, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class GetRuleVersionRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id", "version_number")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    version_number: int
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ..., version_number: _Optional[int] = ...) -> None: ...

class GetRuleVersionResponse(_message.Message):
    __slots__ = ("version",)
    VERSION_FIELD_NUMBER: _ClassVar[int]
    version: RuleVersion
    def __init__(self, version: _Optional[_Union[RuleVersion, _Mapping]] = ...) -> None: ...

class SetMainRuleVersionRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id", "version_number", "follow_latest")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    FOLLOW_LATEST_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    version_number: int
    follow_latest: bool
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ..., version_number: _Optional[int] = ..., follow_latest: _Optional[bool] = ...) -> None: ...

class SetMainRuleVersionResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class RevertRuleRequest(_message.Message):
    __slots__ = ("organization_id", "rule_id", "version_number")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_ID_FIELD_NUMBER: _ClassVar[int]
    VERSION_NUMBER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    rule_id: str
    version_number: int
    def __init__(self, organization_id: _Optional[str] = ..., rule_id: _Optional[str] = ..., version_number: _Optional[int] = ...) -> None: ...

class RevertRuleResponse(_message.Message):
    __slots__ = ("rule",)
    RULE_FIELD_NUMBER: _ClassVar[int]
    rule: RuleInfo
    def __init__(self, rule: _Optional[_Union[RuleInfo, _Mapping]] = ...) -> None: ...

class GetEnabledRulesRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ...) -> None: ...

class GetEnabledRulesResponse(_message.Message):
    __slots__ = ("rule_ids",)
    RULE_IDS_FIELD_NUMBER: _ClassVar[int]
    rule_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, rule_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SetEnabledRulesRequest(_message.Message):
    __slots__ = ("organization_id", "agent_id", "rule_ids")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    RULE_IDS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    agent_id: str
    rule_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, organization_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., rule_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SetEnabledRulesResponse(_message.Message):
    __slots__ = ("rule_ids",)
    RULE_IDS_FIELD_NUMBER: _ClassVar[int]
    rule_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, rule_ids: _Optional[_Iterable[str]] = ...) -> None: ...
