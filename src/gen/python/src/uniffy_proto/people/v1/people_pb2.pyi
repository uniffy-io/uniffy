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

class IdentitySourceKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    IDENTITY_SOURCE_KIND_UNSPECIFIED: _ClassVar[IdentitySourceKind]
    IDENTITY_SOURCE_KIND_LOCAL: _ClassVar[IdentitySourceKind]
    IDENTITY_SOURCE_KIND_SCIM: _ClassVar[IdentitySourceKind]
    IDENTITY_SOURCE_KIND_LDAP: _ClassVar[IdentitySourceKind]
    IDENTITY_SOURCE_KIND_OIDC: _ClassVar[IdentitySourceKind]
IDENTITY_SOURCE_KIND_UNSPECIFIED: IdentitySourceKind
IDENTITY_SOURCE_KIND_LOCAL: IdentitySourceKind
IDENTITY_SOURCE_KIND_SCIM: IdentitySourceKind
IDENTITY_SOURCE_KIND_LDAP: IdentitySourceKind
IDENTITY_SOURCE_KIND_OIDC: IdentitySourceKind

class ProfileLink(_message.Message):
    __slots__ = ("label", "url")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    label: str
    url: str
    def __init__(self, label: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...

class ProfileLinks(_message.Message):
    __slots__ = ("links",)
    LINKS_FIELD_NUMBER: _ClassVar[int]
    links: _containers.RepeatedCompositeFieldContainer[ProfileLink]
    def __init__(self, links: _Optional[_Iterable[_Union[ProfileLink, _Mapping]]] = ...) -> None: ...

class TeamRef(_message.Message):
    __slots__ = ("group_id", "name", "lead_user_id")
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    LEAD_USER_ID_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    name: str
    lead_user_id: str
    def __init__(self, group_id: _Optional[str] = ..., name: _Optional[str] = ..., lead_user_id: _Optional[str] = ...) -> None: ...

class PersonProfile(_message.Message):
    __slots__ = ("user_id", "display_name", "username", "avatar_url", "has_avatar", "org_role", "is_active", "job_title", "department", "email", "work_phone", "mobile_phone", "office_location", "timezone", "pronouns", "bio", "start_date", "birthday", "links", "manager_user_id", "teams", "direct_report_count", "managed_fields", "is_self", "can_edit")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    HAS_AVATAR_FIELD_NUMBER: _ClassVar[int]
    ORG_ROLE_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    JOB_TITLE_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    WORK_PHONE_FIELD_NUMBER: _ClassVar[int]
    MOBILE_PHONE_FIELD_NUMBER: _ClassVar[int]
    OFFICE_LOCATION_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    PRONOUNS_FIELD_NUMBER: _ClassVar[int]
    BIO_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    BIRTHDAY_FIELD_NUMBER: _ClassVar[int]
    LINKS_FIELD_NUMBER: _ClassVar[int]
    MANAGER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    DIRECT_REPORT_COUNT_FIELD_NUMBER: _ClassVar[int]
    MANAGED_FIELDS_FIELD_NUMBER: _ClassVar[int]
    IS_SELF_FIELD_NUMBER: _ClassVar[int]
    CAN_EDIT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    username: str
    avatar_url: str
    has_avatar: bool
    org_role: _common_pb2.OrganizationRole
    is_active: bool
    job_title: str
    department: str
    email: str
    work_phone: str
    mobile_phone: str
    office_location: str
    timezone: str
    pronouns: str
    bio: str
    start_date: _timestamp_pb2.Timestamp
    birthday: str
    links: _containers.RepeatedCompositeFieldContainer[ProfileLink]
    manager_user_id: str
    teams: _containers.RepeatedCompositeFieldContainer[TeamRef]
    direct_report_count: int
    managed_fields: _containers.RepeatedScalarFieldContainer[str]
    is_self: bool
    can_edit: bool
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., username: _Optional[str] = ..., avatar_url: _Optional[str] = ..., has_avatar: _Optional[bool] = ..., org_role: _Optional[_Union[_common_pb2.OrganizationRole, str]] = ..., is_active: _Optional[bool] = ..., job_title: _Optional[str] = ..., department: _Optional[str] = ..., email: _Optional[str] = ..., work_phone: _Optional[str] = ..., mobile_phone: _Optional[str] = ..., office_location: _Optional[str] = ..., timezone: _Optional[str] = ..., pronouns: _Optional[str] = ..., bio: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., birthday: _Optional[str] = ..., links: _Optional[_Iterable[_Union[ProfileLink, _Mapping]]] = ..., manager_user_id: _Optional[str] = ..., teams: _Optional[_Iterable[_Union[TeamRef, _Mapping]]] = ..., direct_report_count: _Optional[int] = ..., managed_fields: _Optional[_Iterable[str]] = ..., is_self: _Optional[bool] = ..., can_edit: _Optional[bool] = ...) -> None: ...

