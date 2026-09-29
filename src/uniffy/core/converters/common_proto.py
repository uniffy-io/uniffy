"""Bidirectional mapping between domain enums/models and ``common.v1`` proto types."""

from uniffy_proto.common.v1.common_pb import (
    AccessMode as ProtoAccessMode,
)
from uniffy_proto.common.v1.common_pb import (
    ContentMemberAction as ProtoContentMemberAction,
)
from uniffy_proto.common.v1.common_pb import (
    ContentRole as ProtoContentRole,
)
from uniffy_proto.common.v1.common_pb import (
    ContentType as ProtoContentType,
)
from uniffy_proto.common.v1.common_pb import (
    DomainAdminInfo as ProtoDomainAdminInfo,
)
from uniffy_proto.common.v1.common_pb import (
    DomainType as ProtoDomainType,
)
from uniffy_proto.common.v1.common_pb import (
    GroupInfo as ProtoGroupInfo,
)
from uniffy_proto.common.v1.common_pb import (
    GroupKind as ProtoGroupKind,
)
from uniffy_proto.common.v1.common_pb import (
    GroupMemberInfo as ProtoGroupMemberInfo,
)
from uniffy_proto.common.v1.common_pb import (
    GroupRole as ProtoGroupRole,
)
from uniffy_proto.common.v1.common_pb import (
    MemberInfo as ProtoMemberInfo,
)
from uniffy_proto.common.v1.common_pb import (
    OrganizationInfo as ProtoOrgInfo,
)
from uniffy_proto.common.v1.common_pb import (
    OrganizationRole as ProtoOrgRole,
)
from uniffy_proto.common.v1.common_pb import (
    SubjectType as ProtoSubjectType,
)
from uniffy_proto.common.v1.common_pb import (
    UserInfo as ProtoUserInfo,
)

from uniffy.core.avatars import get_avatar_url
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group import GroupKind as DomainGroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.group_member import GroupRole as DomainGroupRole
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.organization_member import OrganizationRole as DomainOrgRole
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.domain_admin import DomainAdmin
from uniffy.core.types import AccessMode as DomainAccessMode
from uniffy.core.types import ContentMemberAction as DomainContentMemberAction
from uniffy.core.types import ContentRole as DomainContentRole
from uniffy.core.types import ContentType as DomainContentType
from uniffy.core.types import DomainType as DomainDomainType
from uniffy.core.types import SubjectType as DomainSubjectType

CONTENT_TYPE_TO_PROTO: dict[DomainContentType, ProtoContentType] = {
    DomainContentType.NOTE: ProtoContentType.NOTE,
    DomainContentType.FILE: ProtoContentType.FILE,
    DomainContentType.FOLDER: ProtoContentType.FOLDER,
    DomainContentType.CALENDAR_EVENT: ProtoContentType.CALENDAR_EVENT,
    DomainContentType.CHAT_MESSAGE: ProtoContentType.CHAT_MESSAGE,
    DomainContentType.USER: ProtoContentType.USER,
    DomainContentType.PROJECT: ProtoContentType.PROJECT,
    DomainContentType.TASK: ProtoContentType.TASK,
    DomainContentType.AGENT: ProtoContentType.AGENT,
    DomainContentType.PROVIDER_KEY: ProtoContentType.PROVIDER_KEY,
    DomainContentType.CHAT: ProtoContentType.CHAT,
    DomainContentType.AGENT_CHAT: ProtoContentType.AGENT_CHAT,
    DomainContentType.AGENT_FOLDER: ProtoContentType.AGENT_FOLDER,
    DomainContentType.ROOM: ProtoContentType.ROOM,
    DomainContentType.AGENT_CRON_TASK: ProtoContentType.AGENT_CRON_TASK,
    DomainContentType.TAG: ProtoContentType.TAG,
    DomainContentType.TEAM: ProtoContentType.TEAM,
    DomainContentType.CALENDAR: ProtoContentType.CALENDAR,
}

