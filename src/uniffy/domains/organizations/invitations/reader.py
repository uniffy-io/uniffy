"""Read side of invitations: the token preview, the admin list and the recipient's pending list."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import NamedTuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.audit import client_ip_for_rate_limit
from uniffy.core.auth.emails import normalize_email
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.user import User
from uniffy.core.rate_limit import check_rate_limit
from uniffy.domains.organizations.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationRevokedError,
)
from uniffy.domains.organizations.operations import OrganizationOperations

# Preview is unauthenticated and just confirms a token resolves to an
# email + org. The per-token-hash bucket is the load-bearing one: it
# bounds how many times one specific token can be confirmed, which
# matters when an attacker has somehow seen the token (mail log,
# referrer) but is not sure it is still valid. Per-IP is best-effort
# and skipped when IP is not trustable (proxy without TRUSTED_PROXY_HOPS).
INVITE_PREVIEW_LIMIT_IP = 60
INVITE_PREVIEW_LIMIT_TOKEN = 10
INVITE_PREVIEW_WINDOW_SECONDS = 15 * 60


@dataclass(frozen=True)
class InvitationPreview:
    """Public shape of an invitation before the user clicks Accept."""

    invitation: Invitation
    organization: Organization
    inviter_display_name: str | None
    account_exists: bool


class MyInvitationRow(NamedTuple):
    invitation: Invitation
    organization: Organization
    inviter: User | None


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def inviter_label(inviter: User | None) -> str:
    if inviter is None:
        return "A teammate"
    return inviter.full_name or inviter.username or inviter.email


def require_pending(invitation: Invitation) -> None:
    if invitation.revoked_at is not None:
        raise InvitationRevokedError("Invitation has been revoked")
    if invitation.accepted_at is not None:
        raise InvitationAlreadyUsedError("Invitation has already been accepted")
    if invitation.expires_at < datetime.now(UTC):
        raise InvitationExpiredError("Invitation has expired")


class InvitationReader:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_for_token(self, raw_token: str) -> InvitationPreview:
        """Return invitation + org for the accept-page preview.

        The token bucket stops someone who has seen the raw token from confirming
        it over and over; the IP bucket bounds spray from one trusted client.
        """
        token_hash_for_bucket = hash_token(raw_token)
        await check_rate_limit(
            key=f"rl:invite:preview:token:{token_hash_for_bucket}",
            limit=INVITE_PREVIEW_LIMIT_TOKEN,
            window_seconds=INVITE_PREVIEW_WINDOW_SECONDS,
            resource="invitation preview attempts (per token)",
        )
        rate_limit_ip = client_ip_for_rate_limit()
        if rate_limit_ip:
            await check_rate_limit(
                key=f"rl:invite:preview:ip:{rate_limit_ip}",
                limit=INVITE_PREVIEW_LIMIT_IP,
                window_seconds=INVITE_PREVIEW_WINDOW_SECONDS,
                resource="invitation preview attempts (per ip)",
            )
        invitation = await self._load_by_token(raw_token)
        org = await self._require_joinable_organization(invitation.organization_id)
        inviter = (
            await self._session.execute(select(User).where(User.id == invitation.invited_by_user_id))
        ).scalar_one_or_none()
        # Only the token holder sees this, and they already know the address.
        return InvitationPreview(
            invitation=invitation,
            organization=org,
            inviter_display_name=inviter_label(inviter),
            account_exists=await self._account_id_for(invitation.email) is not None,
        )

    async def list_for_org(
        self,
        org_id: UUID,
        actor_id: UUID,
    ) -> list[tuple[Invitation, User | None]]:
        # Outer-joins inviter so rows survive when the inviting user is deleted.
        org_ops = OrganizationOperations(self._session)
        await org_ops.require_org_admin(actor_id, org_id)
        result = await self._session.execute(
            select(Invitation, User)
            .outerjoin(User, User.id == Invitation.invited_by_user_id)
            .where(Invitation.organization_id == org_id)
            .order_by(Invitation.created_at.desc())
        )
        return [(row[0], row[1]) for row in result.all()]

    async def list_for_user(self, user_id: UUID) -> list[MyInvitationRow]:
        """Pending invitations addressed to the caller's email in organizations that still exist."""
        recipient = aliased(User)
        inviter = aliased(User)
        result = await self._session.execute(
            select(Invitation, Organization, inviter)
            .join(
                recipient,
                (recipient.id == user_id)
                & recipient.is_active.is_(True)
                & (recipient.email == Invitation.email),
            )
            .join(Organization, Organization.id == Invitation.organization_id)
            .outerjoin(inviter, inviter.id == Invitation.invited_by_user_id)
            .where(
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
                Invitation.expires_at > datetime.now(UTC),
                Organization.deleted_at.is_(None),
                Organization.is_suspended.is_(False),
            )
            .order_by(Invitation.created_at.desc())
        )
        return [MyInvitationRow(row[0], row[1], row[2]) for row in result.all()]

    async def _account_id_for(self, email: str) -> UUID | None:
        """Active or not: a deactivated account still owns its address."""
        return (
            await self._session.execute(select(User.id).where(User.email == email))
        ).scalar_one_or_none()

    async def _require_joinable_organization(
        self,
        org_id: UUID,
        *,
        for_update: bool = False,
    ) -> Organization:
        statement = select(Organization).where(Organization.id == org_id)
        if for_update:
            # Locked so a suspension racing the accept cannot slip between this check and the join.
            statement = statement.with_for_update()
        organization = (await self._session.execute(statement)).scalar_one_or_none()
        # A deleted organization's pending invitations are unreachable rather than revoked.
        if organization is None or organization.deleted_at is not None:
            raise InvitationNotFoundError("Invitation not found")
        if organization.is_suspended:
            raise PermissionDeniedError("This organization is suspended")
        return organization

    async def _require_active_user(self, user_id: UUID) -> User:
        user = (
            await self._session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            raise PermissionDeniedError("Account is not active")
        return user

    async def _load(self, invitation_id: UUID) -> Invitation:
        result = await self._session.execute(
            select(Invitation).where(Invitation.id == invitation_id)
        )
        invitation = result.scalar_one_or_none()
        if not invitation:
            raise NotFoundError("Invitation", str(invitation_id))
        return invitation

    async def _load_addressed_to(
        self,
        user: User,
        invitation_id: UUID,
        *,
        for_update: bool = False,
    ) -> Invitation:
        # One lookup for both conditions, so a stranger cannot tell a foreign id from a missing one.
        statement = select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.email == normalize_email(user.email),
        )
        if for_update:
            statement = statement.with_for_update()
        invitation = (await self._session.execute(statement)).scalar_one_or_none()
        if invitation is None:
            raise NotFoundError("Invitation", str(invitation_id))
        return invitation

    async def _find_by_token(self, raw_token: str, *, for_update: bool = False) -> Invitation:
        statement = select(Invitation).where(Invitation.token_hash == hash_token(raw_token))
        if for_update:
            statement = statement.with_for_update()
        invitation = (await self._session.execute(statement)).scalar_one_or_none()
        if not invitation:
            raise InvitationNotFoundError("Invitation not found")
        return invitation

    async def _load_by_token(self, raw_token: str, *, for_update: bool = False) -> Invitation:
        invitation = await self._find_by_token(raw_token, for_update=for_update)
        require_pending(invitation)
        return invitation
