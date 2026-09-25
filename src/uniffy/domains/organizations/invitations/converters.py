"""Proto <-> domain converters for invitations."""

from datetime import UTC, datetime

from uniffy_proto.organizations.v1.organizations_pb import (
    Invitation as InvitationProto,
)
from uniffy_proto.organizations.v1.organizations_pb import (
    InvitationStatus,
)

from uniffy.core.converters import datetime_to_timestamp, org_role_to_proto
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.user import User


def derive_status(invitation: Invitation) -> InvitationStatus:
    """Compute the public ``InvitationStatus`` for a row."""
    if invitation.accepted_at is not None:
        return InvitationStatus.ACCEPTED
    if invitation.revoked_at is not None:
        return InvitationStatus.REVOKED
    if invitation.expires_at < datetime.now(UTC):
        return InvitationStatus.EXPIRED
    return InvitationStatus.PENDING


def _inviter_name(user: User | None) -> str | None:
    if user is None:
        return None
    return user.full_name or user.username or user.email


def invitation_to_proto(
    invitation: Invitation,
    inviter: User | None,
) -> InvitationProto:
    """Build the public ``Invitation`` proto from a row + its inviter user."""
    proto = InvitationProto(
        id=str(invitation.id),
        organization_id=str(invitation.organization_id),
        email=invitation.email,
        role=org_role_to_proto(invitation.role),
        expires_at=datetime_to_timestamp(invitation.expires_at),
        created_at=datetime_to_timestamp(invitation.created_at),
        status=derive_status(invitation),
    )
    if invitation.accepted_at is not None:
        proto.accepted_at = datetime_to_timestamp(invitation.accepted_at)
    if invitation.revoked_at is not None:
        proto.revoked_at = datetime_to_timestamp(invitation.revoked_at)
    proto.invited_by_user_id = str(invitation.invited_by_user_id)
    label = _inviter_name(inviter)
    if label:
        proto.invited_by_display_name = label
    return proto
