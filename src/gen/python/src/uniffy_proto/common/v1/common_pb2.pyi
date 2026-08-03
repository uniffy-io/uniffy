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
    CONTENT_TYPE_PROJECT: _ClassVar[ContentType]
    CONTENT_TYPE_TASK: _ClassVar[ContentType]
    CONTENT_TYPE_AGENT: _ClassVar[ContentType]
    CONTENT_TYPE_PROVIDER_KEY: _ClassVar[ContentType]
    CONTENT_TYPE_CHAT: _ClassVar[ContentType]
    CONTENT_TYPE_ROOM: _ClassVar[ContentType]
    CONTENT_TYPE_AGENT_CRON_TASK: _ClassVar[ContentType]
    CONTENT_TYPE_AGENT_CHAT: _ClassVar[ContentType]
    CONTENT_TYPE_TAG: _ClassVar[ContentType]
    CONTENT_TYPE_AGENT_FOLDER: _ClassVar[ContentType]
    CONTENT_TYPE_TEAM: _ClassVar[ContentType]

class SubjectType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUBJECT_TYPE_UNSPECIFIED: _ClassVar[SubjectType]
    SUBJECT_TYPE_USER: _ClassVar[SubjectType]
    SUBJECT_TYPE_GROUP: _ClassVar[SubjectType]
    SUBJECT_TYPE_ORGANIZATION: _ClassVar[SubjectType]
    SUBJECT_TYPE_AGENT: _ClassVar[SubjectType]

class ContentRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CONTENT_ROLE_UNSPECIFIED: _ClassVar[ContentRole]
    CONTENT_ROLE_VIEWER: _ClassVar[ContentRole]
    CONTENT_ROLE_COMMENTER: _ClassVar[ContentRole]
    CONTENT_ROLE_EDITOR: _ClassVar[ContentRole]
    CONTENT_ROLE_ADMIN: _ClassVar[ContentRole]
    CONTENT_ROLE_OWNER: _ClassVar[ContentRole]
    CONTENT_ROLE_BLOCKED: _ClassVar[ContentRole]

class AccessMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ACCESS_MODE_UNSPECIFIED: _ClassVar[AccessMode]
    ACCESS_MODE_OWNER_ONLY: _ClassVar[AccessMode]
    ACCESS_MODE_EXPLICIT_MEMBERS: _ClassVar[AccessMode]
    ACCESS_MODE_OPEN_TO_ORG: _ClassVar[AccessMode]

class ContentMemberAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CONTENT_MEMBER_ACTION_UNSPECIFIED: _ClassVar[ContentMemberAction]
    CONTENT_MEMBER_ACTION_MEMBER_ADDED: _ClassVar[ContentMemberAction]
    CONTENT_MEMBER_ACTION_MEMBER_ROLE_CHANGED: _ClassVar[ContentMemberAction]
    CONTENT_MEMBER_ACTION_MEMBER_REMOVED: _ClassVar[ContentMemberAction]
    CONTENT_MEMBER_ACTION_ACCESS_MODE_CHANGED: _ClassVar[ContentMemberAction]
    CONTENT_MEMBER_ACTION_BASELINE_ROLE_CHANGED: _ClassVar[ContentMemberAction]
    CONTENT_MEMBER_ACTION_OWNERSHIP_TRANSFERRED: _ClassVar[ContentMemberAction]

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

class GroupKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    GROUP_KIND_UNSPECIFIED: _ClassVar[GroupKind]
    GROUP_KIND_TEAM: _ClassVar[GroupKind]
    GROUP_KIND_ACCESS: _ClassVar[GroupKind]

class DomainType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOMAIN_TYPE_UNSPECIFIED: _ClassVar[DomainType]
    DOMAIN_TYPE_CHAT: _ClassVar[DomainType]
    DOMAIN_TYPE_FILES: _ClassVar[DomainType]
    DOMAIN_TYPE_NOTES: _ClassVar[DomainType]
    DOMAIN_TYPE_CALENDAR: _ClassVar[DomainType]
    DOMAIN_TYPE_PROJECTS: _ClassVar[DomainType]
    DOMAIN_TYPE_AGENTS: _ClassVar[DomainType]

class RateLimitKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RATE_LIMIT_KIND_UNSPECIFIED: _ClassVar[RateLimitKind]
    RATE_LIMIT_KIND_AGENT_MSG_USER: _ClassVar[RateLimitKind]
    RATE_LIMIT_KIND_AGENT_MSG_ORG: _ClassVar[RateLimitKind]
    RATE_LIMIT_KIND_AGENT_MSG_AGENT: _ClassVar[RateLimitKind]
    RATE_LIMIT_KIND_IMAGE_GEN_USER: _ClassVar[RateLimitKind]
    RATE_LIMIT_KIND_IMAGE_GEN_ORG: _ClassVar[RateLimitKind]