class ListPeopleRequest(_message.Message):
    __slots__ = ("organization_id", "pagination", "search", "department", "team_id", "include_inactive")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    SEARCH_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_FIELD_NUMBER: _ClassVar[int]
    TEAM_ID_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INACTIVE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    pagination: _common_pb2.PaginationRequest
    search: str
    department: str
    team_id: str
    include_inactive: bool
    def __init__(self, organization_id: _Optional[str] = ..., pagination: _Optional[_Union[_common_pb2.PaginationRequest, _Mapping]] = ..., search: _Optional[str] = ..., department: _Optional[str] = ..., team_id: _Optional[str] = ..., include_inactive: _Optional[bool] = ...) -> None: ...

class ListPeopleResponse(_message.Message):
    __slots__ = ("people", "pagination")
    PEOPLE_FIELD_NUMBER: _ClassVar[int]
    PAGINATION_FIELD_NUMBER: _ClassVar[int]
    people: _containers.RepeatedCompositeFieldContainer[PersonProfile]
    pagination: _common_pb2.PaginationResponse
    def __init__(self, people: _Optional[_Iterable[_Union[PersonProfile, _Mapping]]] = ..., pagination: _Optional[_Union[_common_pb2.PaginationResponse, _Mapping]] = ...) -> None: ...

class GetPersonRequest(_message.Message):
    __slots__ = ("organization_id", "user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class GetPersonResponse(_message.Message):
    __slots__ = ("person",)
    PERSON_FIELD_NUMBER: _ClassVar[int]
    person: PersonProfile
    def __init__(self, person: _Optional[_Union[PersonProfile, _Mapping]] = ...) -> None: ...

class UpdateMyProfileRequest(_message.Message):
    __slots__ = ("organization_id", "work_phone", "mobile_phone", "timezone", "bio", "birthday", "links")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    WORK_PHONE_FIELD_NUMBER: _ClassVar[int]
    MOBILE_PHONE_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    BIO_FIELD_NUMBER: _ClassVar[int]
    BIRTHDAY_FIELD_NUMBER: _ClassVar[int]
    LINKS_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    work_phone: str
    mobile_phone: str
    timezone: str
    bio: str
    birthday: str
    links: ProfileLinks
    def __init__(self, organization_id: _Optional[str] = ..., work_phone: _Optional[str] = ..., mobile_phone: _Optional[str] = ..., timezone: _Optional[str] = ..., bio: _Optional[str] = ..., birthday: _Optional[str] = ..., links: _Optional[_Union[ProfileLinks, _Mapping]] = ...) -> None: ...

class UpdateMyProfileResponse(_message.Message):
    __slots__ = ("person",)
    PERSON_FIELD_NUMBER: _ClassVar[int]
    person: PersonProfile
    def __init__(self, person: _Optional[_Union[PersonProfile, _Mapping]] = ...) -> None: ...

class UpdatePersonProfileRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "job_title", "department", "office_location", "work_phone", "mobile_phone", "start_date")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    JOB_TITLE_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_FIELD_NUMBER: _ClassVar[int]
    OFFICE_LOCATION_FIELD_NUMBER: _ClassVar[int]
    WORK_PHONE_FIELD_NUMBER: _ClassVar[int]
    MOBILE_PHONE_FIELD_NUMBER: _ClassVar[int]
    START_DATE_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    job_title: str
    department: str
    office_location: str
    work_phone: str
    mobile_phone: str
    start_date: _timestamp_pb2.Timestamp
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., job_title: _Optional[str] = ..., department: _Optional[str] = ..., office_location: _Optional[str] = ..., work_phone: _Optional[str] = ..., mobile_phone: _Optional[str] = ..., start_date: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class UpdatePersonProfileResponse(_message.Message):
    __slots__ = ("person",)
    PERSON_FIELD_NUMBER: _ClassVar[int]
    person: PersonProfile
    def __init__(self, person: _Optional[_Union[PersonProfile, _Mapping]] = ...) -> None: ...

class GetOrgChartRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class OrgChartNode(_message.Message):
    __slots__ = ("user_id", "display_name", "avatar_url", "job_title", "department", "manager_user_id", "teams", "descendant_count")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    AVATAR_URL_FIELD_NUMBER: _ClassVar[int]
    JOB_TITLE_FIELD_NUMBER: _ClassVar[int]
    DEPARTMENT_FIELD_NUMBER: _ClassVar[int]
    MANAGER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    DESCENDANT_COUNT_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    display_name: str
    avatar_url: str
    job_title: str
    department: str
    manager_user_id: str
    teams: _containers.RepeatedCompositeFieldContainer[TeamRef]
    descendant_count: int
    def __init__(self, user_id: _Optional[str] = ..., display_name: _Optional[str] = ..., avatar_url: _Optional[str] = ..., job_title: _Optional[str] = ..., department: _Optional[str] = ..., manager_user_id: _Optional[str] = ..., teams: _Optional[_Iterable[_Union[TeamRef, _Mapping]]] = ..., descendant_count: _Optional[int] = ...) -> None: ...

class TeamNode(_message.Message):
    __slots__ = ("group_id", "name", "description", "parent_group_id", "lead_user_id")
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    PARENT_GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    LEAD_USER_ID_FIELD_NUMBER: _ClassVar[int]
    group_id: str
    name: str
    description: str
    parent_group_id: str
    lead_user_id: str
    def __init__(self, group_id: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., parent_group_id: _Optional[str] = ..., lead_user_id: _Optional[str] = ...) -> None: ...

class GetOrgChartResponse(_message.Message):
    __slots__ = ("nodes", "root_user_ids", "teams", "truncated", "enabled")
    NODES_FIELD_NUMBER: _ClassVar[int]
    ROOT_USER_IDS_FIELD_NUMBER: _ClassVar[int]
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    nodes: _containers.RepeatedCompositeFieldContainer[OrgChartNode]
    root_user_ids: _containers.RepeatedScalarFieldContainer[str]
    teams: _containers.RepeatedCompositeFieldContainer[TeamNode]
    truncated: bool
    enabled: bool
    def __init__(self, nodes: _Optional[_Iterable[_Union[OrgChartNode, _Mapping]]] = ..., root_user_ids: _Optional[_Iterable[str]] = ..., teams: _Optional[_Iterable[_Union[TeamNode, _Mapping]]] = ..., truncated: _Optional[bool] = ..., enabled: _Optional[bool] = ...) -> None: ...