CONTENT_TYPE_FROM_PROTO: dict[ProtoContentType, DomainContentType] = {
    v: k for k, v in CONTENT_TYPE_TO_PROTO.items()
}

CONTENT_ROLE_TO_PROTO: dict[DomainContentRole, ProtoContentRole] = {
    DomainContentRole.VIEWER: ProtoContentRole.VIEWER,
    DomainContentRole.COMMENTER: ProtoContentRole.COMMENTER,
    DomainContentRole.EDITOR: ProtoContentRole.EDITOR,
    DomainContentRole.ADMIN: ProtoContentRole.ADMIN,
    DomainContentRole.OWNER: ProtoContentRole.OWNER,
    DomainContentRole.BLOCKED: ProtoContentRole.BLOCKED,
}

CONTENT_ROLE_FROM_PROTO: dict[ProtoContentRole, DomainContentRole] = {
    v: k for k, v in CONTENT_ROLE_TO_PROTO.items()
}

ACCESS_MODE_TO_PROTO: dict[DomainAccessMode, ProtoAccessMode] = {
    DomainAccessMode.OWNER_ONLY: ProtoAccessMode.OWNER_ONLY,
    DomainAccessMode.EXPLICIT_MEMBERS: ProtoAccessMode.EXPLICIT_MEMBERS,
    DomainAccessMode.OPEN_TO_ORG: ProtoAccessMode.OPEN_TO_ORG,
}

ACCESS_MODE_FROM_PROTO: dict[ProtoAccessMode, DomainAccessMode] = {
    v: k for k, v in ACCESS_MODE_TO_PROTO.items()
}

_cma = ProtoContentMemberAction  # alias to keep the dict entries short
CONTENT_MEMBER_ACTION_TO_PROTO: dict[DomainContentMemberAction, ProtoContentMemberAction] = {
    DomainContentMemberAction.MEMBER_ADDED: _cma.MEMBER_ADDED,
    DomainContentMemberAction.MEMBER_ROLE_CHANGED: _cma.MEMBER_ROLE_CHANGED,
    DomainContentMemberAction.MEMBER_REMOVED: _cma.MEMBER_REMOVED,
    DomainContentMemberAction.ACCESS_MODE_CHANGED: _cma.ACCESS_MODE_CHANGED,
    DomainContentMemberAction.BASELINE_ROLE_CHANGED: (_cma.BASELINE_ROLE_CHANGED),
    DomainContentMemberAction.OWNERSHIP_TRANSFERRED: (_cma.OWNERSHIP_TRANSFERRED),
}

CONTENT_MEMBER_ACTION_FROM_PROTO: dict[ProtoContentMemberAction, DomainContentMemberAction] = {
    v: k for k, v in CONTENT_MEMBER_ACTION_TO_PROTO.items()
}

SUBJECT_TYPE_TO_PROTO: dict[DomainSubjectType, ProtoSubjectType] = {
    DomainSubjectType.USER: ProtoSubjectType.USER,
    DomainSubjectType.GROUP: ProtoSubjectType.GROUP,
    DomainSubjectType.ORGANIZATION: ProtoSubjectType.ORGANIZATION,
    DomainSubjectType.AGENT: ProtoSubjectType.AGENT,
}

SUBJECT_TYPE_FROM_PROTO: dict[ProtoSubjectType, DomainSubjectType] = {
    v: k for k, v in SUBJECT_TYPE_TO_PROTO.items()
}

ORG_ROLE_TO_PROTO: dict[DomainOrgRole, ProtoOrgRole] = {
    DomainOrgRole.MEMBER: ProtoOrgRole.MEMBER,
    DomainOrgRole.ADMIN: ProtoOrgRole.ADMIN,
    DomainOrgRole.OWNER: ProtoOrgRole.OWNER,
}

ORG_ROLE_FROM_PROTO: dict[ProtoOrgRole, DomainOrgRole] = {v: k for k, v in ORG_ROLE_TO_PROTO.items()}

