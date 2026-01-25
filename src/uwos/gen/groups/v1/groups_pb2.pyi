from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ListGroupsRequest(_message.Message):
    __slots__ = ("organization_id", "pagination", "search", "include_private")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    search: str
    include_private: bool
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., search: _Optional[str] = ..., include_private: _Optional[bool] = ...) -> None: ...

class ListGroupsResponse(_message.Message):
    __slots__ = ("groups", "pagination")
    GROUPS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    groups: _containers.RepeatedCompositeFieldContainer[_common_pb2.GroupInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, groups: _Optional[_Iterable[_Union[_common_pb2.GroupInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class GetGroupRequest(_message.Message):
    __slots__ = ("organization_id", "group_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ...) -> None: ...

class CreateGroupRequest(_message.Message):
    __slots__ = ("organization_id", "name", "description", "is_private", "is_default")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    description: str
    is_private: bool
    is_default: bool
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., is_default: _Optional[bool] = ...) -> None: ...

class UpdateGroupRequest(_message.Message):
    __slots__ = ("organization_id", "group_id", "name", "description", "is_private", "is_default")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    name: str
    description: str
    is_private: bool
    is_default: bool
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., is_default: _Optional[bool] = ...) -> None: ...

class DeleteGroupRequest(_message.Message):
    __slots__ = ("organization_id", "group_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ...) -> None: ...

class DeleteGroupResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListGroupMembersRequest(_message.Message):
    __slots__ = ("organization_id", "group_id", "pagination", "role_filter")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    ROLE_FILTER_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    pagination: _common_pb2.PaginationRequest
    role_filter: _common_pb2.GroupRole
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., role_filter: _Optional[_Union[_common_pb2.GroupRole, str]] = ...) -> None: ...

class ListGroupMembersResponse(_message.Message):
    __slots__ = ("members", "pagination")
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[_common_pb2.GroupMemberInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, members: _Optional[_Iterable[_Union[_common_pb2.GroupMemberInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class AddGroupMemberRequest(_message.Message):
    __slots__ = ("organization_id", "group_id", "user_id", "role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    user_id: str
    role: _common_pb2.GroupRole
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.GroupRole, str]] = ...) -> None: ...

class UpdateGroupMemberRequest(_message.Message):
    __slots__ = ("organization_id", "group_id", "user_id", "role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    user_id: str
    role: _common_pb2.GroupRole
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.GroupRole, str]] = ...) -> None: ...

class RemoveGroupMemberRequest(_message.Message):
    __slots__ = ("organization_id", "group_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RemoveGroupMemberResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetUserGroupsRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetUserGroupsResponse(_message.Message):
    __slots__ = ("groups",)
    GROUPS_FIELD_NUMBER: _ClassVar[int]
    groups: _containers.RepeatedCompositeFieldContainer[_common_pb2.GroupInfo]
    def __init__(self, groups: _Optional[_Iterable[_Union[_common_pb2.GroupInfo, _Mapping]]] = ...) -> None: ...
