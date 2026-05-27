from uniffy_proto.users.v1.users_pb2 import UserOrganizationMembership, UserProfile

from uniffy.core.converters import datetime_to_timestamp, org_info_to_proto, org_role_to_proto
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.domains.users.avatars import get_avatar_url


def user_to_profile(user: User) -> UserProfile:
    return UserProfile(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name or "",
        username=user.username,
        avatar_url=get_avatar_url(user.id, user.avatar_key),
        accent_color=user.accent_color or "",
        font_family=user.font_family or "",
        is_active=user.is_active,
        is_system_admin=user.is_system_admin,
        created_at=datetime_to_timestamp(user.created_at),
        updated_at=datetime_to_timestamp(user.updated_at),
        has_avatar=user.avatar_key is not None,
    )


def membership_to_proto(
    org: Organization,
    membership: OrganizationMember,
) -> UserOrganizationMembership:
    return UserOrganizationMembership(
        organization=org_info_to_proto(org),
        role=org_role_to_proto(membership.role),
        joined_at=datetime_to_timestamp(membership.joined_at),
        is_active=membership.is_active,
    )
