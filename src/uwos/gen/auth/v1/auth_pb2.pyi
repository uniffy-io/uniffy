from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Empty(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListOrganizationUsersRequest(_message.Message):
    __slots__ = ()
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    page: int
    page_size: int
    query: str
    def __init__(self, organization_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., query: _Optional[str] = ...) -> None: ...

class OrganizationUserListResponse(_message.Message):
    __slots__ = ()
    USERS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    users: _containers.RepeatedCompositeFieldContainer[UserInfoResponse]
    total_count: int
    def __init__(self, users: _Optional[_Iterable[_Union[UserInfoResponse, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class GroupInfo(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    slug: str
    description: str
    is_private: bool
    is_default: bool
    created_at: str
    member_count: int
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., is_default: _Optional[bool] = ..., created_at: _Optional[str] = ..., member_count: _Optional[int] = ...) -> None: ...

class ListGroupsRequest(_message.Message):
    __slots__ = ()
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    page: int
    page_size: int
    query: str
    def __init__(self, organization_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., query: _Optional[str] = ...) -> None: ...

class GroupListResponse(_message.Message):
    __slots__ = ()
    GROUPS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    groups: _containers.RepeatedCompositeFieldContainer[GroupInfo]
    total_count: int
    def __init__(self, groups: _Optional[_Iterable[_Union[GroupInfo, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class CreateGroupRequest(_message.Message):
    __slots__ = ()
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    slug: str
    description: str
    is_private: bool
    is_default: bool
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., is_default: _Optional[bool] = ...) -> None: ...

class UpdateGroupRequest(_message.Message):
    __slots__ = ()
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    name: str
    description: str
    is_private: bool
    is_default: bool
    def __init__(self, group_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., is_default: _Optional[bool] = ...) -> None: ...

class DeleteGroupRequest(_message.Message):
    __slots__ = ()
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    def __init__(self, group_id: _Optional[str] = ...) -> None: ...

class ListGroupMembersRequest(_message.Message):
    __slots__ = ()
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    page: int
    page_size: int
    query: str
    def __init__(self, group_id: _Optional[str] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ..., query: _Optional[str] = ...) -> None: ...

class GroupMemberInfo(_message.Message):
    __slots__ = ()
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    username: str
    full_name: str
    role: str
    joined_at: str
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., username: _Optional[str] = ..., full_name: _Optional[str] = ..., role: _Optional[str] = ..., joined_at: _Optional[str] = ...) -> None: ...

class GroupMemberListResponse(_message.Message):
    __slots__ = ()
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[GroupMemberInfo]
    total_count: int
    def __init__(self, members: _Optional[_Iterable[_Union[GroupMemberInfo, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class AddGroupMemberRequest(_message.Message):
    __slots__ = ()
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    user_id: str
    role: str
    def __init__(self, group_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[str] = ...) -> None: ...

class RemoveGroupMemberRequest(_message.Message):
    __slots__ = ()
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    user_id: str
    def __init__(self, group_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RegisterRequest(_message.Message):
    __slots__ = ()
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    email: str
    username: str
    password: str
    full_name: str
    organization_slug: str
    def __init__(self, email: _Optional[str] = ..., username: _Optional[str] = ..., password: _Optional[str] = ..., full_name: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class LoginRequest(_message.Message):
    __slots__ = ()
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    email: str
    password: str
    organization_slug: str
    def __init__(self, email: _Optional[str] = ..., password: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class RefreshTokenRequest(_message.Message):
    __slots__ = ()
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    refresh_token: str
    organization_slug: str
    def __init__(self, refresh_token: _Optional[str] = ..., organization_slug: _Optional[str] = ...) -> None: ...

class GetCurrentUserRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class UpdateMyProfileRequest(_message.Message):
    __slots__ = ()
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    full_name: str
    accent_color: str
    def __init__(self, full_name: _Optional[str] = ..., accent_color: _Optional[str] = ...) -> None: ...

class ListMyOrganizationsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class OrganizationInfo(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    slug: str
    role: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., role: _Optional[str] = ...) -> None: ...

class OrganizationListResponse(_message.Message):
    __slots__ = ()
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    organizations: _containers.RepeatedCompositeFieldContainer[OrganizationInfo]
    def __init__(self, organizations: _Optional[_Iterable[_Union[OrganizationInfo, _Mapping]]] = ...) -> None: ...

class AuthResponse(_message.Message):
    __slots__ = ()
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    refresh_token: str
    token_type: str
    user_id: str
    organization_id: str
    def __init__(self, access_token: _Optional[str] = ..., refresh_token: _Optional[str] = ..., token_type: _Optional[str] = ..., user_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class UserInfoResponse(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    username: str
    full_name: str
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    accent_color: str
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., username: _Optional[str] = ..., full_name: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ..., accent_color: _Optional[str] = ...) -> None: ...

class ListAllOrganizationsRequest(_message.Message):
    __slots__ = ()
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    query: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., query: _Optional[str] = ...) -> None: ...

class AdminOrganizationInfo(_message.Message):
    __slots__ = ()
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    PLAN_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    slug: str
    domain: str
    plan: str
    is_active: bool
    created_at: str
    member_count: int
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., domain: _Optional[str] = ..., plan: _Optional[str] = ..., is_active: _Optional[bool] = ..., created_at: _Optional[str] = ..., member_count: _Optional[int] = ...) -> None: ...

class AdminOrganizationListResponse(_message.Message):
    __slots__ = ()
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    organizations: _containers.RepeatedCompositeFieldContainer[AdminOrganizationInfo]
    total_count: int
    def __init__(self, organizations: _Optional[_Iterable[_Union[AdminOrganizationInfo, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class AdminCreateOrganizationRequest(_message.Message):
    __slots__ = ()
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    PLAN_FIELD_NUMBER: _ClassVar[int]
    name: str
    slug: str
    domain: str
    plan: str
    def __init__(self, name: _Optional[str] = ..., slug: _Optional[str] = ..., domain: _Optional[str] = ..., plan: _Optional[str] = ...) -> None: ...

class UpdateOrganizationRequest(_message.Message):
    __slots__ = ()
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    PLAN_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    domain: str
    plan: str
    is_active: bool
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., domain: _Optional[str] = ..., plan: _Optional[str] = ..., is_active: _Optional[bool] = ...) -> None: ...

class ListAllUsersRequest(_message.Message):
    __slots__ = ()
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    query: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., query: _Optional[str] = ...) -> None: ...

class AdminUserListResponse(_message.Message):
    __slots__ = ()
    USERS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    users: _containers.RepeatedCompositeFieldContainer[UserInfoResponse]
    total_count: int
    def __init__(self, users: _Optional[_Iterable[_Union[UserInfoResponse, _Mapping]]] = ..., total_count: _Optional[int] = ...) -> None: ...

class AdminCreateUserRequest(_message.Message):
    __slots__ = ()
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ROLE_FIELD_NUMBER: _ClassVar[int]
    email: str
    username: str
    password: str
    full_name: str
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    organization_id: str
    organization_role: str
    def __init__(self, email: _Optional[str] = ..., username: _Optional[str] = ..., password: _Optional[str] = ..., full_name: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ..., organization_id: _Optional[str] = ..., organization_role: _Optional[str] = ...) -> None: ...

class UpdateUserRequest(_message.Message):
    __slots__ = ()
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    ACCENT_COLOR_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    full_name: str
    username: str
    email: str
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    accent_color: str
    def __init__(self, user_id: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., email: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ..., accent_color: _Optional[str] = ...) -> None: ...

class AdminListUserOrganizationsRequest(_message.Message):
    __slots__ = ()
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class AdminUserOrganizationInfo(_message.Message):
    __slots__ = ()
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    slug: str
    role: str
    is_active: bool
    joined_at: str
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., role: _Optional[str] = ..., is_active: _Optional[bool] = ..., joined_at: _Optional[str] = ...) -> None: ...

class AdminUserOrganizationListResponse(_message.Message):
    __slots__ = ()
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    organizations: _containers.RepeatedCompositeFieldContainer[AdminUserOrganizationInfo]
    def __init__(self, organizations: _Optional[_Iterable[_Union[AdminUserOrganizationInfo, _Mapping]]] = ...) -> None: ...

class AdminAddUserToOrganizationRequest(_message.Message):
    __slots__ = ()
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    organization_id: str
    role: str
    def __init__(self, user_id: _Optional[str] = ..., organization_id: _Optional[str] = ..., role: _Optional[str] = ...) -> None: ...

class AdminRemoveUserFromOrganizationRequest(_message.Message):
    __slots__ = ()
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    organization_id: str
    def __init__(self, user_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...
