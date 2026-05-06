"""
Common proto converters for shared enums and messages.

Provides bidirectional mapping between domain enums/models and common.v1 proto types.
"""

from uniffy_proto.common.v1.common_pb2 import (
    AccessMode as ProtoAccessMode,
)
from uniffy_proto.common.v1.common_pb2 import (
    ContentMemberAction as ProtoContentMemberAction,
)
from uniffy_proto.common.v1.common_pb2 import (
    ContentRole as ProtoContentRole,
)
from uniffy_proto.common.v1.common_pb2 import (
    ContentType as ProtoContentType,
)
from uniffy_proto.common.v1.common_pb2 import (
    DomainAdminInfo as ProtoDomainAdminInfo,
)
from uniffy_proto.common.v1.common_pb2 import (
    DomainType as ProtoDomainType,
)
from uniffy_proto.common.v1.common_pb2 import (
    GroupInfo as ProtoGroupInfo,
)
from uniffy_proto.common.v1.common_pb2 import (
    GroupMemberInfo as ProtoGroupMemberInfo,
)
from uniffy_proto.common.v1.common_pb2 import (
    GroupRole as ProtoGroupRole,
)
from uniffy_proto.common.v1.common_pb2 import (
    MemberInfo as ProtoMemberInfo,
)
from uniffy_proto.common.v1.common_pb2 import (
    OrganizationInfo as ProtoOrgInfo,
)
from uniffy_proto.common.v1.common_pb2 import (
    OrganizationRole as ProtoOrgRole,
)
from uniffy_proto.common.v1.common_pb2 import (
    SubjectType as ProtoSubjectType,
)
from uniffy_proto.common.v1.common_pb2 import (
    UserInfo as ProtoUserInfo,
)

from uniffy.core.avatars import get_avatar_url
from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.login.group import Group
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

# ContentType mappings
CONTENT_TYPE_TO_PROTO: dict[DomainContentType, ProtoContentType.ValueType] = {
    DomainContentType.NOTE: ProtoContentType.CONTENT_TYPE_NOTE,
    DomainContentType.FILE: ProtoContentType.CONTENT_TYPE_FILE,
    DomainContentType.FOLDER: ProtoContentType.CONTENT_TYPE_FOLDER,
    DomainContentType.CALENDAR_EVENT: ProtoContentType.CONTENT_TYPE_CALENDAR_EVENT,
    DomainContentType.CHAT_MESSAGE: ProtoContentType.CONTENT_TYPE_CHAT_MESSAGE,
    DomainContentType.USER: ProtoContentType.CONTENT_TYPE_USER,
    DomainContentType.PROJECT: ProtoContentType.CONTENT_TYPE_PROJECT,
    DomainContentType.TASK: ProtoContentType.CONTENT_TYPE_TASK,
    DomainContentType.AGENT: ProtoContentType.CONTENT_TYPE_AGENT,
    DomainContentType.PROVIDER_KEY: ProtoContentType.CONTENT_TYPE_PROVIDER_KEY,
    DomainContentType.PROMPT: ProtoContentType.CONTENT_TYPE_PROMPT,
    DomainContentType.CHAT: ProtoContentType.CONTENT_TYPE_CHAT,
    DomainContentType.AGENT_CHAT: ProtoContentType.CONTENT_TYPE_AGENT_CHAT,
    DomainContentType.ROOM: ProtoContentType.CONTENT_TYPE_ROOM,
    DomainContentType.AGENT_CRON_TASK: ProtoContentType.CONTENT_TYPE_AGENT_CRON_TASK,
}

CONTENT_TYPE_FROM_PROTO: dict[ProtoContentType.ValueType, DomainContentType] = {
    v: k for k, v in CONTENT_TYPE_TO_PROTO.items()
}

# ContentRole mappings
CONTENT_ROLE_TO_PROTO: dict[DomainContentRole, ProtoContentRole.ValueType] = {
    DomainContentRole.VIEWER: ProtoContentRole.CONTENT_ROLE_VIEWER,
    DomainContentRole.COMMENTER: ProtoContentRole.CONTENT_ROLE_COMMENTER,
    DomainContentRole.EDITOR: ProtoContentRole.CONTENT_ROLE_EDITOR,
    DomainContentRole.ADMIN: ProtoContentRole.CONTENT_ROLE_ADMIN,
    DomainContentRole.OWNER: ProtoContentRole.CONTENT_ROLE_OWNER,
    DomainContentRole.BLOCKED: ProtoContentRole.CONTENT_ROLE_BLOCKED,
}

