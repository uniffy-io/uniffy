"""Per-user MFA operations."""

from __future__ import annotations

import base64
import secrets as _secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pyotp
import segno
from loguru import logger
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import audit_ip_var, client_ip_for_rate_limit, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_recovery_code import UserRecoveryCode
from uniffy.domains.auth.errors import (
    AuthenticationError,
    MfaRateLimitedError,
    TokenError,
)
from uniffy.domains.auth.mfa.challenge import decode_mfa_challenge_token
from uniffy.domains.auth.mfa.codes import (
    RECOVERY_CODE_COUNT,
    generate_recovery_codes,
    replace_recovery_codes,
    verify_recovery_code,
)
from uniffy.domains.auth.mfa.crypto import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
)
from uniffy.domains.auth.mfa.rate_limit import (
    RateLimitVerdict,
    is_verify_locked,
    mark_code_used,
    record_verify_attempt,
    totp_counter_now,
)
from uniffy.domains.auth.revocation import mark_token_version_revoked
from uniffy.domains.auth.tokens import create_access_token, create_refresh_token

TOTP_VALID_WINDOW = 1
TOTP_ISSUER = "Uniffy"


@dataclass(frozen=True)
class EnrollmentChallenge:
    secret_b32: str
    provisioning_uri: str
    qr_svg_base64: str


@dataclass(frozen=True)
class ConfirmEnrollmentResult:
    recovery_codes: list[str]
    access_token: str
    refresh_token: str
    session_id: UUID
    organization_id: UUID | None = None
    organization_slug: str | None = None
    organization_role: str | None = None
    domain_admin_domains: list[str] | None = None


@dataclass(frozen=True)
class VerifyMfaResult:
    access_token: str
    refresh_token: str
    user_id: UUID
    organization_id: UUID | None
    session_id: UUID
    used_recovery_code: bool
    remaining_recovery_codes: int
    organization_slug: str | None = None
    organization_role: str | None = None
    domain_admin_domains: list[str] | None = None


@dataclass(frozen=True)
class PendingPeerReset:
    request_id: UUID
    requester_user_id: UUID
    requester_email: str
    target_user_id: UUID
    target_email: str
    reason: str
    created_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class MfaStatus:
    enabled: bool
    enrolled_at: datetime | None
    last_used_at: datetime | None
    remaining_recovery_codes: int


