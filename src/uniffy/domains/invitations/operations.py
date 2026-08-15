"""Invitation operations: invite, accept, revoke, resend."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum
from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from uniffy.domains.auth.types import AuthResult, MfaEnrollmentRequired

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import client_ip_for_rate_limit, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.domain_admin import get_user_domain_admins
from uniffy.core.errors import NotFoundError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.invitation import Invitation
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import (
    OrganizationMember,
    OrganizationRole,
)
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.valkey.queue import QueueName, get_queue
from uniffy.core.valkey.rate_limit import check_rate_limit
from uniffy.domains.invitations.errors import (
    InvitationAlreadyUsedError,
    InvitationEmailConflictError,
    InvitationExpiredError,
    InvitationNotFoundError,
    InvitationRevokedError,
)
from uniffy.workers.tasks import JobName

logger = logger.bind(component="mail")

# Loose per-IP + per-token caps. The token is high-entropy so the IP bucket
# is mostly there to bound credential-stuffing scripts; the token bucket
# stops a single leaked token from being used to spray bad passwords.
INVITE_ACCEPT_LIMIT_IP = 30
INVITE_ACCEPT_LIMIT_TOKEN = 5
INVITE_ACCEPT_WINDOW_SECONDS = 15 * 60

# Preview is unauthenticated and just confirms a token resolves to an
# email + org. The per-token-hash bucket is the load-bearing one: it
# bounds how many times one specific token can be confirmed, which
# matters when an attacker has somehow seen the token (mail log,
# referrer) but is not sure it is still valid. Per-IP is best-effort
# and skipped when IP is not trustable (proxy without TRUSTED_PROXY_HOPS).
INVITE_PREVIEW_LIMIT_IP = 60
INVITE_PREVIEW_LIMIT_TOKEN = 10
INVITE_PREVIEW_WINDOW_SECONDS = 15 * 60


def _get_org_ops_cls():
    # Lazy import: organizations -> handlers -> invitations would close the cycle.
    from uniffy.domains.organizations.operations import OrganizationOperations

    return OrganizationOperations


def _auth_helpers():
    # Lazy import: auth.__init__ re-exports the handlers that import this module.
    from uniffy.domains.auth.context import parse_device_label
    from uniffy.domains.auth.passwords import hash_password
    from uniffy.domains.auth.tokens import create_access_token, create_refresh_token

    return parse_device_label, hash_password, create_access_token, create_refresh_token


_INVITATION_TTL = timedelta(days=30)
_TEMPLATE_INVITATION = "auth/invitation"
_TEMPLATE_ADDED = "auth/added_to_org"


class InviteOutcome(str, Enum):
    """Discriminator for the union returned by ``InvitationOperations.invite``."""

    ADDED = "added"
    INVITED = "invited"


@dataclass(frozen=True)
class InviteResult:
    """Result of ``invite``. Exactly one of ``member`` / ``invitation`` is set."""

    outcome: InviteOutcome
    member: OrganizationMember | None = None
    member_user: User | None = None
    invitation: Invitation | None = None


@dataclass(frozen=True)
class InvitationPreview:
    """Public shape of an invitation before the user clicks Accept."""

    invitation: Invitation
    organization: Organization
    inviter_display_name: str | None


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _frontend_base_url() -> str:
    return os.getenv("UNIFFY_BASE_URL", "http://localhost:5173").rstrip("/")


def _accept_url(raw_token: str) -> str:
    return f"{_frontend_base_url()}/auth/accept-invite?token={raw_token}"


def _inviter_label(inviter: User | None) -> str:
    if inviter is None:
        return "A teammate"
    return inviter.full_name or inviter.username or inviter.email


class InvitationOperations:
    """CRUD + accept flow for ``login_invitations`` rows."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def invite(
        self,
        org_id: UUID,
        email: str,
        role: OrganizationRole,
        inviter_id: UUID,
    ) -> InviteResult:
        """Invite ``email``; auto-promote if user exists, else create a pending row."""
        normalized = email.strip().lower()
        if not normalized or "@" not in normalized:  # noqa: PLR2004
            raise ValueError("Invalid email address")

        org_ops = _get_org_ops_cls()(self._session)
        await org_ops.require_org_admin(inviter_id, org_id)
        org = await org_ops.get_by_id(org_id)
        inviter = (
            await self._session.execute(select(User).where(User.id == inviter_id))
        ).scalar_one_or_none()

        existing = (
            await self._session.execute(select(User).where(User.email == normalized))
        ).scalar_one_or_none()
        if existing and existing.is_active:
            membership = await org_ops.add_member(
                user_id=existing.id,
                org_id=org_id,
                role=role,
                actor_user_id=inviter_id,
            )
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=inviter_id,
                action=Action.ORGANIZATION_MEMBER_ADDED_VIA_INVITE,
                resource_type=AuditResourceType.USER,
                resource_id=existing.id,
                details={"email": normalized, "role": role.value},
            )
            await self._session.commit()
            await self._enqueue_added_email(
                recipient=existing.email,
                user=existing,
                org=org,
                inviter=inviter,
                role=role,
            )
            return InviteResult(
                outcome=InviteOutcome.ADDED,
                member=membership,
                member_user=existing,
            )

        await self._revoke_pending_for_email(org_id, normalized, inviter_id)

        raw_token = secrets.token_urlsafe(32)
        invitation = Invitation(
            organization_id=org_id,
            email=normalized,
            role=role,
            invited_by_user_id=inviter_id,
            token_hash=_hash_token(raw_token),
            expires_at=datetime.now(UTC) + _INVITATION_TTL,
        )
        self._session.add(invitation)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ValueError("A pending invitation already exists for this email") from exc
        await self._session.refresh(invitation)

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
            },
        )
        await self._session.commit()

        await self._enqueue_invitation_email(
            recipient=normalized,
            raw_token=raw_token,
            org=org,
            inviter=inviter,
            role=role,
        )

        return InviteResult(outcome=InviteOutcome.INVITED, invitation=invitation)

    async def list_for_org(
        self,
        org_id: UUID,
        actor_id: UUID,
    ) -> list[tuple[Invitation, User | None]]:
        # Outer-joins inviter so rows survive when the inviting user is deleted.
        org_ops = _get_org_ops_cls()(self._session)
        await org_ops.require_org_admin(actor_id, org_id)
        result = await self._session.execute(
            select(Invitation, User)
            .outerjoin(User, User.id == Invitation.invited_by_user_id)
            .where(Invitation.organization_id == org_id)
            .order_by(Invitation.created_at.desc())
        )
        return [(row[0], row[1]) for row in result.all()]

    async def revoke(self, invitation_id: UUID, actor_id: UUID) -> Invitation:
        """Mark an invitation revoked. Idempotent for already-revoked rows."""
        invitation = await self._load(invitation_id)
        org_ops = _get_org_ops_cls()(self._session)
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
        org_ops = _get_org_ops_cls()(self._session)
        await org_ops.require_org_admin(actor_id, invitation.organization_id)
        if invitation.accepted_at is not None:
            raise InvitationAlreadyUsedError("Invitation has already been accepted")
        if invitation.revoked_at is not None:
            raise InvitationRevokedError("Invitation has been revoked")

        raw_token = secrets.token_urlsafe(32)
        invitation.token_hash = _hash_token(raw_token)
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

    async def get_for_token(self, raw_token: str) -> InvitationPreview:
        """Return invitation + org for the accept-page preview.

        Rate-limited per-token-hash (load-bearing) + per-IP (best-effort,
        skipped on misconfigured proxies). The token bucket prevents an
        attacker who has seen the raw token from confirming its validity
        repeatedly; the IP bucket bounds spray attacks from a single
        trusted client.
        """
        token_hash_for_bucket = _hash_token(raw_token)
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
        org_result = await self._session.execute(
            select(Organization).where(Organization.id == invitation.organization_id)
        )
        org = org_result.scalar_one_or_none()
        if not org:
            raise InvitationNotFoundError("Invitation organization is missing")
        inviter = (
            await self._session.execute(select(User).where(User.id == invitation.invited_by_user_id))
        ).scalar_one_or_none()
        return InvitationPreview(
            invitation=invitation,
            organization=org,
            inviter_display_name=_inviter_label(inviter),
        )

    async def accept(
        self,
        raw_token: str,
        username: str,
        password: str,
        full_name: str | None,
        user_agent: str,
    ) -> AuthResult | MfaEnrollmentRequired:
        """Consume ``raw_token``, create user + membership, return tokens.

        Email is always taken from the invitation row, never the client.
        When the target org or platform enforces MFA, the response is the
        ``MfaEnrollmentRequired`` shape instead of a full ``AuthResult``
        so the client can drive enrollment before the account is usable.
        Rate limited per-IP and per-token to bound brute-force on the
        password field once a token is in hand.
        """
        rate_limit_ip = client_ip_for_rate_limit()
        if rate_limit_ip:
            await check_rate_limit(
                key=f"rl:invite:accept:ip:{rate_limit_ip}",
                limit=INVITE_ACCEPT_LIMIT_IP,
                window_seconds=INVITE_ACCEPT_WINDOW_SECONDS,
                resource="invitation accept attempts (per ip)",
            )
        token_hash_for_bucket = _hash_token(raw_token)
        await check_rate_limit(
            key=f"rl:invite:accept:token:{token_hash_for_bucket}",
            limit=INVITE_ACCEPT_LIMIT_TOKEN,
            window_seconds=INVITE_ACCEPT_WINDOW_SECONDS,
            resource="invitation accept attempts (per token)",
        )
        invitation = await self._load_by_token(raw_token)
        normalized_username = username.strip()
        if not normalized_username:
            raise ValueError("Username is required")
        from uniffy.domains.auth.password_policy import validate_password

        validate_password(password)

        existing_email = (
            await self._session.execute(select(User).where(User.email == invitation.email))
        ).scalar_one_or_none()
        if existing_email is not None:
            raise InvitationEmailConflictError("An account with this email already exists")
        existing_username = (
            await self._session.execute(select(User).where(User.username == normalized_username))
        ).scalar_one_or_none()
        if existing_username is not None:
            raise ValueError("Username already taken")

        from uniffy.domains.auth.types import AuthResult

        parse_device_label, hash_password, create_access_token, create_refresh_token = (
            _auth_helpers()
        )
        user = User(
            email=invitation.email,
            username=normalized_username,
            hashed_password=hash_password(password),
            full_name=full_name,
        )
        self._session.add(user)
        await self._session.commit()
        await self._session.refresh(user)

        org_ops = _get_org_ops_cls()(self._session)
        await org_ops.add_member(
            user_id=user.id,
            org_id=invitation.organization_id,
            role=invitation.role,
            actor_user_id=invitation.invited_by_user_id,
        )

        invitation.accepted_at = datetime.now(UTC)
        invitation.accepted_by_user_id = user.id
        invitation.updated_at = datetime.now(UTC)

        # Org or platform may require MFA before any tenant content is touchable.
        # Issue an enrollment-only token instead of a session in that case so the
        # client can drive the TOTP flow before unlocking the rest of the app.
        from uniffy.domains.auth.mfa.challenge import create_enrollment_only_token
        from uniffy.domains.auth.mfa.enforcement import (
            MfaRequirement,
            evaluate_mfa_requirement,
        )
        from uniffy.domains.auth.types import MfaEnrollmentRequired

        requirement = await evaluate_mfa_requirement(self._session, user=user, user_mfa=None)
        if requirement.requirement == MfaRequirement.HARD_REQUIRED:
            enrollment_token = create_enrollment_only_token(
                user.id,
                organization_id=invitation.organization_id,
                token_version=user.token_version,
            )
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
                    "enrollment_required": True,
                },
            )
            await self._session.commit()
            return MfaEnrollmentRequired(
                enrollment_token=enrollment_token,
                grace_expires_at=None,
            )

        session_record = await self._create_user_session(
            user.id, user_agent, organization_id=invitation.organization_id
        )

        access_token = create_access_token(
            user.id,
            invitation.organization_id,
            token_version=user.token_version,
            session_id=session_record.id,
            full_name=user.full_name,
            avatar_key=user.avatar_key,
        )
        refresh_token = create_refresh_token(
            user.id,
            token_version=user.token_version,
            session_id=session_record.id,
        )
        from uniffy.domains.auth.operations import _hash_refresh_token

        session_record.refresh_token_hash = _hash_refresh_token(refresh_token)

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
                "session_id": str(session_record.id),
            },
        )
        await self._session.commit()
        await self._session.refresh(invitation)

        domain_admins = await get_user_domain_admins(
            self._session, user.id, invitation.organization_id
        )
        org = (
            await self._session.execute(
                select(Organization).where(Organization.id == invitation.organization_id)
            )
        ).scalar_one_or_none()
        return AuthResult(
            access_token=access_token,
            refresh_token=refresh_token,
            user_id=user.id,
            organization_id=invitation.organization_id,
            organization_slug=org.slug if org else None,
            organization_role=invitation.role.value,
            session_id=session_record.id,
            domain_admin_domains=[d.value for d in domain_admins],
        )

    async def _create_user_session(
        self,
        user_id: UUID,
        user_agent: str,
        organization_id: UUID | None = None,
    ) -> UserSession:
        from uniffy.core.audit import audit_ip_var

        parse_device_label, _, _, _ = _auth_helpers()
        device_label = parse_device_label(user_agent)
        record = UserSession(
            user_id=user_id,
            organization_id=organization_id,
            user_agent=user_agent[:512],
            device_label=device_label,
            ip_address=(audit_ip_var.get() or "")[:45],
        )
        self._session.add(record)
        await self._session.commit()
        await self._session.refresh(record)
        return record

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

    async def _load(self, invitation_id: UUID) -> Invitation:
        result = await self._session.execute(
            select(Invitation).where(Invitation.id == invitation_id)
        )
        invitation = result.scalar_one_or_none()
        if not invitation:
            raise NotFoundError("Invitation", str(invitation_id))
        return invitation

    async def _load_by_token(self, raw_token: str) -> Invitation:
        token_hash = _hash_token(raw_token)
        result = await self._session.execute(
            select(Invitation).where(Invitation.token_hash == token_hash)
        )
        invitation = result.scalar_one_or_none()
        if not invitation:
            raise InvitationNotFoundError("Invitation not found")
        if invitation.revoked_at is not None:
            raise InvitationRevokedError("Invitation has been revoked")
        if invitation.accepted_at is not None:
            raise InvitationAlreadyUsedError("Invitation has already been accepted")
        if invitation.expires_at < datetime.now(UTC):
            raise InvitationExpiredError("Invitation has expired")
        return invitation

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
            "inviter_name": _inviter_label(inviter),
            "org_name": org.name,
            "accept_url": _accept_url(raw_token),
            "role": role.value,
            "expires_in_days": _INVITATION_TTL.days,
        }
        idempotency = f"invite/{org.id}/{recipient}/{raw_token[:8]}"
        await self._enqueue(
            JobName.SEND_EMAIL,
            recipient,
            _TEMPLATE_INVITATION,
            context,
            org.id,
            idempotency,
        )

    async def _enqueue_added_email(
        self,
        *,
        recipient: str,
        user: User,
        org: Organization,
        inviter: User | None,
        role: OrganizationRole,
    ) -> None:
        context: dict[str, Any] = {
            "user_name": user.full_name or user.username,
            "org_name": org.name,
            "inviter_name": _inviter_label(inviter),
            "role": role.value,
            "app_url": _frontend_base_url(),
        }
        idempotency = f"added/{org.id}/{user.id}"
        await self._enqueue(
            JobName.SEND_EMAIL,
            recipient,
            _TEMPLATE_ADDED,
            context,
            org.id,
            idempotency,
            user_id=user.id,
        )

    async def _enqueue(
        self,
        job_name: JobName,
        recipient: str,
        template: str,
        context: dict[str, Any],
        org_id: UUID,
        idempotency_key: str,
        *,
        user_id: UUID | None = None,
    ) -> None:
        try:
            queue = get_queue(QueueName.CORE)
        except RuntimeError:
            logger.warning(
                "invitation email enqueue skipped: core queue not initialised",
                component="mail",
                org_id=str(org_id),
            )
            return
        await queue.enqueue_job(
            job_name,
            recipient,
            template,
            json.dumps(context),
            organization_id=str(org_id),
            idempotency_key=idempotency_key,
            user_id=str(user_id) if user_id else None,
        )