CONTENT_ROLE_FROM_PROTO: dict[ProtoContentRole.ValueType, DomainContentRole] = {
    v: k for k, v in CONTENT_ROLE_TO_PROTO.items()
}

# AccessMode mappings
ACCESS_MODE_TO_PROTO: dict[DomainAccessMode, ProtoAccessMode.ValueType] = {
    DomainAccessMode.OWNER_ONLY: ProtoAccessMode.ACCESS_MODE_OWNER_ONLY,
    DomainAccessMode.EXPLICIT_MEMBERS: ProtoAccessMode.ACCESS_MODE_EXPLICIT_MEMBERS,
    DomainAccessMode.OPEN_TO_ORG: ProtoAccessMode.ACCESS_MODE_OPEN_TO_ORG,
}

ACCESS_MODE_FROM_PROTO: dict[ProtoAccessMode.ValueType, DomainAccessMode] = {
    v: k for k, v in ACCESS_MODE_TO_PROTO.items()
}

# ContentMemberAction mappings
_cma = ProtoContentMemberAction  # alias to keep the lines short
CONTENT_MEMBER_ACTION_TO_PROTO: dict[
    DomainContentMemberAction, ProtoContentMemberAction.ValueType
] = {
    DomainContentMemberAction.MEMBER_ADDED: _cma.CONTENT_MEMBER_ACTION_MEMBER_ADDED,
    DomainContentMemberAction.MEMBER_ROLE_CHANGED: _cma.CONTENT_MEMBER_ACTION_MEMBER_ROLE_CHANGED,
    DomainContentMemberAction.MEMBER_REMOVED: _cma.CONTENT_MEMBER_ACTION_MEMBER_REMOVED,
    DomainContentMemberAction.ACCESS_MODE_CHANGED: _cma.CONTENT_MEMBER_ACTION_ACCESS_MODE_CHANGED,
    DomainContentMemberAction.BASELINE_ROLE_CHANGED: (
        _cma.CONTENT_MEMBER_ACTION_BASELINE_ROLE_CHANGED
    ),
    DomainContentMemberAction.OWNERSHIP_TRANSFERRED: (
        _cma.CONTENT_MEMBER_ACTION_OWNERSHIP_TRANSFERRED
    ),
}

CONTENT_MEMBER_ACTION_FROM_PROTO: dict[
    ProtoContentMemberAction.ValueType, DomainContentMemberAction
] = {v: k for k, v in CONTENT_MEMBER_ACTION_TO_PROTO.items()}

# SubjectType mappings
SUBJECT_TYPE_TO_PROTO: dict[DomainSubjectType, ProtoSubjectType.ValueType] = {
    DomainSubjectType.USER: ProtoSubjectType.SUBJECT_TYPE_USER,
    DomainSubjectType.GROUP: ProtoSubjectType.SUBJECT_TYPE_GROUP,
    DomainSubjectType.ORGANIZATION: ProtoSubjectType.SUBJECT_TYPE_ORGANIZATION,
    DomainSubjectType.AGENT: ProtoSubjectType.SUBJECT_TYPE_AGENT,
}

SUBJECT_TYPE_FROM_PROTO: dict[ProtoSubjectType.ValueType, DomainSubjectType] = {
    v: k for k, v in SUBJECT_TYPE_TO_PROTO.items()
}

# OrganizationRole mappings
ORG_ROLE_TO_PROTO: dict[DomainOrgRole, ProtoOrgRole.ValueType] = {
    DomainOrgRole.MEMBER: ProtoOrgRole.ORGANIZATION_ROLE_MEMBER,
    DomainOrgRole.ADMIN: ProtoOrgRole.ORGANIZATION_ROLE_ADMIN,
    DomainOrgRole.OWNER: ProtoOrgRole.ORGANIZATION_ROLE_OWNER,
}

ORG_ROLE_FROM_PROTO: dict[ProtoOrgRole.ValueType, DomainOrgRole] = {
    v: k for k, v in ORG_ROLE_TO_PROTO.items()
}