CONTENT_TYPE_UNSPECIFIED: ContentType
CONTENT_TYPE_NOTE: ContentType
CONTENT_TYPE_FILE: ContentType
CONTENT_TYPE_CALENDAR_EVENT: ContentType
CONTENT_TYPE_CHAT_MESSAGE: ContentType
CONTENT_TYPE_USER: ContentType
CONTENT_TYPE_FOLDER: ContentType
CONTENT_TYPE_PROJECT: ContentType
CONTENT_TYPE_TASK: ContentType
CONTENT_TYPE_AGENT: ContentType
CONTENT_TYPE_PROVIDER_KEY: ContentType
CONTENT_TYPE_CHAT: ContentType
CONTENT_TYPE_ROOM: ContentType
CONTENT_TYPE_AGENT_CRON_TASK: ContentType
CONTENT_TYPE_AGENT_CHAT: ContentType
CONTENT_TYPE_TAG: ContentType
CONTENT_TYPE_AGENT_FOLDER: ContentType
CONTENT_TYPE_TEAM: ContentType
SUBJECT_TYPE_UNSPECIFIED: SubjectType
SUBJECT_TYPE_USER: SubjectType
SUBJECT_TYPE_GROUP: SubjectType
SUBJECT_TYPE_ORGANIZATION: SubjectType
SUBJECT_TYPE_AGENT: SubjectType
CONTENT_ROLE_UNSPECIFIED: ContentRole
CONTENT_ROLE_VIEWER: ContentRole
CONTENT_ROLE_COMMENTER: ContentRole
CONTENT_ROLE_EDITOR: ContentRole
CONTENT_ROLE_ADMIN: ContentRole
CONTENT_ROLE_OWNER: ContentRole
CONTENT_ROLE_BLOCKED: ContentRole
ACCESS_MODE_UNSPECIFIED: AccessMode
ACCESS_MODE_OWNER_ONLY: AccessMode
ACCESS_MODE_EXPLICIT_MEMBERS: AccessMode
ACCESS_MODE_OPEN_TO_ORG: AccessMode
CONTENT_MEMBER_ACTION_UNSPECIFIED: ContentMemberAction
CONTENT_MEMBER_ACTION_MEMBER_ADDED: ContentMemberAction
CONTENT_MEMBER_ACTION_MEMBER_ROLE_CHANGED: ContentMemberAction
CONTENT_MEMBER_ACTION_MEMBER_REMOVED: ContentMemberAction
CONTENT_MEMBER_ACTION_ACCESS_MODE_CHANGED: ContentMemberAction
CONTENT_MEMBER_ACTION_BASELINE_ROLE_CHANGED: ContentMemberAction
CONTENT_MEMBER_ACTION_OWNERSHIP_TRANSFERRED: ContentMemberAction
ORGANIZATION_ROLE_UNSPECIFIED: OrganizationRole
ORGANIZATION_ROLE_MEMBER: OrganizationRole
ORGANIZATION_ROLE_ADMIN: OrganizationRole
ORGANIZATION_ROLE_OWNER: OrganizationRole
GROUP_ROLE_UNSPECIFIED: GroupRole
GROUP_ROLE_MEMBER: GroupRole
GROUP_ROLE_ADMIN: GroupRole
GROUP_KIND_UNSPECIFIED: GroupKind
GROUP_KIND_TEAM: GroupKind
GROUP_KIND_ACCESS: GroupKind
DOMAIN_TYPE_UNSPECIFIED: DomainType
DOMAIN_TYPE_CHAT: DomainType
DOMAIN_TYPE_FILES: DomainType
DOMAIN_TYPE_NOTES: DomainType
DOMAIN_TYPE_CALENDAR: DomainType
DOMAIN_TYPE_PROJECTS: DomainType
DOMAIN_TYPE_AGENTS: DomainType
RATE_LIMIT_KIND_UNSPECIFIED: RateLimitKind
RATE_LIMIT_KIND_AGENT_MSG_USER: RateLimitKind
RATE_LIMIT_KIND_AGENT_MSG_ORG: RateLimitKind
RATE_LIMIT_KIND_AGENT_MSG_AGENT: RateLimitKind
RATE_LIMIT_KIND_IMAGE_GEN_USER: RateLimitKind
RATE_LIMIT_KIND_IMAGE_GEN_ORG: RateLimitKind

class UserInfo(_message.Message):
    __slots__ = ("id", "email", "full_name", "username", "avatar_url", "created_at", "has_avatar")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    HAS_AVATAR_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    full_name: str
    username: str
    avatar_url: str
    created_at: _timestamp_pb2.Timestamp
    has_avatar: bool
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., full_name: _Optional[str] = ..., username: _Optional[str] = ..., avatar_url: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., has_avatar: _Optional[bool] = ...) -> None: ...

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
    __slots__ = ("id", "organization_id", "name", "slug", "description", "is_private", "member_count", "created_at", "updated_at", "kind", "parent_group_id", "lead_user_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    PARENT_GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    LEAD_USER_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    name: str
    slug: str
    description: str
    is_private: bool
    member_count: int
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    kind: GroupKind
    parent_group_id: str
    lead_user_id: str
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., description: _Optional[str] = ..., is_private: _Optional[bool] = ..., member_count: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., kind: _Optional[_Union[GroupKind, str]] = ..., parent_group_id: _Optional[str] = ..., lead_user_id: _Optional[str] = ...) -> None: ...

class MemberInfo(_message.Message):
    __slots__ = ("user_id", "display_name", "email", "avatar_url", "role", "joined_at", "is_active", "has_avatar")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    HAS_AVATAR_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    email: str
    avatar_url: str
    role: OrganizationRole
    joined_at: _timestamp_pb2.Timestamp
    is_active: bool
    has_avatar: bool
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., role: _Optional[_Union[OrganizationRole, str]] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., is_active: _Optional[bool] = ..., has_avatar: _Optional[bool] = ...) -> None: ...

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

class DomainAdminInfo(_message.Message):
    __slots__ = ("id", "user_id", "display_name", "email", "avatar_url", "domain", "granted_by_user_id", "granted_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    GRANTED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    GRANTED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    user_id: str
    display_name: str
    email: str
    avatar_url: str
    domain: DomainType
    granted_by_user_id: str
    granted_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., email: _Optional[str] = ..., avatar_url: _Optional[str] = ..., domain: _Optional[_Union[DomainType, str]] = ..., granted_by_user_id: _Optional[str] = ..., granted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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
