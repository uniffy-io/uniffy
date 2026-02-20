"""
Common proto converters for shared enums and messages.

Provides bidirectional mapping between domain enums/models and common.v1 proto types.
"""

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.group_member import GroupRole as DomainGroupRole
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.organization_member import OrganizationRole as DomainOrgRole
from uniffy.core.models.login.user import User
from uniffy.core.models.shared import ContentType as DomainContentType
from uniffy.core.models.shared import PermissionLevel as DomainPermissionLevel
from uniffy.core.models.shared import SubjectType as DomainSubjectType
from uniffy.core.models.shared import VisibilityScope as DomainVisibilityScope
from uniffy.domains.users.avatars import get_avatar_url
from uniffy.gen.common.v1.common_pb2 import (
    ContentType as ProtoContentType,
)
from uniffy.gen.common.v1.common_pb2 import (
    GroupInfo as ProtoGroupInfo,
)
from uniffy.gen.common.v1.common_pb2 import (
    GroupMemberInfo as ProtoGroupMemberInfo,
)
from uniffy.gen.common.v1.common_pb2 import (
    GroupRole as ProtoGroupRole,
)
from uniffy.gen.common.v1.common_pb2 import (
    MemberInfo as ProtoMemberInfo,
)
from uniffy.gen.common.v1.common_pb2 import (
    OrganizationInfo as ProtoOrgInfo,
)
from uniffy.gen.common.v1.common_pb2 import (
    OrganizationRole as ProtoOrgRole,
)
from uniffy.gen.common.v1.common_pb2 import (
    PermissionLevel as ProtoPermissionLevel,
)
from uniffy.gen.common.v1.common_pb2 import (
    SubjectType as ProtoSubjectType,
)
from uniffy.gen.common.v1.common_pb2 import (
    UserInfo as ProtoUserInfo,
)
from uniffy.gen.common.v1.common_pb2 import (
    VisibilityScope as ProtoVisibilityScope,
)

# ContentType mappings
CONTENT_TYPE_TO_PROTO: dict[DomainContentType, ProtoContentType.ValueType] = {
    DomainContentType.NOTE: ProtoContentType.CONTENT_TYPE_NOTE,
    DomainContentType.FILE: ProtoContentType.CONTENT_TYPE_FILE,
    DomainContentType.CALENDAR_EVENT: ProtoContentType.CONTENT_TYPE_CALENDAR_EVENT,
    DomainContentType.CHAT_MESSAGE: ProtoContentType.CONTENT_TYPE_CHAT_MESSAGE,
    DomainContentType.USER: ProtoContentType.CONTENT_TYPE_USER,
    DomainContentType.PROJECT: ProtoContentType.CONTENT_TYPE_PROJECT,
    DomainContentType.TASK: ProtoContentType.CONTENT_TYPE_TASK,
}

CONTENT_TYPE_FROM_PROTO: dict[ProtoContentType.ValueType, DomainContentType] = {
    v: k for k, v in CONTENT_TYPE_TO_PROTO.items()
}

# SubjectType mappings
SUBJECT_TYPE_TO_PROTO: dict[DomainSubjectType, ProtoSubjectType.ValueType] = {
    DomainSubjectType.USER: ProtoSubjectType.SUBJECT_TYPE_USER,
    DomainSubjectType.GROUP: ProtoSubjectType.SUBJECT_TYPE_GROUP,
    DomainSubjectType.ORGANIZATION: ProtoSubjectType.SUBJECT_TYPE_ORGANIZATION,
}

SUBJECT_TYPE_FROM_PROTO: dict[ProtoSubjectType.ValueType, DomainSubjectType] = {
    v: k for k, v in SUBJECT_TYPE_TO_PROTO.items()
}

# PermissionLevel mappings
PERMISSION_LEVEL_TO_PROTO: dict[DomainPermissionLevel, ProtoPermissionLevel.ValueType] = {
    DomainPermissionLevel.VIEW: ProtoPermissionLevel.PERMISSION_LEVEL_VIEW,
    DomainPermissionLevel.EDIT: ProtoPermissionLevel.PERMISSION_LEVEL_EDIT,
    DomainPermissionLevel.ADMIN: ProtoPermissionLevel.PERMISSION_LEVEL_ADMIN,
    DomainPermissionLevel.OWNER: ProtoPermissionLevel.PERMISSION_LEVEL_ADMIN,
}

PERMISSION_LEVEL_FROM_PROTO: dict[ProtoPermissionLevel.ValueType, DomainPermissionLevel] = {
    v: k for k, v in PERMISSION_LEVEL_TO_PROTO.items()
}

# VisibilityScope mappings
VISIBILITY_TO_PROTO: dict[DomainVisibilityScope, ProtoVisibilityScope.ValueType] = {
    DomainVisibilityScope.PRIVATE: ProtoVisibilityScope.VISIBILITY_SCOPE_PRIVATE,
    DomainVisibilityScope.GROUP: ProtoVisibilityScope.VISIBILITY_SCOPE_GROUP,
    DomainVisibilityScope.ORGANIZATION: ProtoVisibilityScope.VISIBILITY_SCOPE_ORGANIZATION,
}

VISIBILITY_FROM_PROTO: dict[ProtoVisibilityScope.ValueType, DomainVisibilityScope] = {
    v: k for k, v in VISIBILITY_TO_PROTO.items()
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


def permission_level_to_proto(pl: DomainPermissionLevel) -> ProtoPermissionLevel.ValueType:
    """Convert domain PermissionLevel to proto."""
    return PERMISSION_LEVEL_TO_PROTO.get(pl, ProtoPermissionLevel.PERMISSION_LEVEL_UNSPECIFIED)


def permission_level_from_proto(pl: ProtoPermissionLevel.ValueType) -> DomainPermissionLevel | None:
    """Convert proto PermissionLevel to domain."""
    return PERMISSION_LEVEL_FROM_PROTO.get(pl)


def visibility_to_proto(vs: DomainVisibilityScope) -> ProtoVisibilityScope.ValueType:
    """Convert domain VisibilityScope to proto."""
    return VISIBILITY_TO_PROTO.get(vs, ProtoVisibilityScope.VISIBILITY_SCOPE_UNSPECIFIED)


def visibility_from_proto(vs: ProtoVisibilityScope.ValueType) -> DomainVisibilityScope | None:
    """Convert proto VisibilityScope to domain."""
    return VISIBILITY_FROM_PROTO.get(vs)


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
