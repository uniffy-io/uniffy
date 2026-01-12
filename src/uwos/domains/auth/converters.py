"""Proto <-> domain converters for auth domain."""

from uwos.core.models.login.group import Group
from uwos.core.models.login.group_member import GroupMember
from uwos.core.models.login.organization import Organization
from uwos.core.models.login.organization_member import OrganizationMember
from uwos.core.models.login.user import User
from uwos.gen.auth.v1.auth_pb2 import (
    AdminOrganizationInfo,
    AdminUserOrganizationInfo,
    GroupInfo,
    GroupMemberInfo,
    OrganizationInfo,
    UserInfoResponse,
)


def user_to_proto(user: User) -> UserInfoResponse:
    """
    Convert User model to proto UserInfoResponse.

    Parameters
    ----------
    user : User
        User model instance.

    Returns
    -------
    UserInfoResponse
        Proto message.

    """
    return UserInfoResponse(
        id=str(user.id),
        email=user.email,
        username=user.username,
        full_name=user.full_name or "",
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        email_verified=user.email_verified,
        accent_color=user.accent_color or "",
        font_family=user.font_family or "",
    )


def organization_to_proto(
    org: Organization,
    membership: OrganizationMember | None = None,
) -> OrganizationInfo:
    """
    Convert Organization model to proto OrganizationInfo.

    Parameters
    ----------
    org : Organization
        Organization model instance.
    membership : OrganizationMember | None
        Optional membership for role info.

    Returns
    -------
    OrganizationInfo
        Proto message.

    """
    return OrganizationInfo(
        id=str(org.id),
        name=org.name,
        slug=org.slug,
        role=membership.role.value if membership else "",
    )


def organization_to_admin_proto(
    org: Organization,
    member_count: int = 0,
) -> AdminOrganizationInfo:
    """
    Convert Organization to admin proto with member count.

    Parameters
    ----------
    org : Organization
        Organization model instance.
    member_count : int
        Number of members.

    Returns
    -------
    AdminOrganizationInfo
        Proto message.

    """
    return AdminOrganizationInfo(
        id=str(org.id),
        name=org.name,
        slug=org.slug,
        domain=org.domain or "",
        plan=org.plan,
        is_active=org.is_active,
        created_at=org.created_at.isoformat(),
        member_count=member_count,
    )


def membership_to_admin_proto(
    org: Organization,
    membership: OrganizationMember,
) -> AdminUserOrganizationInfo:
    """
    Convert membership to admin proto.

    Parameters
    ----------
    org : Organization
        Organization model.
    membership : OrganizationMember
        Membership model.

    Returns
    -------
    AdminUserOrganizationInfo
        Proto message.

    """
    return AdminUserOrganizationInfo(
        organization_id=str(org.id),
        name=org.name,
        slug=org.slug,
        role=membership.role.value,
        is_active=membership.is_active,
        joined_at=membership.joined_at.isoformat(),
    )


def group_to_proto(group: Group, member_count: int = 0) -> GroupInfo:
    """
    Convert Group model to proto GroupInfo.

    Parameters
    ----------
    group : Group
        Group model instance.
    member_count : int
        Number of members.

    Returns
    -------
    GroupInfo
        Proto message.

    """
    return GroupInfo(
        id=str(group.id),
        organization_id=str(group.organization_id),
        name=group.name,
        slug=group.slug,
        description=group.description or "",
        is_private=group.is_private,
        is_default=group.is_default,
        created_at=group.created_at.isoformat(),
        member_count=member_count,
    )


def group_member_to_proto(
    member: GroupMember,
    user: User,
) -> GroupMemberInfo:
    """
    Convert GroupMember to proto.

    Parameters
    ----------
    member : GroupMember
        Membership model.
    user : User
        User model.

    Returns
    -------
    GroupMemberInfo
        Proto message.

    """
    return GroupMemberInfo(
        user_id=str(user.id),
        email=user.email,
        username=user.username,
        full_name=user.full_name or "",
        role=member.role.value,
        joined_at=member.joined_at.isoformat(),
    )
