import datetime

from common.v1 import common_pb2 as _common_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class UserProfile(_message.Message):
    __slots__ = ("id", "email", "full_name", "username", "avatar_url", "accent_color", "font_family", "is_active", "is_system_admin", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    FONT_FAMILY_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    full_name: str
    username: str
    avatar_url: str
    accent_color: str
    font_family: str
    is_active: bool
    is_system_admin: bool
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., avatar_url: _Optional[str] = ..., accent_color: _Optional[str] = ..., font_family: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetMyProfileRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class UpdateMyProfileRequest(_message.Message):
    __slots__ = ("full_name", "username", "avatar_url", "accent_color", "font_family")
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    FONT_FAMILY_FIELD_NUMBER: _ClassVar[int]
    full_name: str
    username: str
    avatar_url: str
    accent_color: str
    font_family: str
    def __init__(self, full_name: _Optional[str] = ..., username: _Optional[str] = ..., avatar_url: _Optional[str] = ..., accent_color: _Optional[str] = ..., font_family: _Optional[str] = ...) -> None: ...

class ListUsersRequest(_message.Message):
    __slots__ = ("pagination", "search", "include_inactive")
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    pagination: _common_pb2.PaginationRequest
    search: str
    include_inactive: bool
    def __init__(self, pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., search: _Optional[str] = ..., include_inactive: _Optional[bool] = ...) -> None: ...

class ListUsersResponse(_message.Message):
    __slots__ = ("users", "pagination")
    USERS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    users: _containers.RepeatedCompositeFieldContainer[UserProfile]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, users: _Optional[_Iterable[_Union[UserProfile, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class GetUserRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class CreateUserRequest(_message.Message):
    __slots__ = ("email", "password", "full_name", "username", "is_system_admin")
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    email: str
    password: str
    full_name: str
    username: str
    is_system_admin: bool
    def __init__(self, email: _Optional[str] = ..., password: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., is_system_admin: _Optional[bool] = ...) -> None: ...

class UpdateUserRequest(_message.Message):
    __slots__ = ("user_id", "email", "full_name", "username", "is_active", "is_system_admin", "password")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    full_name: str
    username: str
    is_active: bool
    is_system_admin: bool
    password: str
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., password: _Optional[str] = ...) -> None: ...

class DeleteUserRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class DeleteUserResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListUserOrganizationsRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class ListUserOrganizationsResponse(_message.Message):
    __slots__ = ("memberships",)
    MEMBERSHIPS_FIELD_NUMBER: _ClassVar[int]
    memberships: _containers.RepeatedCompositeFieldContainer[UserOrganizationMembership]
    def __init__(self, memberships: _Optional[_Iterable[_Union[UserOrganizationMembership, _Mapping]]] = ...) -> None: ...

class UserOrganizationMembership(_message.Message):
    __slots__ = ("organization", "role", "joined_at", "is_active")
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization: _common_pb2.OrganizationInfo
    role: _common_pb2.OrganizationRole
    joined_at: _timestamp_pb2.Timestamp
    is_active: bool
    def __init__(self, organization: _Optional[_Union[_common_pb2.OrganizationInfo, _Mapping]] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_active: _Optional[bool] = ...) -> None: ...

class AddUserToOrganizationRequest(_message.Message):
    __slots__ = ("user_id", "organization_id", "role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    organization_id: str
    role: _common_pb2.OrganizationRole
    def __init__(self, user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ...) -> None: ...

class RemoveUserFromOrganizationRequest(_message.Message):
    __slots__ = ("user_id", "organization_id")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    organization_id: str
    def __init__(self, user_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class RemoveUserFromOrganizationResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class UploadAvatarRequest(_message.Message):
    __slots__ = ("image_data", "filename")
    IMAGE_DATA_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    image_data: bytes
    filename: str
    def __init__(self, image_data: _Optional[bytes] = ..., filename: _Optional[str] = ...) -> None: ...

class DeleteAvatarRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...