class SetManagerRequest(_message.Message):
    __slots__ = ("organization_id", "user_id", "manager_user_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    MANAGER_USER_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    user_id: str
    manager_user_id: str
    def __init__(self, organization_id: _Optional[str] = ..., user_id: _Optional[str] = ..., manager_user_id: _Optional[str] = ...) -> None: ...

class SetManagerResponse(_message.Message):
    __slots__ = ("person",)
    PERSON_FIELD_NUMBER: _ClassVar[int]
    person: PersonProfile
    def __init__(self, person: _Optional[_Union[PersonProfile, _Mapping]] = ...) -> None: ...

class ListTeamsRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListTeamsResponse(_message.Message):
    __slots__ = ("teams",)
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    teams: _containers.RepeatedCompositeFieldContainer[TeamNode]
    def __init__(self, teams: _Optional[_Iterable[_Union[TeamNode, _Mapping]]] = ...) -> None: ...

class GetTeamRequest(_message.Message):
    __slots__ = ("organization_id", "group_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ...) -> None: ...

class GetTeamResponse(_message.Message):
    __slots__ = ("team", "member_user_ids")
    TEAM_FIELD_NUMBER: _ClassVar[int]
    MEMBER_USER_IDS_FIELD_NUMBER: _ClassVar[int]
    team: TeamNode
    member_user_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, team: _Optional[_Union[TeamNode, _Mapping]] = ..., member_user_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class UpdateTeamRequest(_message.Message):
    __slots__ = ("organization_id", "group_id", "lead_user_id", "parent_group_id", "clear_lead", "clear_parent")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    LEAD_USER_ID_FIELD_NUMBER: _ClassVar[int]
    PARENT_GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    CLEAR_LEAD_FIELD_NUMBER: _ClassVar[int]
    CLEAR_PARENT_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    group_id: str
    lead_user_id: str
    parent_group_id: str
    clear_lead: bool
    clear_parent: bool
    def __init__(self, organization_id: _Optional[str] = ..., group_id: _Optional[str] = ..., lead_user_id: _Optional[str] = ..., parent_group_id: _Optional[str] = ..., clear_lead: _Optional[bool] = ..., clear_parent: _Optional[bool] = ...) -> None: ...

class UpdateTeamResponse(_message.Message):
    __slots__ = ("team",)
    TEAM_FIELD_NUMBER: _ClassVar[int]
    team: TeamNode
    def __init__(self, team: _Optional[_Union[TeamNode, _Mapping]] = ...) -> None: ...

class ProfilePolicy(_message.Message):
    __slots__ = ("directory_enabled", "org_chart_enabled")
    DIRECTORY_ENABLED_FIELD_NUMBER: _ClassVar[int]
    ORG_CHART_ENABLED_FIELD_NUMBER: _ClassVar[int]
    directory_enabled: bool
    org_chart_enabled: bool
    def __init__(self, directory_enabled: _Optional[bool] = ..., org_chart_enabled: _Optional[bool] = ...) -> None: ...

class GetProfilePolicyRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class GetProfilePolicyResponse(_message.Message):
    __slots__ = ("policy",)
    POLICY_FIELD_NUMBER: _ClassVar[int]
    policy: ProfilePolicy
    def __init__(self, policy: _Optional[_Union[ProfilePolicy, _Mapping]] = ...) -> None: ...

class UpdateProfilePolicyRequest(_message.Message):
    __slots__ = ("organization_id", "policy")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    POLICY_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    policy: ProfilePolicy
    def __init__(self, organization_id: _Optional[str] = ..., policy: _Optional[_Union[ProfilePolicy, _Mapping]] = ...) -> None: ...

class UpdateProfilePolicyResponse(_message.Message):
    __slots__ = ("policy",)
    POLICY_FIELD_NUMBER: _ClassVar[int]
    policy: ProfilePolicy
    def __init__(self, policy: _Optional[_Union[ProfilePolicy, _Mapping]] = ...) -> None: ...

class IdentitySource(_message.Message):
    __slots__ = ("id", "kind", "name", "is_active", "config_json", "last_sync_at", "last_sync_status", "last_sync_error", "created_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNC_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNC_STATUS_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNC_ERROR_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    kind: IdentitySourceKind
    name: str
    is_active: bool
    config_json: str
    last_sync_at: _timestamp_pb2.Timestamp
    last_sync_status: str
    last_sync_error: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., kind: _Optional[_Union[IdentitySourceKind, str]] = ..., name: _Optional[str] = ..., is_active: _Optional[bool] = ..., config_json: _Optional[str] = ..., last_sync_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_sync_status: _Optional[str] = ..., last_sync_error: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListIdentitySourcesRequest(_message.Message):
    __slots__ = ("organization_id",)
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    def __init__(self, organization_id: _Optional[str] = ...) -> None: ...

class ListIdentitySourcesResponse(_message.Message):
    __slots__ = ("sources",)
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    sources: _containers.RepeatedCompositeFieldContainer[IdentitySource]
    def __init__(self, sources: _Optional[_Iterable[_Union[IdentitySource, _Mapping]]] = ...) -> None: ...

class CreateIdentitySourceRequest(_message.Message):
    __slots__ = ("organization_id", "kind", "name", "config_json", "secret")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    SECRET_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    kind: IdentitySourceKind
    name: str
    config_json: str
    secret: str
    def __init__(self, organization_id: _Optional[str] = ..., kind: _Optional[_Union[IdentitySourceKind, str]] = ..., name: _Optional[str] = ..., config_json: _Optional[str] = ..., secret: _Optional[str] = ...) -> None: ...

class CreateIdentitySourceResponse(_message.Message):
    __slots__ = ("source",)
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    source: IdentitySource
    def __init__(self, source: _Optional[_Union[IdentitySource, _Mapping]] = ...) -> None: ...

class UpdateIdentitySourceRequest(_message.Message):
    __slots__ = ("organization_id", "source_id", "name", "is_active", "config_json", "secret")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    IS_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    SECRET_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    source_id: str
    name: str
    is_active: bool
    config_json: str
    secret: str
    def __init__(self, organization_id: _Optional[str] = ..., source_id: _Optional[str] = ..., name: _Optional[str] = ..., is_active: _Optional[bool] = ..., config_json: _Optional[str] = ..., secret: _Optional[str] = ...) -> None: ...

class UpdateIdentitySourceResponse(_message.Message):
    __slots__ = ("source",)
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    source: IdentitySource
    def __init__(self, source: _Optional[_Union[IdentitySource, _Mapping]] = ...) -> None: ...

class DeleteIdentitySourceRequest(_message.Message):
    __slots__ = ("organization_id", "source_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    source_id: str
    def __init__(self, organization_id: _Optional[str] = ..., source_id: _Optional[str] = ...) -> None: ...

class DeleteIdentitySourceResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class TriggerDirectorySyncRequest(_message.Message):
    __slots__ = ("organization_id", "source_id")
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    SOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    organization_id: str
    source_id: str
    def __init__(self, organization_id: _Optional[str] = ..., source_id: _Optional[str] = ...) -> None: ...

class TriggerDirectorySyncResponse(_message.Message):
    __slots__ = ("enqueued",)
    ENQUEUED_FIELD_NUMBER: _ClassVar[int]
    enqueued: bool
    def __init__(self, enqueued: _Optional[bool] = ...) -> None: ...
