import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GrantPermissionRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id", "subject_type", "subject_id", "level", "expires_at")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_ID_FIELD_NUMBER: _ClassVar[int]
    LEVEL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    subject_type: _common_pb2.SubjectType
    subject_id: str
    level: _common_pb2.PermissionLevel
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject_id: _Optional[str] = ..., level: _Optional[_Union[_common_pb2.PermissionLevel, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class RevokePermissionRequest(_message.Message):
    __slots__ = ("organization_id", "permission_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMISSION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    permission_id: str
    def __init__(self, organization_id: _Optional[str] = ..., permission_id: _Optional[str] = ...) -> None: ...

class UpdatePermissionRequest(_message.Message):
    __slots__ = ("organization_id", "permission_id", "level", "expires_at", "clear_expiration")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PERMISSION_ID_FIELD_NUMBER: _ClassVar[int]
    LEVEL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    CLEAR_EXPIRATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    permission_id: str
    level: _common_pb2.PermissionLevel
    expires_at: _timestamp_pb2.Timestamp
    clear_expiration: bool
    def __init__(self, organization_id: _Optional[str] = ..., permission_id: _Optional[str] = ..., level: _Optional[_Union[_common_pb2.PermissionLevel, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., clear_expiration: _Optional[bool] = ...) -> None: ...

class ListContentPermissionsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ...) -> None: ...

class GetMyPermissionRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "content_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    content_id: str
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ...) -> None: ...

class SearchShareTargetsRequest(_message.Message):
    __slots__ = ("organization_id", "query", "limit", "include_users", "include_groups")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_USERS_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_GROUPS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    query: str
    limit: int
    include_users: bool
    include_groups: bool
    def __init__(self, organization_id: _Optional[str] = ..., query: _Optional[str] = ..., limit: _Optional[int] = ..., include_users: _Optional[bool] = ..., include_groups: _Optional[bool] = ...) -> None: ...

class RevokePermissionResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class PermissionListResponse(_message.Message):
    __slots__ = ("permissions", "owner")
    PERMISSIONS_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    permissions: _containers.RepeatedCompositeFieldContainer[PermissionInfo]
    owner: ShareTarget
    def __init__(self, permissions: _Optional[_Iterable[_Union[PermissionInfo, _Mapping]]] = ..., owner: _Optional[_Union[ShareTarget, _Mapping]] = ...) -> None: ...

class ShareTargetsResponse(_message.Message):
    __slots__ = ("targets",)
    TARGETS_FIELD_NUMBER: _ClassVar[int]
    targets: _containers.RepeatedCompositeFieldContainer[ShareTarget]
    def __init__(self, targets: _Optional[_Iterable[_Union[ShareTarget, _Mapping]]] = ...) -> None: ...

class PermissionInfo(_message.Message):
    __slots__ = ("id", "content_type", "content_id", "subject_type", "subject", "level", "can_view", "can_edit", "can_delete", "can_share", "can_move", "granted_by", "granted_at", "expires_at", "is_owner")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    LEVEL_FIELD_NUMBER: _ClassVar[int]
    CAN_VIEW_FIELD_NUMBER: _ClassVar[int]
    CAN_EDIT_FIELD_NUMBER: _ClassVar[int]
    CAN_DELETE_FIELD_NUMBER: _ClassVar[int]
    CAN_SHARE_FIELD_NUMBER: _ClassVar[int]
    CAN_MOVE_FIELD_NUMBER: _ClassVar[int]
    GRANTED_BY_FIELD_NUMBER: _ClassVar[int]
    GRANTED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    IS_OWNER_FIELD_NUMBER: _ClassVar[int]
    id: str
    content_type: _common_pb2.ContentType
    content_id: str
    subject_type: _common_pb2.SubjectType
    subject: ShareTarget
    level: _common_pb2.PermissionLevel
    can_view: bool
    can_edit: bool
    can_delete: bool
    can_share: bool
    can_move: bool
    granted_by: ShareTarget
    granted_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    is_owner: bool
    def __init__(self, id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., content_id: _Optional[str] = ..., subject_type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., subject: _Optional[_Union[ShareTarget, _Mapping]] = ..., level: _Optional[_Union[_common_pb2.PermissionLevel, str]] = ..., can_view: _Optional[bool] = ..., can_edit: _Optional[bool] = ..., can_delete: _Optional[bool] = ..., can_share: _Optional[bool] = ..., can_move: _Optional[bool] = ..., granted_by: _Optional[_Union[ShareTarget, _Mapping]] = ..., granted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_owner: _Optional[bool] = ...) -> None: ...

class ShareTarget(_message.Message):
    __slots__ = ("id", "type", "name", "email", "avatar_url", "member_count")
    ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    id: str
    type: _common_pb2.SubjectType
    name: str
    email: str
    avatar_url: str
    member_count: int
    def __init__(self, id: _Optional[str] = ..., type: _Optional[_Union[_common_pb2.SubjectType, str]] = ..., name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., member_count: _Optional[int] = ...) -> None: ...