# GroupRole mappings
GROUP_ROLE_TO_PROTO: dict[DomainGroupRole, ProtoGroupRole.ValueType] = {
    DomainGroupRole.MEMBER: ProtoGroupRole.GROUP_ROLE_MEMBER,
    DomainGroupRole.ADMIN: ProtoGroupRole.GROUP_ROLE_ADMIN,
}

GROUP_ROLE_FROM_PROTO: dict[ProtoGroupRole.ValueType, DomainGroupRole] = {
    v: k for k, v in GROUP_ROLE_TO_PROTO.items()
}

# DomainType mappings
DOMAIN_TYPE_TO_PROTO: dict[DomainDomainType, ProtoDomainType.ValueType] = {
    DomainDomainType.CHAT: ProtoDomainType.DOMAIN_TYPE_CHAT,
    DomainDomainType.FILES: ProtoDomainType.DOMAIN_TYPE_FILES,
    DomainDomainType.NOTES: ProtoDomainType.DOMAIN_TYPE_NOTES,
    DomainDomainType.CALENDAR: ProtoDomainType.DOMAIN_TYPE_CALENDAR,
    DomainDomainType.PROJECTS: ProtoDomainType.DOMAIN_TYPE_PROJECTS,
    DomainDomainType.AGENTS: ProtoDomainType.DOMAIN_TYPE_AGENTS,
}

DOMAIN_TYPE_FROM_PROTO: dict[ProtoDomainType.ValueType, DomainDomainType] = {
    v: k for k, v in DOMAIN_TYPE_TO_PROTO.items()
}


def content_type_to_proto(ct: DomainContentType) -> ProtoContentType.ValueType:
    """Convert domain ContentType to proto."""
    return CONTENT_TYPE_TO_PROTO.get(ct, ProtoContentType.CONTENT_TYPE_UNSPECIFIED)


def content_type_from_proto(ct: ProtoContentType.ValueType) -> DomainContentType | None:
    """Convert proto ContentType to domain."""
    return CONTENT_TYPE_FROM_PROTO.get(ct)


def subject_type_to_proto(st: DomainSubjectType) -> ProtoSubjectType.ValueType:
    """Convert domain SubjectType to proto."""
    return SUBJECT_TYPE_TO_PROTO.get(st, ProtoSubjectType.SUBJECT_TYPE_UNSPECIFIED)


def subject_type_from_proto(st: ProtoSubjectType.ValueType) -> DomainSubjectType | None:
    """Convert proto SubjectType to domain."""
    return SUBJECT_TYPE_FROM_PROTO.get(st)


def content_role_to_proto(role: DomainContentRole) -> ProtoContentRole.ValueType:
    """Convert domain ContentRole to proto."""
    return CONTENT_ROLE_TO_PROTO.get(role, ProtoContentRole.CONTENT_ROLE_UNSPECIFIED)


def content_role_from_proto(role: ProtoContentRole.ValueType) -> DomainContentRole | None:
    """Convert proto ContentRole to domain."""
    return CONTENT_ROLE_FROM_PROTO.get(role)


def access_mode_to_proto(mode: DomainAccessMode) -> ProtoAccessMode.ValueType:
    """Convert domain AccessMode to proto."""
    return ACCESS_MODE_TO_PROTO.get(mode, ProtoAccessMode.ACCESS_MODE_UNSPECIFIED)


def access_mode_from_proto(mode: ProtoAccessMode.ValueType) -> DomainAccessMode | None:
    """Convert proto AccessMode to domain."""
    return ACCESS_MODE_FROM_PROTO.get(mode)


def content_member_action_to_proto(
    action: DomainContentMemberAction,
) -> ProtoContentMemberAction.ValueType:
    """Convert domain ContentMemberAction to proto."""
    return CONTENT_MEMBER_ACTION_TO_PROTO.get(
        action, ProtoContentMemberAction.CONTENT_MEMBER_ACTION_UNSPECIFIED
    )


def content_member_action_from_proto(
    action: ProtoContentMemberAction.ValueType,
) -> DomainContentMemberAction | None:
    """Convert proto ContentMemberAction to domain."""
    return CONTENT_MEMBER_ACTION_FROM_PROTO.get(action)


def org_role_to_proto(role: DomainOrgRole) -> ProtoOrgRole.ValueType:
    """Convert domain OrganizationRole to proto."""
    return ORG_ROLE_TO_PROTO.get(role, ProtoOrgRole.ORGANIZATION_ROLE_UNSPECIFIED)


