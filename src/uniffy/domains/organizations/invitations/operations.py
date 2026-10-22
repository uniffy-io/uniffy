"""Invitation mutations: invite, accept, decline, revoke, resend."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum, StrEnum
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from uniffy.core.audit import client_ip_for_rate_limit, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.emails import normalize_email
from uniffy.core.errors import (
    ConflictError,
    InvitationSignInRequiredError,
    PermissionDeniedError,
    ValidationError,
)
from uniffy.core.jobs import enqueue_job
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationMemberSource,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.rate_limit import check_rate_limit
from uniffy.core.search import SearchIndexer
from uniffy.domains.auth.contracts import stage_invitation_authentication, stage_invited_user
from uniffy.domains.auth.types import AuthResult, MfaEnrollmentRequired
from uniffy.domains.mail.jobs.contracts import SEND_EMAIL
from uniffy.domains.organizations.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationRevokedError,
)
from uniffy.domains.organizations.invitations.reader import (
    InvitationReader,
    hash_token,
    inviter_label,
    require_pending,
)
from uniffy.domains.organizations.operations import OrganizationOperations

logger = logger.bind(component="organizations.invitations.operations")

# Loose per-IP + per-token caps. The token is high-entropy so the IP bucket
# is mostly there to bound credential-stuffing scripts; the token bucket
# stops a single leaked token from being used to spray bad passwords.
INVITE_ACCEPT_LIMIT_IP = 30
INVITE_ACCEPT_LIMIT_TOKEN = 5
INVITE_ACCEPT_WINDOW_SECONDS = 15 * 60


_INVITATION_TTL = timedelta(days=30)
_TEMPLATE_INVITATION = "auth/invitation"


class InviteOutcome(str, Enum):
    INVITED = "invited"


class AcceptVia(StrEnum):
    """How a signed-in member proved the invitation is theirs."""

    TOKEN = "token"
    ID = "id"


@dataclass(frozen=True)
class InviteResult:
    outcome: InviteOutcome
    invitation: Invitation


def _frontend_base_url() -> str:
    return os.getenv("UNIFFY_BASE_URL", "http://localhost:5173").rstrip("/")


def _accept_url(raw_token: str) -> str:
    return f"{_frontend_base_url()}/auth/accept-invite?token={raw_token}"


class InvitationOperations(InvitationReader):
    async def invite(
        self,
        org_id: UUID,
        email: str,
        role: OrganizationRole,
        inviter_id: UUID,
    ) -> InviteResult:
        """Invite any address except an active member's; account holders accept signed in."""
        normalized = normalize_email(email)
        if not normalized or "@" not in normalized:  # noqa: PLR2004
            raise ValueError("Invalid email address")

        org_ops = OrganizationOperations(self._session)
        await org_ops.require_org_admin(inviter_id, org_id)
        org = await org_ops.get_by_id(org_id)
        inviter = (
            await self._session.execute(select(User).where(User.id == inviter_id))
        ).scalar_one_or_none()
        account_id = await self._account_id_for(normalized)
        if account_id is not None:
            # Checked before the revoke below, so a refused invite leaves earlier invitations alone.
            membership = await org_ops.get_membership(account_id, org_id)
            if membership is not None and membership.is_active:
                raise ConflictError(
                    "Organization member", "This person is already a member of the organization"
                )

        await self._revoke_pending_for_email(org_id, normalized, inviter_id)
        await self._session.flush()

        raw_token = secrets.token_urlsafe(32)
        invitation = Invitation(
            organization_id=org_id,
            email=normalized,
            role=role,
            invited_by_user_id=inviter_id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.now(UTC) + _INVITATION_TTL,
        )
        self._session.add(invitation)
        try:
            await self._session.flush()
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=inviter_id,
                action=Action.ORGANIZATION_MEMBER_INVITED,
                resource_type=AuditResourceType.INVITATION,
                resource_id=invitation.id,
                details={
                    "email": normalized,
                    "role": role.value,
                    "expires_at": invitation.expires_at.isoformat(),
                    "account_exists": account_id is not None,
                },
            )
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError("A pending invitation already exists for this email") from exc
        except Exception:
            await self._session.rollback()
            raise
        await self._session.refresh(invitation)

        await self._enqueue_invitation_email(
            recipient=normalized,
            raw_token=raw_token,
            org=org,
            inviter=inviter,
            role=role,
        )

        return InviteResult(outcome=InviteOutcome.INVITED, invitation=invitation)

    async def revoke(self, invitation_id: UUID, actor_id: UUID) -> Invitation:
        """Mark an invitation revoked. Idempotent for already-revoked rows."""
        invitation = await self._load(invitation_id)
        org_ops = OrganizationOperations(self._session)
        await org_ops.require_org_admin(actor_id, invitation.organization_id)
        if invitation.accepted_at is not None:
            raise InvitationAlreadyUsedError("Invitation has already been accepted")
        if invitation.revoked_at is None:
            invitation.revoked_at = datetime.now(UTC)
            invitation.revoked_by_user_id = actor_id
            invitation.updated_at = datetime.now(UTC)
            await write_audit_event(
                self._session,
                organization_id=invitation.organization_id,
                actor_user_id=actor_id,
                action=Action.ORGANIZATION_INVITATION_REVOKED,
                resource_type=AuditResourceType.INVITATION,
                resource_id=invitation.id,
                details={"email": invitation.email},
            )
            await self._session.commit()
            await self._session.refresh(invitation)
        return invitation

    async def resend(self, invitation_id: UUID, actor_id: UUID) -> Invitation:
        """Regenerate the token + extend ``expires_at`` + re-enqueue the email."""
        invitation = await self._load(invitation_id)
        org_ops = OrganizationOperations(self._session)
        await org_ops.require_org_admin(actor_id, invitation.organization_id)
        if invitation.accepted_at is not None:
            raise InvitationAlreadyUsedError("Invitation has already been accepted")
        if invitation.revoked_at is not None:
            raise InvitationRevokedError("Invitation has been revoked")

        raw_token = secrets.token_urlsafe(32)
        invitation.token_hash = hash_token(raw_token)
        invitation.expires_at = datetime.now(UTC) + _INVITATION_TTL
        invitation.updated_at = datetime.now(UTC)

        org = await org_ops.get_by_id(invitation.organization_id)
        inviter = (
            await self._session.execute(select(User).where(User.id == actor_id))
        ).scalar_one_or_none()

        await write_audit_event(
            self._session,
            organization_id=invitation.organization_id,
            actor_user_id=actor_id,
            action=Action.ORGANIZATION_INVITATION_RESENT,
            resource_type=AuditResourceType.INVITATION,
            resource_id=invitation.id,
            details={
                "email": invitation.email,
                "expires_at": invitation.expires_at.isoformat(),
            },
        )
        await self._session.commit()
        await self._session.refresh(invitation)

        await self._enqueue_invitation_email(
            recipient=invitation.email,
            raw_token=raw_token,
            org=org,
            inviter=inviter,
            role=invitation.role,
        )
        return invitation

    async def accept(
        self,
        raw_token: str,
        username: str,
        password: str,
        full_name: str | None,
        user_agent: str,
        *,
        search_indexer: SearchIndexer,
    ) -> AuthResult | MfaEnrollmentRequired:
        """Create the invited account from ``raw_token`` and sign it in.

        Email always comes from the invitation row, never the client. An address that
        already has an account accepts signed in through ``accept_as_member``.
        """
        rate_limit_ip = client_ip_for_rate_limit()
        if rate_limit_ip:
            await check_rate_limit(
                key=f"rl:invite:accept:ip:{rate_limit_ip}",
                limit=INVITE_ACCEPT_LIMIT_IP,
                window_seconds=INVITE_ACCEPT_WINDOW_SECONDS,
                resource="invitation accept attempts (per ip)",
            )
        token_hash_for_bucket = hash_token(raw_token)
        await check_rate_limit(
            key=f"rl:invite:accept:token:{token_hash_for_bucket}",
            limit=INVITE_ACCEPT_LIMIT_TOKEN,
            window_seconds=INVITE_ACCEPT_WINDOW_SECONDS,
            resource="invitation accept attempts (per token)",
        )
        try:
            invitation = await self._load_by_token(raw_token, for_update=True)
            await self._require_joinable_organization(invitation.organization_id, for_update=True)
            # Inactive accounts too: only a platform operator reopens a deactivated account,
            # and that person then meets the ordinary sign-in refusal.
            if await self._account_id_for(invitation.email) is not None:
                raise InvitationSignInRequiredError("Sign in to accept this invitation")

            user = await self._stage_account(username, password, full_name, invitation)
            org_ops = OrganizationOperations(self._session)
            staged_membership = await org_ops.stage_member(
                user_id=user.id,
                org_id=invitation.organization_id,
                role=invitation.role,
                actor_user_id=invitation.invited_by_user_id,
                source=OrganizationMemberSource.INVITE,
                invited_by_user_id=invitation.invited_by_user_id,
            )

            invitation.accepted_at = datetime.now(UTC)
            invitation.accepted_by_user_id = user.id
            invitation.updated_at = datetime.now(UTC)

            staged_auth = await stage_invitation_authentication(
                self._session,
                user=user,
                organization_id=invitation.organization_id,
                organization_slug=staged_membership.organization_slug,
                organization_role=invitation.role,
                user_agent=user_agent,
            )
            audit_details: dict[str, Any] = {
                "email": invitation.email,
                "role": invitation.role.value,
            }
            if staged_auth.enrollment_required:
                audit_details["enrollment_required"] = True
            elif staged_auth.session_id is not None:
                audit_details["session_id"] = str(staged_auth.session_id)
            await write_audit_event(
                self._session,
                organization_id=invitation.organization_id,
                actor_user_id=user.id,
                action=Action.AUTH_INVITATION_ACCEPTED,
                resource_type=AuditResourceType.INVITATION,
                resource_id=invitation.id,
                details=audit_details,
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise

        await org_ops.finish_member_add_after_commit(
            staged_membership,
            search_indexer=search_indexer,
        )
        return staged_auth.outcome

    async def accept_as_member(
        self,
        *,
        user_id: UUID,
        token: str | None = None,
        invitation_id: UUID | None = None,
        search_indexer: SearchIndexer,
    ) -> tuple[Organization, OrganizationMember]:
        """Join while signed in; only the token proves control of the mailbox."""
        if (token is None) == (invitation_id is None):
            raise ValidationError("lookup", "Provide an invitation id or a token")
        via = AcceptVia.TOKEN if token is not None else AcceptVia.ID
        org_ops = OrganizationOperations(self._session)
        try:
            user = await self._require_active_user(user_id)
            if token is not None:
                invitation = await self._find_by_token(token, for_update=True)
                if invitation.email != normalize_email(user.email):
                    raise PermissionDeniedError(
                        "This invitation was sent to a different email address"
                    )
            else:
                assert invitation_id is not None
                invitation = await self._load_addressed_to(user, invitation_id, for_update=True)
            require_pending(invitation)
            organization = await self._require_joinable_organization(
                invitation.organization_id, for_update=True
            )

            staged = await org_ops.stage_member(
                user_id=user.id,
                org_id=invitation.organization_id,
                role=invitation.role,
                actor_user_id=invitation.invited_by_user_id,
                source=OrganizationMemberSource.INVITE,
                invited_by_user_id=invitation.invited_by_user_id,
            )
            accepted_at = datetime.now(UTC)
            invitation.accepted_at = accepted_at
            invitation.accepted_by_user_id = user.id
            invitation.updated_at = accepted_at
            if via is AcceptVia.TOKEN:
                user.email_verified = True

            await write_audit_event(
                self._session,
                organization_id=invitation.organization_id,
                actor_user_id=user.id,
                action=Action.AUTH_INVITATION_ACCEPTED,
                resource_type=AuditResourceType.INVITATION,
                resource_id=invitation.id,
                details={
                    "email": invitation.email,
                    "role": invitation.role.value,
                    "signed_in": True,
                    "via": via.value,
                },
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise

        await org_ops.finish_member_add_after_commit(staged, search_indexer=search_indexer)
        return organization, staged.membership

    async def decline(self, *, user_id: UUID, invitation_id: UUID) -> None:
        """Idempotent; an invitation addressed to someone else reads as missing."""
        try:
            user = await self._require_active_user(user_id)
            invitation = await self._load_addressed_to(user, invitation_id, for_update=True)
            if invitation.accepted_at is not None:
                raise InvitationAlreadyUsedError("Invitation has already been accepted")
            if invitation.revoked_at is not None:
                await self._session.rollback()
                return
            declined_at = datetime.now(UTC)
            invitation.revoked_at = declined_at
            invitation.revoked_by_user_id = user.id
            invitation.updated_at = declined_at
            await write_audit_event(
                self._session,
                organization_id=invitation.organization_id,
                actor_user_id=user.id,
                action=Action.ORGANIZATION_INVITATION_DECLINED,
                resource_type=AuditResourceType.INVITATION,
                resource_id=invitation.id,
                details={"email": invitation.email},
            )
            await self._session.commit()
        except Exception:
            await self._session.rollback()
            raise

    async def _stage_account(
        self,
        username: str,
        password: str,
        full_name: str | None,
        invitation: Invitation,
    ) -> User:
        normalized_username = username.strip()
        if not normalized_username:
            raise ValueError("Username is required")
        existing_username = (
            await self._session.execute(select(User).where(User.username == normalized_username))
        ).scalar_one_or_none()
        if existing_username is not None:
            raise ValueError("Username already taken")
        return await stage_invited_user(
            self._session,
            email=invitation.email,
            username=normalized_username,
            password=password,
            full_name=full_name,
        )

    async def _revoke_pending_for_email(
        self,
        org_id: UUID,
        email: str,
        actor_id: UUID,
    ) -> None:
        # Required so the partial unique index does not block a fresh invite.
        result = await self._session.execute(
            select(Invitation).where(
                Invitation.organization_id == org_id,
                Invitation.email == email,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
            )
        )
        for row in result.scalars():
            row.revoked_at = datetime.now(UTC)
            row.revoked_by_user_id = actor_id
            row.updated_at = datetime.now(UTC)

    async def _enqueue_invitation_email(
        self,
        *,
        recipient: str,
        raw_token: str,
        org: Organization,
        inviter: User | None,
        role: OrganizationRole,
    ) -> None:
        context: dict[str, Any] = {
            "inviter_name": inviter_label(inviter),
            "org_name": org.name,
            "accept_url": _accept_url(raw_token),
            "role": role.value,
            "expires_in_days": _INVITATION_TTL.days,
        }
        idempotency = f"invite/{org.id}/{recipient}/{raw_token[:8]}"
        try:
            await enqueue_job(
                SEND_EMAIL,
                recipient,
                _TEMPLATE_INVITATION,
                dumps_str(context),
                organization_id=str(org.id),
                idempotency_key=idempotency,
                user_id=None,
            )
        except RuntimeError:
            logger.warning(
                "invitation email enqueue skipped: core queue not initialised",
                org_id=str(org.id),
            )
