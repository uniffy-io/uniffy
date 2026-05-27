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

class InvitationStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INVITATION_STATUS_UNSPECIFIED: _ClassVar[InvitationStatus]
    INVITATION_STATUS_PENDING: _ClassVar[InvitationStatus]
    INVITATION_STATUS_ACCEPTED: _ClassVar[InvitationStatus]
    INVITATION_STATUS_REVOKED: _ClassVar[InvitationStatus]
    INVITATION_STATUS_EXPIRED: _ClassVar[InvitationStatus]
INVITATION_STATUS_UNSPECIFIED: InvitationStatus
INVITATION_STATUS_PENDING: InvitationStatus
INVITATION_STATUS_ACCEPTED: InvitationStatus
INVITATION_STATUS_REVOKED: InvitationStatus
INVITATION_STATUS_EXPIRED: InvitationStatus

class ListMyOrganizationsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListMyOrganizationsResponse(_message.Message):
    __slots__ = ("organizations",)
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    organizations: _containers.RepeatedCompositeFieldContainer[MyOrganization]
    def __init__(self, organizations: _Optional[_Iterable[_Union[MyOrganization, _Mapping]]] = ...) -> None: ...

class MyOrganization(_message.Message):
    __slots__ = ("organization", "role", "joined_at")
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    JOINED_AT_FIELD_NUMBER: _ClassVar[int]
    organization: _common_pb2.OrganizationInfo
    role: _common_pb2.OrganizationRole
    joined_at: _timestamp_pb2.Timestamp
    def __init__(self, organization: _Optional[_Union[_common_pb2.OrganizationInfo, _Mapping]] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., joined_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListOrganizationsRequest(_message.Message):
    __slots__ = ("pagination", "search")
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    pagination: _common_pb2.PaginationRequest
    search: str
    def __init__(self, pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., search: _Optional[str] = ...) -> None: ...

class ListOrganizationsResponse(_message.Message):
    __slots__ = ("organizations", "pagination")
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organizations: _containers.RepeatedCompositeFieldContainer[OrganizationDetail]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, organizations: _Optional[_Iterable[_Union[OrganizationDetail, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class OrganizationDetail(_message.Message):
    __slots__ = ("organization", "member_count", "group_count", "is_active")
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    GROUP_COUNT_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization: _common_pb2.OrganizationInfo
    member_count: int
    group_count: int
    is_active: bool
    def __init__(self, organization: _Optional[_Union[_common_pb2.OrganizationInfo, _Mapping]] = ..., member_count: _Optional[int] = ..., group_count: _Optional[int] = ..., is_active: _Optional[bool] = ...) -> None: ...

class GetOrganizationRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: OrganizationDetail
    def __init__(self, organization: _Optional[_Union[OrganizationDetail, _Mapping]] = ...) -> None: ...

class CreateOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: _common_pb2.OrganizationInfo
    def __init__(self, organization: _Optional[_Union[_common_pb2.OrganizationInfo, _Mapping]] = ...) -> None: ...

class UpdateOrganizationResponse(_message.Message):
    __slots__ = ("organization",)
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    organization: _common_pb2.OrganizationInfo
    def __init__(self, organization: _Optional[_Union[_common_pb2.OrganizationInfo, _Mapping]] = ...) -> None: ...

class CreateOrganizationRequest(_message.Message):
    __slots__ = ("name", "slug", "logo_url", "owner_user_id")
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    OWNER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    name: str
    slug: str
    logo_url: str
    owner_user_id: str
    def __init__(self, name: _Optional[str] = ..., slug: _Optional[str] = ..., logo_url: _Optional[str] = ..., owner_user_id: _Optional[str] = ...) -> None: ...

class UpdateOrganizationRequest(_message.Message):
    __slots__ = ("organization_id", "name", "slug", "logo_url", "is_active")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    name: str
    slug: str
    logo_url: str
    is_active: bool
    def __init__(self, organization_id: _Optional[str] = ..., name: _Optional[str] = ..., slug: _Optional[str] = ..., logo_url: _Optional[str] = ..., is_active: _Optional[bool] = ...) -> None: ...

class DeleteOrganizationRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class DeleteOrganizationResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetOrganizationOverviewRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrganizationOverviewResponse(_message.Message):
    __slots__ = ("overview",)
    OVERVIEW_FIELD_NUMBER: _ClassVar[int]
    overview: OrganizationOverview
    def __init__(self, overview: _Optional[_Union[OrganizationOverview, _Mapping]] = ...) -> None: ...

class OrganizationOverview(_message.Message):
    __slots__ = ("organization", "member_count", "group_count", "content_counts")
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    MEMBER_COUNT_FIELD_NUMBER: _ClassVar[int]
    GROUP_COUNT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_COUNTS_FIELD_NUMBER: _ClassVar[int]
    organization: _common_pb2.OrganizationInfo
    member_count: int
    group_count: int
    content_counts: _containers.RepeatedCompositeFieldContainer[ContentTypeCount]
    def __init__(self, organization: _Optional[_Union[_common_pb2.OrganizationInfo, _Mapping]] = ..., member_count: _Optional[int] = ..., group_count: _Optional[int] = ..., content_counts: _Optional[_Iterable[_Union[ContentTypeCount, _Mapping]]] = ...) -> None: ...

class ContentTypeCount(_message.Message):
    __slots__ = ("content_type", "count")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    COUNT_FIELD_NUMBER: _ClassVar[int]
    content_type: _common_pb2.ContentType
    count: int
    def __init__(self, content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., count: _Optional[int] = ...) -> None: ...

class ListMembersRequest(_message.Message):
    __slots__ = ("organization_id", "pagination", "role_filter", "search", "include_inactive")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    ROLE_FILTER_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    role_filter: _common_pb2.OrganizationRole
    search: str
    include_inactive: bool
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., role_filter: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., search: _Optional[str] = ..., include_inactive: _Optional[bool] = ...) -> None: ...

class ListMembersResponse(_message.Message):
    __slots__ = ("members", "pagination")
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[_common_pb2.MemberInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, members: _Optional[_Iterable[_Union[_common_pb2.MemberInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class AddMemberRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    role: _common_pb2.OrganizationRole
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ...) -> None: ...

class AddMemberResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: _common_pb2.MemberInfo
    def __init__(self, member: _Optional[_Union[_common_pb2.MemberInfo, _Mapping]] = ...) -> None: ...

class UpdateMemberRoleRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    role: _common_pb2.OrganizationRole
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ...) -> None: ...

class UpdateMemberRoleResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: _common_pb2.MemberInfo
    def __init__(self, member: _Optional[_Union[_common_pb2.MemberInfo, _Mapping]] = ...) -> None: ...

class RemoveMemberRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RemoveMemberResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class GetPermissionDefaultsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetPermissionDefaultsResponse(_message.Message):
    __slots__ = ("defaults",)
    DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    defaults: _containers.RepeatedCompositeFieldContainer[ContentTypeDefaults]
    def __init__(self, defaults: _Optional[_Iterable[_Union[ContentTypeDefaults, _Mapping]]] = ...) -> None: ...

class UpdatePermissionDefaultsResponse(_message.Message):
    __slots__ = ("defaults",)
    DEFAULTS_FIELD_NUMBER: _ClassVar[int]
    defaults: ContentTypeDefaults
    def __init__(self, defaults: _Optional[_Union[ContentTypeDefaults, _Mapping]] = ...) -> None: ...

class UpdatePermissionDefaultsRequest(_message.Message):
    __slots__ = ("organization_id", "content_type", "default_access_mode", "default_baseline_role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    content_type: _common_pb2.ContentType
    default_access_mode: _common_pb2.AccessMode
    default_baseline_role: _common_pb2.ContentRole
    def __init__(self, organization_id: _Optional[str] = ..., content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., default_access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., default_baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class ContentTypeDefaults(_message.Message):
    __slots__ = ("content_type", "default_access_mode", "updated_at", "default_baseline_role")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_ACCESS_MODE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_BASELINE_ROLE_FIELD_NUMBER: _ClassVar[int]
    content_type: _common_pb2.ContentType
    default_access_mode: _common_pb2.AccessMode
    updated_at: _timestamp_pb2.Timestamp
    default_baseline_role: _common_pb2.ContentRole
    def __init__(self, content_type: _Optional[_Union[_common_pb2.ContentType, str]] = ..., default_access_mode: _Optional[_Union[_common_pb2.AccessMode, str]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., default_baseline_role: _Optional[_Union[_common_pb2.ContentRole, str]] = ...) -> None: ...

class OrganizationSettings(_message.Message):
    __slots__ = ("chat",)
    CHAT_FIELD_NUMBER: _ClassVar[int]
    chat: ChatSettings
    def __init__(self, chat: _Optional[_Union[ChatSettings, _Mapping]] = ...) -> None: ...

class ChatSettings(_message.Message):
    __slots__ = ("agents_enabled",)
    AGENTS_ENABLED_FIELD_NUMBER: _ClassVar[int]
    agents_enabled: bool
    def __init__(self, agents_enabled: _Optional[bool] = ...) -> None: ...

class GetOrganizationSettingsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetOrganizationSettingsResponse(_message.Message):
    __slots__ = ("settings",)
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    settings: OrganizationSettings
    def __init__(self, settings: _Optional[_Union[OrganizationSettings, _Mapping]] = ...) -> None: ...

class UpdateOrganizationSettingsRequest(_message.Message):
    __slots__ = ("organization_id", "chat")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    CHAT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    chat: ChatSettings
    def __init__(self, organization_id: _Optional[str] = ..., chat: _Optional[_Union[ChatSettings, _Mapping]] = ...) -> None: ...

class UpdateOrganizationSettingsResponse(_message.Message):
    __slots__ = ("settings",)
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    settings: OrganizationSettings
    def __init__(self, settings: _Optional[_Union[OrganizationSettings, _Mapping]] = ...) -> None: ...

class GrantDomainAdminRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "domain")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    domain: _common_pb2.DomainType
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., domain: _Optional[_Union[_common_pb2.DomainType, str]] = ...) -> None: ...

class GrantDomainAdminResponse(_message.Message):
    __slots__ = ("domain_admin",)
    DOMAIN_ADMIN_FIELD_NUMBER: _ClassVar[int]
    domain_admin: _common_pb2.DomainAdminInfo
    def __init__(self, domain_admin: _Optional[_Union[_common_pb2.DomainAdminInfo, _Mapping]] = ...) -> None: ...

class RevokeDomainAdminRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "domain")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    domain: _common_pb2.DomainType
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., domain: _Optional[_Union[_common_pb2.DomainType, str]] = ...) -> None: ...

class RevokeDomainAdminResponse(_message.Message):
    __slots__ = ("success",)
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    success: bool
    def __init__(self, success: _Optional[bool] = ...) -> None: ...

class ListDomainAdminsRequest(_message.Message):
    __slots__ = ("organization_id", "domain_filter", "pagination")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    DOMAIN_FILTER_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    domain_filter: _common_pb2.DomainType
    pagination: _common_pb2.PaginationRequest
    def __init__(self, organization_id: _Optional[str] = ..., domain_filter: _Optional[_Union[_common_pb2.DomainType, str]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ...) -> None: ...

class ListDomainAdminsResponse(_message.Message):
    __slots__ = ("domain_admins", "pagination")
    DOMAIN_ADMINS_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    domain_admins: _containers.RepeatedCompositeFieldContainer[_common_pb2.DomainAdminInfo]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, domain_admins: _Optional[_Iterable[_Union[_common_pb2.DomainAdminInfo, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class GetUserDomainAdminsRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetUserDomainAdminsResponse(_message.Message):
    __slots__ = ("domains",)
    DOMAINS_FIELD_NUMBER: _ClassVar[int]
    domains: _containers.RepeatedScalarFieldContainer[_common_pb2.DomainType]
    def __init__(self, domains: _Optional[_Iterable[_Union[_common_pb2.DomainType, str]]] = ...) -> None: ...

class RotateEncryptionKeyRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class RotateEncryptionKeyResponse(_message.Message):
    __slots__ = ("new_version", "previous_version", "rotated_at")
    NEW_VERSION_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_VERSION_FIELD_NUMBER: _ClassVar[int]
    ROTATED_AT_FIELD_NUMBER: _ClassVar[int]
    new_version: int
    previous_version: int
    rotated_at: _timestamp_pb2.Timestamp
    def __init__(self, new_version: _Optional[int] = ..., previous_version: _Optional[int] = ..., rotated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class Invitation(_message.Message):
    __slots__ = ("id", "organization_id", "email", "role", "expires_at", "created_at", "accepted_at", "revoked_at", "invited_by_user_id", "invited_by_display_name", "status")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    ACCEPTED_AT_FIELD_NUMBER: _ClassVar[int]
    REVOKED_AT_FIELD_NUMBER: _ClassVar[int]
    INVITED_BY_USER_ID_FIELD_NUMBER: _ClassVar[int]
    INVITED_BY_DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    id: str
    organization_id: str
    email: str
    role: _common_pb2.OrganizationRole
    expires_at: _timestamp_pb2.Timestamp
    created_at: _timestamp_pb2.Timestamp
    accepted_at: _timestamp_pb2.Timestamp
    revoked_at: _timestamp_pb2.Timestamp
    invited_by_user_id: str
    invited_by_display_name: str
    status: InvitationStatus
    def __init__(self, id: _Optional[str] = ..., organization_id: _Optional[str] = ..., email: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., accepted_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., revoked_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., invited_by_user_id: _Optional[str] = ..., invited_by_display_name: _Optional[str] = ..., status: _Optional[_Union[InvitationStatus, str]] = ...) -> None: ...

class InviteMemberRequest(_message.Message):
    __slots__ = ("organization_id", "email", "role")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    email: str
    role: _common_pb2.OrganizationRole
    def __init__(self, organization_id: _Optional[str] = ..., email: _Optional[str] = ..., role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ...) -> None: ...

class InviteMemberResponse(_message.Message):
    __slots__ = ("added_member", "invitation")
    ADDED_MEMBER_FIELD_NUMBER: _ClassVar[int]
    INVITATION_FIELD_NUMBER: _ClassVar[int]
    added_member: _common_pb2.MemberInfo
    invitation: Invitation
    def __init__(self, added_member: _Optional[_Union[_common_pb2.MemberInfo, _Mapping]] = ..., invitation: _Optional[_Union[Invitation, _Mapping]] = ...) -> None: ...

class ListInvitationsRequest(_message.Message):
    __slots__ = ("organization_id", "status")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    status: InvitationStatus
    def __init__(self, organization_id: _Optional[str] = ..., status: _Optional[_Union[InvitationStatus, str]] = ...) -> None: ...

class ListInvitationsResponse(_message.Message):
    __slots__ = ("invitations",)
    INVITATIONS_FIELD_NUMBER: _ClassVar[int]
    invitations: _containers.RepeatedCompositeFieldContainer[Invitation]
    def __init__(self, invitations: _Optional[_Iterable[_Union[Invitation, _Mapping]]] = ...) -> None: ...

class RevokeInvitationRequest(_message.Message):
    __slots__ = ("invitation_id",)
    INVITATION_ID_FIELD_NUMBER: _ClassVar[int]
    invitation_id: str
    def __init__(self, invitation_id: _Optional[str] = ...) -> None: ...

class RevokeInvitationResponse(_message.Message):
    __slots__ = ("invitation",)
    INVITATION_FIELD_NUMBER: _ClassVar[int]
    invitation: Invitation
    def __init__(self, invitation: _Optional[_Union[Invitation, _Mapping]] = ...) -> None: ...

class ResendInvitationRequest(_message.Message):
    __slots__ = ("invitation_id",)
    INVITATION_ID_FIELD_NUMBER: _ClassVar[int]
    invitation_id: str
    def __init__(self, invitation_id: _Optional[str] = ...) -> None: ...

class ResendInvitationResponse(_message.Message):
    __slots__ = ("invitation",)
    INVITATION_FIELD_NUMBER: _ClassVar[int]
    invitation: Invitation
    def __init__(self, invitation: _Optional[_Union[Invitation, _Mapping]] = ...) -> None: ...

class SecuritySettings(_message.Message):
    __slots__ = ("password_reset_enabled", "mfa_required_for_members", "mfa_required_for_admins")
    PASSWORD_RESET_ENABLED_FIELD_NUMBER: _ClassVar[int]
    MFA_REQUIRED_FOR_MEMBERS_FIELD_NUMBER: _ClassVar[int]
    MFA_REQUIRED_FOR_ADMINS_FIELD_NUMBER: _ClassVar[int]
    password_reset_enabled: bool
    mfa_required_for_members: bool
    mfa_required_for_admins: bool
    def __init__(self, password_reset_enabled: _Optional[bool] = ..., mfa_required_for_members: _Optional[bool] = ..., mfa_required_for_admins: _Optional[bool] = ...) -> None: ...

class GetSecuritySettingsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetSecuritySettingsResponse(_message.Message):
    __slots__ = ("settings",)
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    settings: SecuritySettings
    def __init__(self, settings: _Optional[_Union[SecuritySettings, _Mapping]] = ...) -> None: ...

class UpdateSecuritySettingsRequest(_message.Message):
    __slots__ = ("organization_id", "password_reset_enabled", "mfa_required_for_members", "mfa_required_for_admins")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_RESET_ENABLED_FIELD_NUMBER: _ClassVar[int]
    MFA_REQUIRED_FOR_MEMBERS_FIELD_NUMBER: _ClassVar[int]
    MFA_REQUIRED_FOR_ADMINS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    password_reset_enabled: bool
    mfa_required_for_members: bool
    mfa_required_for_admins: bool
    def __init__(self, organization_id: _Optional[str] = ..., password_reset_enabled: _Optional[bool] = ..., mfa_required_for_members: _Optional[bool] = ..., mfa_required_for_admins: _Optional[bool] = ...) -> None: ...

class UpdateSecuritySettingsResponse(_message.Message):
    __slots__ = ("settings",)
    SETTINGS_FIELD_NUMBER: _ClassVar[int]
    settings: SecuritySettings
    def __init__(self, settings: _Optional[_Union[SecuritySettings, _Mapping]] = ...) -> None: ...
