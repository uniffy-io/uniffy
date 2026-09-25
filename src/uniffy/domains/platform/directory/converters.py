"""Proto <-> domain mapping for ``superadmin.v1`` directory services."""

from __future__ import annotations

from datetime import datetime

from protobuf.wkt import Timestamp
from uniffy_proto.superadmin.v1.system_directory_pb import (
    PlatformOrganizationDetail as PlatformOrganizationDetailProto,
)
from uniffy_proto.superadmin.v1.system_directory_pb import (
    PlatformOrganizationSummary as PlatformOrganizationSummaryProto,
)
from uniffy_proto.superadmin.v1.system_directory_pb import (
    PlatformOrgOwner as PlatformOrgOwnerProto,
)
from uniffy_proto.superadmin.v1.system_directory_pb import (
    PlatformUserDetail as PlatformUserDetailProto,
)
from uniffy_proto.superadmin.v1.system_directory_pb import (
    PlatformUserMembership as PlatformUserMembershipProto,
)
from uniffy_proto.superadmin.v1.system_directory_pb import (
    PlatformUserSummary as PlatformUserSummaryProto,
)

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.domains.platform.directory.operations import (
    PlatformOrgDetail,
    PlatformOrgOwner,
    PlatformOrgSummary,
    PlatformUserDetail,
    PlatformUserMembership,
    PlatformUserSummary,
)


def _to_timestamp(value: datetime | None) -> Timestamp | None:
    if value is None:
        return None
    ts = Timestamp()
    ts = datetime_to_timestamp(value)
    return ts


def org_summary_to_proto(summary: PlatformOrgSummary) -> PlatformOrganizationSummaryProto:
    msg = PlatformOrganizationSummaryProto(
        id=str(summary.id),
        name=summary.name,
        slug=summary.slug,
        plan=summary.plan,
        member_count=summary.member_count,
        mail_config_source=summary.mail_config_source,
        encryption_version=summary.encryption_version,
        is_suspended=summary.is_suspended,
    )
    last_activity = _to_timestamp(summary.last_activity_at)
    if last_activity is not None:
        msg.last_activity_at = last_activity
    last_login = _to_timestamp(summary.last_login_at)
    if last_login is not None:
        msg.last_login_at = last_login
    deleted_at = _to_timestamp(summary.deleted_at)
    if deleted_at is not None:
        msg.deleted_at = deleted_at
    purge_at = _to_timestamp(summary.purge_at)
    if purge_at is not None:
        msg.purge_at = purge_at
    created_at = _to_timestamp(summary.created_at)
    if created_at is not None:
        msg.created_at = created_at
    return msg


def owner_to_proto(owner: PlatformOrgOwner) -> PlatformOrgOwnerProto:
    msg = PlatformOrgOwnerProto(
        user_id=str(owner.user_id),
        email=owner.email,
    )
    if owner.full_name is not None:
        msg.full_name = owner.full_name
    joined_at = _to_timestamp(owner.joined_at)
    if joined_at is not None:
        msg.joined_at = joined_at
    return msg


def org_detail_to_proto(detail: PlatformOrgDetail) -> PlatformOrganizationDetailProto:
    msg = PlatformOrganizationDetailProto(
        summary=org_summary_to_proto(detail.summary),
        domain=detail.domain or "",
        logo_url=detail.logo_url or "",
        owners=[owner_to_proto(o) for o in detail.owners],
    )
    if detail.suspension_reason is not None:
        msg.suspension_reason = detail.suspension_reason
    if detail.deletion_reason is not None:
        msg.deletion_reason = detail.deletion_reason
    if detail.max_members is not None:
        msg.max_members = detail.max_members
    return msg


def user_summary_to_proto(summary: PlatformUserSummary) -> PlatformUserSummaryProto:
    msg = PlatformUserSummaryProto(
        id=str(summary.id),
        email=summary.email,
        username=summary.username,
        is_active=summary.is_active,
        is_system_admin=summary.is_system_admin,
        email_verified=summary.email_verified,
        mfa_enabled=summary.mfa_enabled,
        org_memberships_count=summary.org_memberships_count,
    )
    if summary.full_name is not None:
        msg.full_name = summary.full_name
    last_login = _to_timestamp(summary.last_login_at)
    if last_login is not None:
        msg.last_login_at = last_login
    created_at = _to_timestamp(summary.created_at)
    if created_at is not None:
        msg.created_at = created_at
    return msg


def user_membership_to_proto(
    membership: PlatformUserMembership,
) -> PlatformUserMembershipProto:
    msg = PlatformUserMembershipProto(
        organization_id=str(membership.organization_id),
        organization_name=membership.organization_name,
        organization_slug=membership.organization_slug,
        role=membership.role,
        is_active=membership.is_active,
        is_suspended=membership.is_suspended,
    )
    joined_at = _to_timestamp(membership.joined_at)
    if joined_at is not None:
        msg.joined_at = joined_at
    deleted_at = _to_timestamp(membership.deleted_at)
    if deleted_at is not None:
        msg.deleted_at = deleted_at
    return msg


def user_detail_to_proto(detail: PlatformUserDetail) -> PlatformUserDetailProto:
    return PlatformUserDetailProto(
        summary=user_summary_to_proto(detail.summary),
        memberships=[user_membership_to_proto(m) for m in detail.memberships],
    )