class MfaOperations:
    """All MFA business logic. One instance per request, one DB session."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def begin_enrollment(self, user_id: UUID) -> EnrollmentChallenge:
        """Generate (or reuse) the pending secret and return enrollment material.

        Refuses when MFA is already enabled; otherwise a session takeover
        could silently overwrite the TOTP secret and set `enabled=False`
        without ever holding a current code. Re-enrollment must go through
        `DisableMfa` first. Idempotent: the pending secret is the source of
        truth so concurrent callers all see the same QR.
        """
        user = await self._load_user(user_id)
        if not user.is_active:
            raise AuthenticationError("Account is deactivated")
        existing = await self._load_mfa(user_id)
        if existing is not None and existing.enabled:
            raise PermissionDeniedError(
                "MFA is already enabled. Disable it first to re-enroll.",
                "mfa",
            )

        secret_b32 = await self._reserve_pending_secret(user_id, existing)
        provisioning_uri = pyotp.TOTP(secret_b32).provisioning_uri(
            name=user.email,
            issuer_name=TOTP_ISSUER,
        )
        qr_svg_base64 = _render_qr_svg_base64(provisioning_uri)

        await self._audit_mfa_self_event(
            user_id=user_id, action=Action.AUTH_MFA_ENROLLMENT_STARTED
        )
        await self._session.commit()

        return EnrollmentChallenge(
            secret_b32=secret_b32,
            provisioning_uri=provisioning_uri,
            qr_svg_base64=qr_svg_base64,
        )

    async def confirm_enrollment(
        self,
        user_id: UUID,
        code: str,
        user_agent: str = "",
        pending_organization_id: UUID | None = None,
    ) -> ConfirmEnrollmentResult:
        """Verify the pending TOTP code, flip enabled, mint a fresh session.

        Bumps `User.token_version` so every prior session dies; the caller
        receives new tokens in the response and does not have to re-login.
        """
        user = await self._load_user(user_id)
        if not user.is_active:
            raise AuthenticationError("Account is deactivated")
        mfa = await self._load_mfa(user_id)
        if mfa is None:
            raise NotFoundError("MFA enrollment", str(user_id))
        if not await self._verify_totp(mfa, code):
            raise AuthenticationError("Invalid verification code")

        recovery_codes = generate_recovery_codes(RECOVERY_CODE_COUNT)
        await replace_recovery_codes(
            self._session, user_id=user_id, codes=recovery_codes
        )

        now = datetime.now(UTC)
        mfa.enabled = True
        mfa.enrolled_at = now
        mfa.last_used_at = now
        mfa.consecutive_failures = 0
        mfa.last_failed_at = None

        await self._bump_token_version(user)

        org_id, org_slug, org_role, domain_admin_domains = await self._resolve_pending_org(
            user.id, pending_organization_id
        )

        from uniffy.core.models.login.user_session import UserSession
        from uniffy.domains.auth.context import parse_device_label

        session_record = UserSession(
            user_id=user.id,
            organization_id=org_id,
            user_agent=user_agent[:512],
            device_label=parse_device_label(user_agent),
            ip_address=(audit_ip_var.get() or "")[:45],
        )
        self._session.add(session_record)
        await self._session.flush()

        access = create_access_token(
            user.id,
            organization_id=org_id,
            token_version=user.token_version,
            session_id=session_record.id,
            full_name=user.full_name,
            avatar_key=user.avatar_key,
        )
        refresh = create_refresh_token(
            user.id,
            token_version=user.token_version,
            session_id=session_record.id,
        )
        from uniffy.domains.auth.operations import _hash_refresh_token

        session_record.refresh_token_hash = _hash_refresh_token(refresh)

        await self._audit_mfa_self_event(
            user_id=user_id,
            action=Action.AUTH_MFA_ENROLLED,
            details={"session_id": str(session_record.id)},
        )
        await self._session.commit()
        await mark_token_version_revoked(user.id, user.token_version)

        return ConfirmEnrollmentResult(
            recovery_codes=recovery_codes,
            access_token=access,
            refresh_token=refresh,
            session_id=session_record.id,
            organization_id=org_id,
            organization_slug=org_slug,
            organization_role=org_role,
            domain_admin_domains=domain_admin_domains,
        )

    async def verify_mfa(
        self,
        challenge_token: str,
        code: str,
        method: str,
        user_agent: str = "",
    ) -> VerifyMfaResult:
        """Validate the challenge + code and mint the real AuthResult."""
        try:
            payload = decode_mfa_challenge_token(challenge_token)
        except Exception as exc:
            raise TokenError("Invalid or expired challenge token") from exc

        user_id = UUID(payload["sub"])
        organization_id = (
            UUID(payload["org_id"]) if payload.get("org_id") else None
        )
        challenge_tkv = payload.get("tkv")
        # client_ip_for_rate_limit returns None when the resolved IP is the
        # local proxy address with no TRUSTED_PROXY_HOPS configured - in that
        # case the per-IP bucket is skipped and the per-user counter alone
        # gates the attempt. The user-locked counter (5 fails / 15 min) is
        # the must-have; the IP counter is defense in depth.
        ip = client_ip_for_rate_limit()

        lock = await is_verify_locked(user_id, ip)
        if lock.user_locked or lock.ip_locked:
            raise MfaRateLimitedError("Too many attempts. Try again later.")

        user = await self._load_user(user_id)
        if not user.is_active:
            raise AuthenticationError("Account is deactivated")
        if challenge_tkv is None or int(challenge_tkv) != int(user.token_version or 0):
            raise TokenError("Challenge token has been revoked")
        mfa = await self._load_mfa(user_id)
        if mfa is None or not mfa.enabled:
            raise AuthenticationError("MFA is not enabled for this account")

        used_recovery_code = False
        if method == "totp":
            matched_counter = await self._verify_totp_match_counter(mfa, code)
            if matched_counter is None:
                ok = False
            else:
                ok = await mark_code_used(user_id, matched_counter)
        elif method == "recovery_code":
            ok = await self._consume_recovery_code(user_id, code)
            used_recovery_code = ok
        else:
            raise AuthenticationError("Unsupported MFA method")

        verdict = await record_verify_attempt(user_id, ip, success=ok)
        if verdict in (RateLimitVerdict.LOCKED_USER, RateLimitVerdict.LOCKED_IP):
            raise MfaRateLimitedError("Too many attempts. Try again later.")

        if not ok:
            mfa.consecutive_failures = (mfa.consecutive_failures or 0) + 1
            mfa.last_failed_at = datetime.now(UTC)
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AUTH_MFA_FAILED,
                resource_type="USER",
                resource_id=user_id,
                details={"method": method},
            )
            await self._session.commit()
            raise AuthenticationError("Invalid verification code")

        mfa.consecutive_failures = 0
        mfa.last_used_at = datetime.now(UTC)

        from uniffy.core.models.login.user_session import UserSession
        from uniffy.domains.auth.context import parse_device_label

        bound_org_id, bound_slug, bound_role, bound_admin_domains = (
            await self._resolve_pending_org(user.id, organization_id)
        )

        session_record = UserSession(
            user_id=user.id,
            organization_id=bound_org_id,
            user_agent=user_agent[:512],
            device_label=parse_device_label(user_agent),
            ip_address=(audit_ip_var.get() or "")[:45],
        )
        self._session.add(session_record)
        await self._session.flush()

        access = create_access_token(
            user.id,
            organization_id=bound_org_id,
            token_version=user.token_version,
            session_id=session_record.id,
            full_name=user.full_name,
            avatar_key=user.avatar_key,
        )
        refresh = create_refresh_token(
            user.id,
            token_version=user.token_version,
            session_id=session_record.id,
        )
        from uniffy.domains.auth.operations import _hash_refresh_token

        session_record.refresh_token_hash = _hash_refresh_token(refresh)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(
                Action.AUTH_MFA_RECOVERY_CODE_USED
                if used_recovery_code
                else Action.AUTH_MFA_VERIFIED
            ),
            resource_type="USER",
            resource_id=user_id,
            details={"session_id": str(session_record.id), "method": method},
        )
        await self._session.commit()

        remaining = await self._count_active_recovery_codes(user_id)
        return VerifyMfaResult(
            access_token=access,
            refresh_token=refresh,
            user_id=user.id,
            organization_id=bound_org_id,
            session_id=session_record.id,
            used_recovery_code=used_recovery_code,
            remaining_recovery_codes=remaining,
            organization_slug=bound_slug,
            organization_role=bound_role,
            domain_admin_domains=bound_admin_domains,
        )

    async def disable_mfa(self, user_id: UUID, code: str) -> None:
        """Disable MFA for the calling user. Requires a current TOTP code."""
        mfa = await self._load_mfa(user_id)
        if mfa is None or not mfa.enabled:
            raise NotFoundError("MFA enrollment", str(user_id))
        if not await self._verify_totp(mfa, code):
            raise AuthenticationError("Invalid verification code")

        user = await self._load_user(user_id)
        await self._session.execute(
            delete(UserRecoveryCode).where(UserRecoveryCode.user_id == user_id)
        )
        await self._session.execute(
            delete(UserMfa).where(UserMfa.user_id == user_id)
        )
        await self._bump_token_version(user)

        await self._audit_mfa_self_event(
            user_id=user_id, action=Action.AUTH_MFA_DISABLED
        )
        await self._session.commit()
        await mark_token_version_revoked(user.id, user.token_version)

    async def regenerate_recovery_codes(
        self, user_id: UUID, code: str
    ) -> list[str]:
        """Re-issue 10 fresh recovery codes. Requires a current TOTP code."""
        mfa = await self._load_mfa(user_id)
        if mfa is None or not mfa.enabled:
            raise NotFoundError("MFA enrollment", str(user_id))
        if not await self._verify_totp(mfa, code):
            raise AuthenticationError("Invalid verification code")

        recovery_codes = generate_recovery_codes(RECOVERY_CODE_COUNT)
        await replace_recovery_codes(
            self._session, user_id=user_id, codes=recovery_codes
        )
        await self._audit_mfa_self_event(
            user_id=user_id, action=Action.AUTH_MFA_RECOVERY_CODES_REGENERATED
        )
        await self._session.commit()
        return recovery_codes

    async def get_status(self, user_id: UUID) -> MfaStatus:
        """Return enrollment state for the settings UI."""
        mfa = await self._load_mfa(user_id)
        remaining = await self._count_active_recovery_codes(user_id)
        if mfa is None:
            return MfaStatus(
                enabled=False,
                enrolled_at=None,
                last_used_at=None,
                remaining_recovery_codes=0,
            )
        return MfaStatus(
            enabled=mfa.enabled,
            enrolled_at=mfa.enrolled_at,
            last_used_at=mfa.last_used_at,
            remaining_recovery_codes=remaining if mfa.enabled else 0,
        )

    async def admin_reset_mfa(
        self,
        actor_user_id: UUID,
        organization_id: UUID,
        target_user_id: UUID,
        reason: str,
    ) -> None:
        """Org OWNER/ADMIN resets MFA on a member of their org.

        Drops the MFA row + recovery codes, bumps `token_version`, writes
        an audit row, and dispatches a best-effort out-of-band notice.
        """
        from uniffy.core.audit.actions import Action as _Action
        from uniffy.core.models.login.organization import Organization
        from uniffy.core.models.login.organization_member import (
            OrganizationMember,
            OrganizationRole,
        )

        actor_membership = (
            await self._session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == actor_user_id,
                    OrganizationMember.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if actor_membership is None or actor_membership.role not in (
            OrganizationRole.OWNER,
            OrganizationRole.ADMIN,
        ):
            raise PermissionDeniedError(
                "admin_reset_mfa",
                "organization",
            )

        target_membership = (
            await self._session.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == target_user_id,
                    OrganizationMember.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if target_membership is None:
            raise NotFoundError("OrganizationMember", str(target_user_id))

        target_user = await self._load_user(target_user_id)
        actor_user = await self._load_user(actor_user_id)

        org = (
            await self._session.execute(
                select(Organization).where(Organization.id == organization_id)
            )
        ).scalar_one_or_none()
        org_name = org.name if org is not None else "your organization"

        await self._perform_reset(
            target=target_user,
            actor_user_id=actor_user_id,
            actor_user=actor_user,
            action=_Action.AUTH_MFA_ADMIN_RESET,
            reason=reason,
            organization_id=organization_id,
            org_name_for_mail=org_name,
        )

    async def platform_reset_mfa(
        self,
        actor_user_id: UUID,
        target_user_id: UUID,
        reason: str,
    ) -> None:
        """Platform admin resets MFA on a target with zero org memberships.

        For targets with any tenant exposure the caller must open a
        SupportSession with the org owner instead. Peer platform admins
        must go through the co-sign flow.
        """
        from uniffy.core.models.login.organization_member import OrganizationMember

        actor = await self._load_user(actor_user_id)
        if not actor.is_system_admin:
            raise PermissionDeniedError("platform_reset_mfa", "mfa")

        target = await self._load_user(target_user_id)
        if target.is_system_admin:
            raise PermissionDeniedError(
                "platform_reset_mfa: peer reset requires co-sign", "mfa"
            )

        membership_count = (
            await self._session.execute(
                select(func.count())
                .select_from(OrganizationMember)
                .where(OrganizationMember.user_id == target_user_id)
            )
        ).scalar_one()
        if (membership_count or 0) > 0:
            raise PermissionDeniedError(
                "platform_reset_mfa: target has org memberships; use SupportSession",
                "mfa",
            )

        await self._perform_reset(
            target=target,
            actor_user_id=actor_user_id,
            actor_user=actor,
            action=Action.AUTH_MFA_PLATFORM_RESET,
            reason=reason,
            organization_id=None,
        )

    async def request_platform_peer_reset(
        self,
        actor_user_id: UUID,
        target_user_id: UUID,
        reason: str,
    ) -> tuple[UUID, datetime]:
        """Open a 10-minute peer-co-sign window to reset a platform admin."""
        from uniffy.core.models.login.platform_mfa_reset_request import (
            PlatformMfaResetRequest,
        )

        actor = await self._load_user(actor_user_id)
        if not actor.is_system_admin:
            raise PermissionDeniedError("request_platform_peer_reset", "mfa")
        if actor_user_id == target_user_id:
            raise PermissionDeniedError(
                "request_platform_peer_reset: cannot target self", "mfa"
            )
        target = await self._load_user(target_user_id)
        if not target.is_system_admin:
            raise PermissionDeniedError(
                "request_platform_peer_reset: target is not a platform admin",
                "mfa",
            )

        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=10)
        request_row = PlatformMfaResetRequest(
            requester_user_id=actor_user_id,
            target_user_id=target_user_id,
            reason=(reason or "").strip(),
            created_at=now,
            expires_at=expires_at,
        )
        self._session.add(request_row)
        await self._session.flush()

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=actor_user_id,
            action=Action.AUTH_MFA_PLATFORM_RESET_REQUESTED,
            resource_type="USER",
            resource_id=target_user_id,
            details={
                "request_id": str(request_row.id),
                "target_user_id": str(target_user_id),
                "reason": (reason or "").strip(),
                "expires_at": expires_at.isoformat(),
            },
        )
        await self._session.commit()
        return request_row.id, expires_at

    async def list_platform_peer_resets(
        self,
        actor_user_id: UUID,
    ) -> list[PendingPeerReset]:
        """Return every pending peer-reset request for the inbox panel."""
        from uniffy.core.models.login.platform_mfa_reset_request import (
            PlatformMfaResetRequest,
        )

        actor = await self._load_user(actor_user_id)
        if not actor.is_system_admin:
            raise PermissionDeniedError("list_platform_peer_resets", "mfa")

        now = datetime.now(UTC)
        rows = (
            await self._session.execute(
                select(PlatformMfaResetRequest)
                .where(PlatformMfaResetRequest.approved_at.is_(None))
                .where(PlatformMfaResetRequest.expires_at > now)
                .order_by(PlatformMfaResetRequest.created_at.desc())
            )
        ).scalars().all()
        if not rows:
            return []

        ids = {r.requester_user_id for r in rows} | {r.target_user_id for r in rows}
        user_rows = (
            await self._session.execute(select(User).where(User.id.in_(ids)))
        ).scalars().all()
        emails = {u.id: u.email for u in user_rows}

        return [
            PendingPeerReset(
                request_id=r.id,
                requester_user_id=r.requester_user_id,
                requester_email=emails.get(r.requester_user_id, ""),
                target_user_id=r.target_user_id,
                target_email=emails.get(r.target_user_id, ""),
                reason=r.reason,
                created_at=r.created_at,
                expires_at=r.expires_at,
            )
            for r in rows
        ]

    async def approve_platform_peer_reset(
        self,
        actor_user_id: UUID,
        request_id: UUID,
    ) -> None:
        """Second-admin approval. Performs the reset in the same txn."""
        from uniffy.core.models.login.platform_mfa_reset_request import (
            PlatformMfaResetRequest,
        )

        actor = await self._load_user(actor_user_id)
        if not actor.is_system_admin:
            raise PermissionDeniedError("approve_platform_peer_reset", "mfa")

        request_row = (
            await self._session.execute(
                select(PlatformMfaResetRequest).where(
                    PlatformMfaResetRequest.id == request_id
                )
            )
        ).scalar_one_or_none()
        if request_row is None:
            raise NotFoundError("PlatformMfaResetRequest", str(request_id))
        if request_row.requester_user_id == actor_user_id:
            raise PermissionDeniedError(
                "approve_platform_peer_reset: approver must differ from requester",
                "mfa",
            )
        if request_row.approved_at is not None:
            raise PermissionDeniedError(
                "approve_platform_peer_reset: request already approved", "mfa"
            )
        now = datetime.now(UTC)
        if now >= request_row.expires_at:
            raise PermissionDeniedError(
                "approve_platform_peer_reset: request has expired", "mfa"
            )

        request_row.approved_at = now
        request_row.approver_user_id = actor_user_id

        target = await self._load_user(request_row.target_user_id)
        await self._perform_reset(
            target=target,
            actor_user_id=actor_user_id,
            actor_user=actor,
            action=Action.AUTH_MFA_PLATFORM_RESET_APPROVED,
            reason=request_row.reason,
            organization_id=None,
            extra_details={
                "request_id": str(request_row.id),
                "requester_user_id": str(request_row.requester_user_id),
            },
        )

    async def _perform_reset(
        self,
        *,
        target: User,
        actor_user_id: UUID,
        actor_user: User,
        action: str,
        reason: str,
        organization_id: UUID | None,
        extra_details: dict | None = None,
        org_name_for_mail: str = "Uniffy",
    ) -> None:
        """Shared reset path: delete rows, bump tkv, audit, best-effort mail."""
        from uniffy.core.mail.errors import (
            MailNotConfiguredError,
            MailSuppressedError,
        )
        from uniffy.core.mail.sender import MailSender
        from uniffy.core.models.login.user_session import UserSession
        from uniffy.domains.auth.revocation import mark_sessions_revoked

        await self._session.execute(
            delete(UserRecoveryCode).where(UserRecoveryCode.user_id == target.id)
        )
        await self._session.execute(
            delete(UserMfa).where(UserMfa.user_id == target.id)
        )
        await self._bump_token_version(target)

        # Bumping token_version alone leaves the existing access tokens valid
        # until their 15-min natural expiry. Flip every UserSession row AND
        # publish per-sid revoked markers so the interceptor rejects every
        # outstanding token on the next RPC.
        now = datetime.now(UTC)
        session_rows = (
            await self._session.execute(
                select(UserSession.id).where(
                    UserSession.user_id == target.id,
                    UserSession.is_revoked.is_(False),
                )
            )
        ).all()
        revoked_session_ids = [row[0] for row in session_rows]
        if revoked_session_ids:
            await self._session.execute(
                update(UserSession)
                .where(UserSession.id.in_(revoked_session_ids))
                .values(is_revoked=True, revoked_at=now)
            )

        details = {
            "target_user_id": str(target.id),
            "target_email": target.email,
            "reason": (reason or "").strip(),
            "revoked_session_count": len(revoked_session_ids),
        }
        if extra_details:
            details.update(extra_details)

        await write_audit_event(
            self._session,
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=action,
            resource_type="USER",
            resource_id=target.id,
            details=details,
        )
        await self._session.commit()
        await mark_token_version_revoked(target.id, target.token_version)
        await mark_sessions_revoked(revoked_session_ids)
        # Publish the token_version bump so the realtime router closes
        # every open WS for the target with code 4410. Streaming RPCs
        # (chat, notifications, agent runtime) still ride out to their
        # natural disconnect - a follow-up could subscribe them to the
        # same channel; for now the WS path is the user-visible one.
        from uniffy.core.realtime.publisher import publish_token_revoke

        await publish_token_revoke(target.id, target.token_version)

        try:
            await MailSender().send(
                recipient_email=target.email,
                template_name="auth/mfa_reset",
                context={
                    "user_name": target.full_name or "",
                    "actor_name": actor_user.full_name or "",
                    "org_name": org_name_for_mail,
                    "reason": (reason or "").strip(),
                },
                organization_id=organization_id,
                user_id=actor_user_id,
            )
        except MailNotConfiguredError:
            logger.info(
                "mfa.reset: mail not configured; skipping out-of-band notice",
                target_user_id=str(target.id),
            )
        except MailSuppressedError:
            logger.info(
                "mfa.reset: target on suppression list",
                target_user_id=str(target.id),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "mfa.reset: mail dispatch failed (non-fatal)",
                target_user_id=str(target.id),
                error=str(exc),
            )

    async def _verify_totp(self, mfa: UserMfa, code: str) -> bool:
        return await self._verify_totp_match_counter(mfa, code) is not None

    async def _verify_totp_match_counter(
        self, mfa: UserMfa, code: str
    ) -> int | None:
        """Return the matched 30s step or `None` when no code matches.

        Replay protection needs the exact step the code belongs to;
        iterating `[now-window, now+window]` with constant-time compare
        prevents the same code from replaying when the clock crosses
        into the next step.
        """
        if mfa.totp_secret_encrypted is None:
            return None
        try:
            secret_b32 = await decrypt_totp_secret(
                self._session, mfa.totp_secret_encrypted
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"TOTP decrypt failed for user {mfa.user_id}: {exc}")
            return None
        submitted = (code or "").strip()
        if not submitted:
            return None
        totp = pyotp.TOTP(secret_b32)
        now_counter = totp_counter_now()
        for offset in range(-TOTP_VALID_WINDOW, TOTP_VALID_WINDOW + 1):
            counter = now_counter + offset
            try:
                expected = totp.generate_otp(counter)
            except Exception:  # noqa: BLE001
                continue
            if _secrets.compare_digest(expected, submitted):
                return counter
        return None

    async def _consume_recovery_code(self, user_id: UUID, code: str) -> bool:
        """Find an active recovery code that verifies and mark it used.

        Concurrent attempts with the same plaintext race on the same row;
        only the winner stamps `used_at`. A zero-rowcount UPDATE means
        another tx consumed the code and the verify is a miss.
        """
        result = await self._session.execute(
            select(UserRecoveryCode).where(
                UserRecoveryCode.user_id == user_id,
                UserRecoveryCode.used_at.is_(None),
            )
            .limit(RECOVERY_CODE_COUNT * 2)
        )
        now = datetime.now(UTC)
        for row in result.scalars():
            if not verify_recovery_code(code, row.code_hash):
                continue
            updated = await self._session.execute(
                update(UserRecoveryCode)
                .where(
                    UserRecoveryCode.id == row.id,
                    UserRecoveryCode.used_at.is_(None),
                )
                .values(used_at=now)
            )
            return (updated.rowcount or 0) > 0
        return False

    async def _count_active_recovery_codes(self, user_id: UUID) -> int:
        result = await self._session.execute(
            select(func.count())
            .select_from(UserRecoveryCode)
            .where(
                UserRecoveryCode.user_id == user_id,
                UserRecoveryCode.used_at.is_(None),
            )
        )
        return int(result.scalar_one() or 0)

    async def _reserve_pending_secret(
        self, user_id: UUID, existing: UserMfa | None
    ) -> str:
        """Return the plaintext secret for the user's pending enrollment.

        Persisted with `ON CONFLICT DO NOTHING` so racing callers can never
        end up with different secrets; the first writer wins.
        """
        if existing is not None and existing.totp_secret_encrypted:
            return await decrypt_totp_secret(
                self._session, existing.totp_secret_encrypted
            )

        secret_b32 = generate_totp_secret()
        ciphertext = await encrypt_totp_secret(self._session, secret_b32)
        now = datetime.now(UTC)
        await self._session.execute(
            pg_insert(UserMfa)
            .values(
                user_id=user_id,
                totp_secret_encrypted=ciphertext,
                enabled=False,
                enrolled_at=None,
                last_used_at=None,
                last_failed_at=None,
                consecutive_failures=0,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(index_elements=[UserMfa.user_id])
        )
        await self._session.flush()

        stored = await self._load_mfa(user_id)
        if stored is None or stored.totp_secret_encrypted is None:
            return secret_b32
        return await decrypt_totp_secret(
            self._session, stored.totp_secret_encrypted
        )

    async def _load_user(self, user_id: UUID) -> User:
        result = await self._session.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise NotFoundError("User", str(user_id))
        return user

    async def _user_active_org_ids(self, user_id: UUID) -> list[UUID]:
        """Active org memberships used to fan the audit row to every tenant."""
        from uniffy.core.models.login.organization_member import OrganizationMember

        result = await self._session.execute(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def _audit_mfa_self_event(
        self,
        *,
        user_id: UUID,
        action: str,
        details: dict | None = None,
    ) -> None:
        """Fan an MFA self-service audit row to every active org membership.

        Users with no active membership still get one `organization_id=NULL`
        row so the platform audit log keeps a record.
        """
        payload = dict(details or {})
        org_ids = await self._user_active_org_ids(user_id)
        if not org_ids:
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=user_id,
                action=action,
                resource_type="USER",
                resource_id=user_id,
                details=payload,
            )
            return
        for org_id in org_ids:
            await write_audit_event(
                self._session,
                organization_id=org_id,
                actor_user_id=user_id,
                action=action,
                resource_type="USER",
                resource_id=user_id,
                details=payload,
            )

    async def _load_mfa(self, user_id: UUID) -> UserMfa | None:
        result = await self._session.execute(
            select(UserMfa).where(UserMfa.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def _bump_token_version(self, user: User) -> None:
        """Increment `User.token_version` so every prior session dies."""
        user.token_version = (user.token_version or 1) + 1
        await self._session.execute(
            update(User)
            .where(User.id == user.id)
            .values(token_version=user.token_version)
        )

    async def _resolve_pending_org(
        self,
        user_id: UUID,
        organization_id: UUID | None,
    ) -> tuple[UUID | None, str | None, str | None, list[str] | None]:
        """Re-validate the pending org carried through challenge/enrollment.

        Returns ``(org_id, slug, role, domain_admins)`` so the session row
        and the returned ``VerifyMfaResult`` / ``ConfirmEnrollmentResult``
        line up. Missing membership demotes the result to ``(None,)*4``
        rather than blocking the MFA flow - the user lands at the org
        picker instead of a dead session.
        """
        if organization_id is None:
            return None, None, None, None
        from uniffy.domains.auth.operations import AuthOperations

        try:
            (
                org_id,
                slug,
                role,
                domain_admins,
            ) = await AuthOperations(self._session)._verify_org_membership_by_id(
                user_id, organization_id
            )
        except AuthenticationError:
            return None, None, None, None
        return org_id, slug, role, domain_admins


def _render_qr_svg_base64(provisioning_uri: str) -> str:
    """Render the provisioning URI as a base64-encoded SVG QR code.

    Inline so the frontend can render via `data:` URL; no CDN fetch.
    """
    qr = segno.make(provisioning_uri, error="m")
    import io

    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=4)
    return base64.b64encode(buf.getvalue()).decode("ascii")
