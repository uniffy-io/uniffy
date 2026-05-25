import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlatformOrganizationSummary(_message.Message):
    __slots__ = ("id", "name", "slug", "plan", "member_count", "mail_config_source", "encryption_version", "last_activity_at", "last_login_at", "is_suspended", "deleted_at", "purge_at", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    PLAN_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    MAIL_CONFIG_SOURCE_FIELD_NUMBER: _ClassVar[int]
    ENCRYPTION_VERSION_FIELD_NUMBER: _ClassVar[int]
    LAST_ACTIVITY_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_LOGIN_AT_FIELD_NUMBER: _ClassVar[int]
    IS_SUSPENDED_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    PURGE_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    slug: str
    plan: str
    member_count: int
    mail_config_source: str
    encryption_version: int
    last_activity_at: _timestamp_pb2.Timestamp
    last_login_at: _timestamp_pb2.Timestamp
    is_suspended: bool
    deleted_at: _timestamp_pb2.Timestamp
    purge_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., plan: _Optional[str] = ..., member_count: _Optional[int] = ..., mail_config_source: _Optional[str] = ..., encryption_version: _Optional[int] = ..., last_activity_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_login_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_suspended: _Optional[bool] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., purge_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PlatformOrganizationDetail(_message.Message):
    __slots__ = ("summary", "domain", "logo_url", "owners", "suspension_reason", "deletion_reason")
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    OWNERS_FIELD_NUMBER: _ClassVar[int]
    SUSPENSION_REASON_FIELD_NUMBER: _ClassVar[int]
    DELETION_REASON_FIELD_NUMBER: _ClassVar[int]
    summary: PlatformOrganizationSummary
    domain: str
    logo_url: str
    owners: _containers.RepeatedCompositeFieldContainer[PlatformOrgOwner]
    suspension_reason: str
    deletion_reason: str
    def __init__(self, summary: _Optional[_Union[PlatformOrganizationSummary, _Mapping]] = ..., domain: _Optional[str] = ..., logo_url: _Optional[str] = ..., owners: _Optional[_Iterable[_Union[PlatformOrgOwner, _Mapping]]] = ..., suspension_reason: _Optional[str] = ..., deletion_reason: _Optional[str] = ...) -> None: ...

class PlatformOrgOwner(_message.Message):
    __slots__ = ("user_id", "email", "full_name", "joined_at")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    full_name: str
    joined_at: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., full_name: _Optional[str] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PlatformUserSummary(_message.Message):
    __slots__ = ("id", "email", "username", "full_name", "is_active", "is_system_admin", "email_verified", "mfa_enabled", "org_memberships_count", "last_login_at", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    EMAIL_VERIFIED_FIELD_NUMBER: _ClassVar[int]
    MFA_ENABLED_FIELD_NUMBER: _ClassVar[int]
    ORG_MEMBERSHIPS_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_LOGIN_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    username: str
    full_name: str
    is_active: bool
    is_system_admin: bool
    email_verified: bool
    mfa_enabled: bool
    org_memberships_count: int
    last_login_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., username: _Optional[str] = ..., full_name: _Optional[str] = ..., is_active: _Optional[bool] = ..., is_system_admin: _Optional[bool] = ..., email_verified: _Optional[bool] = ..., mfa_enabled: _Optional[bool] = ..., org_memberships_count: _Optional[int] = ..., last_login_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PlatformUserDetail(_message.Message):
    __slots__ = ("summary", "memberships")
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    MEMBERSHIPS_FIELD_NUMBER: _ClassVar[int]
    summary: PlatformUserSummary
    memberships: _containers.RepeatedCompositeFieldContainer[PlatformUserMembership]
    def __init__(self, summary: _Optional[_Union[PlatformUserSummary, _Mapping]] = ..., memberships: _Optional[_Iterable[_Union[PlatformUserMembership, _Mapping]]] = ...) -> None: ...

class PlatformUserMembership(_message.Message):
    __slots__ = ("organization_id", "organization_name", "organization_slug", "role", "joined_at", "is_active", "is_suspended", "deleted_at")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_SLUG_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    IS_SUSPENDED_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    organization_name: str
    organization_slug: str
    role: str
    joined_at: _timestamp_pb2.Timestamp
    is_active: bool
    is_suspended: bool
    deleted_at: _timestamp_pb2.Timestamp
    def __init__(self, organization_id: _Optional[str] = ..., organization_name: _Optional[str] = ..., organization_slug: _Optional[str] = ..., role: _Optional[str] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_active: _Optional[bool] = ..., is_suspended: _Optional[bool] = ..., deleted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListOrganizationsRequest(_message.Message):
    __slots__ = ("page", "page_size", "search", "include_deleted", "only_suspended")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_DELETED_FIELD_NUMBER: _ClassVar[int]
    ONLY_SUSPENDED_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    search: str
    include_deleted: bool
    only_suspended: bool
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., search: _Optional[str] = ..., include_deleted: _Optional[bool] = ..., only_suspended: _Optional[bool] = ...) -> None: ...

class ListOrganizationsResponse(_message.Message):
    __slots__ = ("organizations", "total_count", "page", "page_size")
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    organizations: _containers.RepeatedCompositeFieldContainer[PlatformOrganizationSummary]
    total_count: int
    page: int
    page_size: int
    def __init__(self, organizations: _Optional[_Iterable[_Union[PlatformOrganizationSummary, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class GetOrganizationRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: PlatformOrganizationDetail
    def __init__(self, organization: _Optional[_Union[PlatformOrganizationDetail, _Mapping]] = ...) -> None: ...

class SuspendOrganizationRequest(_message.Message):
    __slots__ = ("organization_id", "reason")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    reason: str
    def __init__(self, organization_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class SuspendOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: PlatformOrganizationDetail
    def __init__(self, organization: _Optional[_Union[PlatformOrganizationDetail, _Mapping]] = ...) -> None: ...

class UnsuspendOrganizationRequest(_message.Message):
    __slots__ = ("organization_id", "reason")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    reason: str
    def __init__(self, organization_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class UnsuspendOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: PlatformOrganizationDetail
    def __init__(self, organization: _Optional[_Union[PlatformOrganizationDetail, _Mapping]] = ...) -> None: ...

class DeleteOrganizationRequest(_message.Message):
    __slots__ = ("organization_id", "confirm_slug", "reason")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONFIRM_SLUG_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    confirm_slug: str
    reason: str
    def __init__(self, organization_id: _Optional[str] = ..., confirm_slug: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class DeleteOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: PlatformOrganizationDetail
    def __init__(self, organization: _Optional[_Union[PlatformOrganizationDetail, _Mapping]] = ...) -> None: ...

class RestoreOrganizationRequest(_message.Message):
    __slots__ = ("organization_id", "reason")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    reason: str
    def __init__(self, organization_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RestoreOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: PlatformOrganizationDetail
    def __init__(self, organization: _Optional[_Union[PlatformOrganizationDetail, _Mapping]] = ...) -> None: ...

class ListUsersRequest(_message.Message):
    __slots__ = ("page", "page_size", "search", "include_inactive", "only_system_admins")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    ONLY_SYSTEM_ADMINS_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    search: str
    include_inactive: bool
    only_system_admins: bool
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., search: _Optional[str] = ..., include_inactive: _Optional[bool] = ..., only_system_admins: _Optional[bool] = ...) -> None: ...

class ListUsersResponse(_message.Message):
    __slots__ = ("users", "total_count", "page", "page_size")
    USERS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    users: _containers.RepeatedCompositeFieldContainer[PlatformUserSummary]
    total_count: int
    page: int
    page_size: int
    def __init__(self, users: _Optional[_Iterable[_Union[PlatformUserSummary, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class GetUserRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class GetUserResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: PlatformUserDetail
    def __init__(self, user: _Optional[_Union[PlatformUserDetail, _Mapping]] = ...) -> None: ...

class ForceLogoutUserRequest(_message.Message):
    __slots__ = ("user_id", "reason")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    reason: str
    def __init__(self, user_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ForceLogoutUserResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SetSystemAdminRequest(_message.Message):
    __slots__ = ("user_id", "is_system_admin", "reason")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    IS_SYSTEM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    is_system_admin: bool
    reason: str
    def __init__(self, user_id: _Optional[str] = ..., is_system_admin: _Optional[bool] = ..., reason: _Optional[str] = ...) -> None: ...

class SetSystemAdminResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: PlatformUserDetail
    def __init__(self, user: _Optional[_Union[PlatformUserDetail, _Mapping]] = ...) -> None: ...