def org_role_from_proto(role: ProtoOrgRole.ValueType) -> DomainOrgRole | None:
    """Convert proto OrganizationRole to domain."""
    return ORG_ROLE_FROM_PROTO.get(role)


def group_role_to_proto(role: DomainGroupRole) -> ProtoGroupRole.ValueType:
    """Convert domain GroupRole to proto."""
    return GROUP_ROLE_TO_PROTO.get(role, ProtoGroupRole.GROUP_ROLE_UNSPECIFIED)


def group_role_from_proto(role: ProtoGroupRole.ValueType) -> DomainGroupRole | None:
    """Convert proto GroupRole to domain."""
    return GROUP_ROLE_FROM_PROTO.get(role)


def domain_type_to_proto(dt: DomainDomainType) -> ProtoDomainType.ValueType:
    """Convert domain DomainType to proto."""
    return DOMAIN_TYPE_TO_PROTO.get(dt, ProtoDomainType.DOMAIN_TYPE_UNSPECIFIED)


def domain_type_from_proto(dt: ProtoDomainType.ValueType) -> DomainDomainType | None:
    """Convert proto DomainType to domain."""
    return DOMAIN_TYPE_FROM_PROTO.get(dt)


def domain_admin_info_to_proto(
    da: DomainAdmin,
    user: User,
) -> ProtoDomainAdminInfo:
    """
    Convert DomainAdmin and User to common.v1.DomainAdminInfo proto.

    Parameters
    ----------
    da : DomainAdmin
        Domain admin model instance.
    user : User
        User model instance.

    Returns
    -------
    ProtoDomainAdminInfo
        Common domain admin info proto message.

    """
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
    """Convert datetime to proto Timestamp. Alias for datetime_to_timestamp."""
    return datetime_to_timestamp(dt)


def user_info_to_proto(user: User) -> ProtoUserInfo:
    """
    Convert User model to common.v1.UserInfo proto.

    Parameters
    ----------
    user : User
        User model instance.

    Returns
    -------
    ProtoUserInfo
        Common user info proto message.

    """
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
    """
    Convert Organization model to common.v1.OrganizationInfo proto.

    Parameters
    ----------
    org : Organization
        Organization model instance.

    Returns
    -------
    ProtoOrgInfo
        Common organization info proto message.

    """
    return ProtoOrgInfo(
        id=str(org.id),
        name=org.name,
        slug=org.slug,
        logo_url="",  # TODO: Add logo_url to Organization model
        created_at=datetime_to_timestamp(org.created_at),
        updated_at=datetime_to_timestamp(org.updated_at),
    )


def group_info_to_proto(group: Group, member_count: int = 0) -> ProtoGroupInfo:
    """
    Convert Group model to common.v1.GroupInfo proto.

    Parameters
    ----------
    group : Group
        Group model instance.
    member_count : int
        Number of members in the group.

    Returns
    -------
    ProtoGroupInfo
        Common group info proto message.

    """
    return ProtoGroupInfo(
        id=str(group.id),
        organization_id=str(group.organization_id),
        name=group.name,
        slug=group.slug,
        description=group.description or "",
        is_private=group.is_private,
        is_default=group.is_default,
        member_count=member_count,
        created_at=datetime_to_timestamp(group.created_at),
        updated_at=datetime_to_timestamp(group.updated_at),
    )


def member_info_to_proto(
    user: User,
    membership: OrganizationMember,
) -> ProtoMemberInfo:
    """
    Convert User and OrganizationMember to common.v1.MemberInfo proto.

    Parameters
    ----------
    user : User
        User model instance.
    membership : OrganizationMember
        Membership model instance.

    Returns
    -------
    ProtoMemberInfo
        Common member info proto message.

    """
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
    """
    Convert User and GroupMember to common.v1.GroupMemberInfo proto.

    Parameters
    ----------
    user : User
        User model instance.
    membership : GroupMember
        Group membership model instance.

    Returns
    -------
    ProtoGroupMemberInfo
        Common group member info proto message.

    """
    return ProtoGroupMemberInfo(
        user_id=str(user.id),
        display_name=user.full_name or user.username,
        email=user.email,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        role=group_role_to_proto(membership.role),
        joined_at=datetime_to_timestamp(membership.joined_at),
    )
