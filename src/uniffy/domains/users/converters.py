"""Proto <-> domain converters for users domain."""

from uniffy.core.converters import datetime_to_timestamp, org_info_to_proto, org_role_to_proto
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.gen.users.v1.users_pb2 import UserOrganizationMembership, UserProfile


def user_to_profile(user: User) -> UserProfile:
    """
    Convert User model to UserProfile proto.

    Parameters
    ----------
    user : User
        User model instance.

    Returns
    -------
    UserProfile
        Proto message.

    """
    return UserProfile(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name or "",
        username=user.username,
        avatar_url="",
        accent_color=user.accent_color or "",
        font_family=user.font_family or "",
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        created_at=datetime_to_timestamp(user.created_at),
        updated_at=datetime_to_timestamp(user.updated_at),
    )


def membership_to_proto(
    org: Organization,
    membership: OrganizationMember,
) -> UserOrganizationMembership:
    """
    Convert Organization and OrganizationMember to UserOrganizationMembership proto.

    Parameters
    ----------
    org : Organization
        Organization model instance.
    membership : OrganizationMember
        Membership model instance.

    Returns
    -------
    UserOrganizationMembership
        Proto message.

    """
    return UserOrganizationMembership(
        organization=org_info_to_proto(org),
        role=org_role_to_proto(membership.role),
        joined_at=datetime_to_timestamp(membership.joined_at),
        is_active=membership.is_active,
    )
