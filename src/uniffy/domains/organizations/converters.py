"""Proto <-> domain converters for organizations domain."""

from uniffy_proto.organizations.v1.organizations_pb2 import (
    ContentTypeCount,
    ContentTypeDefaults,
    MyOrganization,
    OrganizationDetail,
    OrganizationOverview,
)

from uniffy.core.converters import (
    content_type_to_proto,
    datetime_to_timestamp,
    member_info_to_proto,
    org_info_to_proto,
    org_role_to_proto,
    visibility_to_proto,
)
from uniffy.core.models import Organization, OrganizationPermissionDefaults
from uniffy.core.models.login.organization_member import OrganizationMember


def my_organization_to_proto(
    org: Organization,
    membership: OrganizationMember,
) -> MyOrganization:
    """
    Convert Organization and membership to MyOrganization proto.

    Parameters
    ----------
    org : Organization
        Organization model instance.
    membership : OrganizationMember
        User's membership in the organization.

    Returns
    -------
    MyOrganization
        Proto message.

    """
    return MyOrganization(
        organization=org_info_to_proto(org),
        role=org_role_to_proto(membership.role),
        joined_at=datetime_to_timestamp(membership.joined_at),
    )


def organization_detail_to_proto(
    org: Organization,
    member_count: int = 0,
    group_count: int = 0,
) -> OrganizationDetail:
    """
    Convert Organization to OrganizationDetail proto.

    Parameters
    ----------
    org : Organization
        Organization model instance.
    member_count : int
        Number of members.
    group_count : int
        Number of groups.

    Returns
    -------
    OrganizationDetail
        Proto message.

    """
    return OrganizationDetail(
        organization=org_info_to_proto(org),
        member_count=member_count,
        group_count=group_count,
        is_active=org.is_active,
    )


def organization_overview_to_proto(
    org: Organization,
    member_count: int,
    group_count: int,
    content_counts: list[tuple[str, int]] | None = None,
) -> OrganizationOverview:
    """
    Convert organization data to OrganizationOverview proto.

    Parameters
    ----------
    org : Organization
        Organization model instance.
    member_count : int
        Number of members.
    group_count : int
        Number of groups.
    content_counts : list[tuple[str, int]] | None
        Optional list of (content_type, count) tuples.

    Returns
    -------
    OrganizationOverview
        Proto message.

    """
    proto_content_counts = []
    if content_counts:
        for ct_name, count in content_counts:
            from uniffy.core.models.shared import ContentType

            try:
                ct = ContentType(ct_name)
                proto_content_counts.append(
                    ContentTypeCount(
                        content_type=content_type_to_proto(ct),
                        count=count,
                    )
                )
            except ValueError:
                pass

    return OrganizationOverview(
        organization=org_info_to_proto(org),
        member_count=member_count,
        group_count=group_count,
        content_counts=proto_content_counts,
    )


def permission_defaults_to_proto(
    defaults: OrganizationPermissionDefaults,
) -> ContentTypeDefaults:
    """
    Convert OrganizationPermissionDefaults to ContentTypeDefaults proto.

    Parameters
    ----------
    defaults : OrganizationPermissionDefaults
        Permission defaults model instance.

    Returns
    -------
    ContentTypeDefaults
        Proto message.

    """
    return ContentTypeDefaults(
        content_type=content_type_to_proto(defaults.content_type),
        default_visibility=visibility_to_proto(defaults.default_visibility),
        members_can_view=defaults.members_can_view,
        members_can_edit=defaults.members_can_edit,
        members_can_delete=defaults.members_can_delete,
        members_can_share=defaults.members_can_share,
        updated_at=datetime_to_timestamp(defaults.updated_at),
    )


# Re-export from core converters for convenience
__all__ = [
    "my_organization_to_proto",
    "organization_detail_to_proto",
    "organization_overview_to_proto",
    "permission_defaults_to_proto",
    "member_info_to_proto",
    "org_info_to_proto",
]