GROUP_ROLE_TO_PROTO: dict[DomainGroupRole, ProtoGroupRole] = {
    DomainGroupRole.MEMBER: ProtoGroupRole.MEMBER,
    DomainGroupRole.ADMIN: ProtoGroupRole.ADMIN,
}

GROUP_ROLE_FROM_PROTO: dict[ProtoGroupRole, DomainGroupRole] = {
    v: k for k, v in GROUP_ROLE_TO_PROTO.items()
}

DOMAIN_TYPE_TO_PROTO: dict[DomainDomainType, ProtoDomainType] = {
    DomainDomainType.CHAT: ProtoDomainType.CHAT,
    DomainDomainType.FILES: ProtoDomainType.FILES,
    DomainDomainType.NOTES: ProtoDomainType.NOTES,
    DomainDomainType.CALENDAR: ProtoDomainType.CALENDAR,
    DomainDomainType.PROJECTS: ProtoDomainType.PROJECTS,
    DomainDomainType.AGENTS: ProtoDomainType.AGENTS,
}

DOMAIN_TYPE_FROM_PROTO: dict[ProtoDomainType, DomainDomainType] = {
    v: k for k, v in DOMAIN_TYPE_TO_PROTO.items()
}


def content_type_to_proto(ct: DomainContentType) -> ProtoContentType:
    return CONTENT_TYPE_TO_PROTO.get(ct, ProtoContentType.UNSPECIFIED)


def content_type_from_proto(ct: ProtoContentType) -> DomainContentType | None:
    return CONTENT_TYPE_FROM_PROTO.get(ct)


def subject_type_to_proto(st: DomainSubjectType) -> ProtoSubjectType:
    return SUBJECT_TYPE_TO_PROTO.get(st, ProtoSubjectType.UNSPECIFIED)


def subject_type_from_proto(st: ProtoSubjectType) -> DomainSubjectType | None:
    return SUBJECT_TYPE_FROM_PROTO.get(st)


def content_role_to_proto(role: DomainContentRole) -> ProtoContentRole:
    return CONTENT_ROLE_TO_PROTO.get(role, ProtoContentRole.UNSPECIFIED)


def content_role_from_proto(role: ProtoContentRole) -> DomainContentRole | None:
    return CONTENT_ROLE_FROM_PROTO.get(role)


def access_mode_to_proto(mode: DomainAccessMode) -> ProtoAccessMode:
    return ACCESS_MODE_TO_PROTO.get(mode, ProtoAccessMode.UNSPECIFIED)


def access_mode_from_proto(mode: ProtoAccessMode) -> DomainAccessMode | None:
    return ACCESS_MODE_FROM_PROTO.get(mode)


def content_member_action_to_proto(
    action: DomainContentMemberAction,
) -> ProtoContentMemberAction:
    return CONTENT_MEMBER_ACTION_TO_PROTO.get(action, ProtoContentMemberAction.UNSPECIFIED)


def content_member_action_from_proto(
    action: ProtoContentMemberAction,
) -> DomainContentMemberAction | None:
    return CONTENT_MEMBER_ACTION_FROM_PROTO.get(action)


def org_role_to_proto(role: DomainOrgRole) -> ProtoOrgRole:
    return ORG_ROLE_TO_PROTO.get(role, ProtoOrgRole.UNSPECIFIED)


def org_role_from_proto(role: ProtoOrgRole) -> DomainOrgRole | None:
    return ORG_ROLE_FROM_PROTO.get(role)


def group_role_to_proto(role: DomainGroupRole) -> ProtoGroupRole:
    return GROUP_ROLE_TO_PROTO.get(role, ProtoGroupRole.UNSPECIFIED)


def group_role_from_proto(role: ProtoGroupRole) -> DomainGroupRole | None:
    return GROUP_ROLE_FROM_PROTO.get(role)


