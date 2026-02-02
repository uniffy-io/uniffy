import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ContentType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CONTENT_TYPE_UNSPECIFIED: _ClassVar[ContentType]
    CONTENT_TYPE_NOTE: _ClassVar[ContentType]
    CONTENT_TYPE_FILE: _ClassVar[ContentType]
    CONTENT_TYPE_CALENDAR_EVENT: _ClassVar[ContentType]
    CONTENT_TYPE_CHAT_MESSAGE: _ClassVar[ContentType]
    CONTENT_TYPE_USER: _ClassVar[ContentType]
    CONTENT_TYPE_FOLDER: _ClassVar[ContentType]

class SubjectType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUBJECT_TYPE_UNSPECIFIED: _ClassVar[SubjectType]
    SUBJECT_TYPE_USER: _ClassVar[SubjectType]
    SUBJECT_TYPE_GROUP: _ClassVar[SubjectType]
    SUBJECT_TYPE_ORGANIZATION: _ClassVar[SubjectType]

class PermissionLevel(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PERMISSION_LEVEL_UNSPECIFIED: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_VIEW: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_EDIT: _ClassVar[PermissionLevel]
    PERMISSION_LEVEL_ADMIN: _ClassVar[PermissionLevel]

class VisibilityScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VISIBILITY_SCOPE_UNSPECIFIED: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_PRIVATE: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_GROUP: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_ORGANIZATION: _ClassVar[VisibilityScope]
    VISIBILITY_SCOPE_PUBLIC: _ClassVar[VisibilityScope]

class OrganizationRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ORGANIZATION_ROLE_UNSPECIFIED: _ClassVar[OrganizationRole]
    ORGANIZATION_ROLE_MEMBER: _ClassVar[OrganizationRole]
    ORGANIZATION_ROLE_ADMIN: _ClassVar[OrganizationRole]
    ORGANIZATION_ROLE_OWNER: _ClassVar[OrganizationRole]

class GroupRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    GROUP_ROLE_UNSPECIFIED: _ClassVar[GroupRole]
    GROUP_ROLE_MEMBER: _ClassVar[GroupRole]
    GROUP_ROLE_ADMIN: _ClassVar[GroupRole]
CONTENT_TYPE_UNSPECIFIED: ContentType
CONTENT_TYPE_NOTE: ContentType
CONTENT_TYPE_FILE: ContentType
CONTENT_TYPE_CALENDAR_EVENT: ContentType
CONTENT_TYPE_CHAT_MESSAGE: ContentType
CONTENT_TYPE_USER: ContentType
CONTENT_TYPE_FOLDER: ContentType
SUBJECT_TYPE_UNSPECIFIED: SubjectType
SUBJECT_TYPE_USER: SubjectType
SUBJECT_TYPE_GROUP: SubjectType
SUBJECT_TYPE_ORGANIZATION: SubjectType
PERMISSION_LEVEL_UNSPECIFIED: PermissionLevel
PERMISSION_LEVEL_VIEW: PermissionLevel
PERMISSION_LEVEL_EDIT: PermissionLevel
PERMISSION_LEVEL_ADMIN: PermissionLevel
VISIBILITY_SCOPE_UNSPECIFIED: VisibilityScope
VISIBILITY_SCOPE_PRIVATE: VisibilityScope
VISIBILITY_SCOPE_GROUP: VisibilityScope
VISIBILITY_SCOPE_ORGANIZATION: VisibilityScope
VISIBILITY_SCOPE_PUBLIC: VisibilityScope
ORGANIZATION_ROLE_UNSPECIFIED: OrganizationRole
ORGANIZATION_ROLE_MEMBER: OrganizationRole
ORGANIZATION_ROLE_ADMIN: OrganizationRole
ORGANIZATION_ROLE_OWNER: OrganizationRole
GROUP_ROLE_UNSPECIFIED: GroupRole
GROUP_ROLE_MEMBER: GroupRole
GROUP_ROLE_ADMIN: GroupRole

class UserInfo(_message.Message):
    __slots__ = ("id", "email", "full_name", "username", "avatar_url", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    full_name: str
    username: str
    avatar_url: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., avatar_url: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class OrganizationInfo(_message.Message):
    __slots__ = ("id", "name", "slug", "logo_url", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    slug: str
    logo_url: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., logo_url: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GroupInfo(_message.Message):
    __slots__ = ("id", "organization_id", "name", "slug", "description", "is_private", "is_default", "member_count", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    slug: str
    description: str
    is_private: bool
    is_default: bool
    member_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., is_default: _Optional[bool] = ..., member_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class MemberInfo(_message.Message):
    __slots__ = ("user_id", "display_name", "email", "avatar_url", "role", "joined_at", "is_active")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    email: str
    avatar_url: str
    role: OrganizationRole
    joined_at: _timestamp_pb2.Timestamp
    is_active: bool
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., role: _Optional[_Union[OrganizationRole, str]] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_active: _Optional[bool] = ...) -> None: ...

class GroupMemberInfo(_message.Message):
    __slots__ = ("user_id", "display_name", "email", "avatar_url", "role", "joined_at")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    email: str
    avatar_url: str
    role: GroupRole
    joined_at: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., role: _Optional[_Union[GroupRole, str]] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PaginationRequest(_message.Message):
    __slots__ = ("page", "page_size")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class PaginationResponse(_message.Message):
    __slots__ = ("page", "page_size", "total_count", "total_pages")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    total_count: int
    total_pages: int
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., total_count: _Optional[int] = ..., total_pages: _Optional[int] = ...) -> None: ...