def domain_type_to_proto(dt: DomainDomainType) -> ProtoDomainType:
    return DOMAIN_TYPE_TO_PROTO.get(dt, ProtoDomainType.UNSPECIFIED)


def domain_type_from_proto(dt: ProtoDomainType) -> DomainDomainType | None:
    return DOMAIN_TYPE_FROM_PROTO.get(dt)


def domain_admin_info_to_proto(
    da: DomainAdmin,
    user: User,
) -> ProtoDomainAdminInfo:
    return ProtoDomainAdminInfo(
        id=str(da.id),
        user_id=str(da.user_id),
        display_name=user.full_name or user.username,
        email=user.email,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        domain=domain_type_to_proto(da.domain),
        granted_by_user_id=str(da.granted_by),
        granted_at=datetime_to_timestamp(da.granted_at),
    )


def timestamp_to_proto(dt):
    """Alias for :func:`datetime_to_timestamp`."""
    return datetime_to_timestamp(dt)


def user_info_to_proto(user: User) -> ProtoUserInfo:
    return ProtoUserInfo(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name or "",
        username=user.username,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        created_at=datetime_to_timestamp(user.created_at),
        has_avatar=user.avatar_key is not None,
    )


def org_info_to_proto(org: Organization) -> ProtoOrgInfo:
    return ProtoOrgInfo(
        id=str(org.id),
        name=org.name,
        slug=org.slug,
        logo_url="",  # TODO: Add logo_url to Organization model
        created_at=datetime_to_timestamp(org.created_at),
        updated_at=datetime_to_timestamp(org.updated_at),
    )


GROUP_KIND_TO_PROTO: dict[DomainGroupKind, ProtoGroupKind] = {
    DomainGroupKind.TEAM: ProtoGroupKind.TEAM,
    DomainGroupKind.ACCESS: ProtoGroupKind.ACCESS,
}

GROUP_KIND_FROM_PROTO: dict[ProtoGroupKind, DomainGroupKind] = {
    ProtoGroupKind.TEAM: DomainGroupKind.TEAM,
    ProtoGroupKind.ACCESS: DomainGroupKind.ACCESS,
}


def group_kind_to_proto(kind: DomainGroupKind) -> ProtoGroupKind:
    return GROUP_KIND_TO_PROTO[kind]


def group_kind_from_proto(kind: ProtoGroupKind) -> DomainGroupKind | None:
    return GROUP_KIND_FROM_PROTO.get(kind)


def group_info_to_proto(group: Group, member_count: int = 0) -> ProtoGroupInfo:
    info = ProtoGroupInfo(
        id=str(group.id),
        organization_id=str(group.organization_id),
        name=group.name,
        slug=group.slug,
        description=group.description or "",
        is_private=group.is_private,
        member_count=member_count,
        created_at=datetime_to_timestamp(group.created_at),
        updated_at=datetime_to_timestamp(group.updated_at),
        kind=group_kind_to_proto(group.kind),
    )
    if group.parent_group_id:
        info.parent_group_id = str(group.parent_group_id)
    if group.lead_user_id:
        info.lead_user_id = str(group.lead_user_id)
    return info


def member_info_to_proto(
    user: User,
    membership: OrganizationMember,
) -> ProtoMemberInfo:
    return ProtoMemberInfo(
        user_id=str(user.id),
        display_name=user.full_name or user.username,
        email=user.email,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        role=org_role_to_proto(membership.role),
        joined_at=datetime_to_timestamp(membership.joined_at),
        is_active=membership.is_active,
        has_avatar=user.avatar_key is not None,
    )


def group_member_info_to_proto(
    user: User,
    membership: GroupMember,
) -> ProtoGroupMemberInfo:
    return ProtoGroupMemberInfo(
        user_id=str(user.id),
        display_name=user.full_name or user.username,
        email=user.email,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        role=group_role_to_proto(membership.role),
        joined_at=datetime_to_timestamp(membership.joined_at),
    )
