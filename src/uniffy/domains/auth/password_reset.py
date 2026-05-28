"""Password reset request / verify / consume.

Three RPCs sit on top of this:

* ``request(email, ip)`` -- always returns success (no enumeration).
  Resolves the user's primary org, checks the per-org
  ``security.password_reset_enabled`` toggle, generates a single-use
  token, stores its SHA256 hex digest, enqueues the email via the
  user's primary-org SMTP config (falls back to env when the user has
  no membership).
* ``verify(token)`` -- preview shape for the reset page: returns the
  bound email + remaining lifetime so the form can echo who is being
  reset without leaking that the token is valid through timing alone.
* ``consume(token, new_password)`` -- single transaction: validate,
  hash, write the new password, bump ``User.token_version`` to revoke
  every existing session, mark the token row ``used_at = now``.

The token is generated with ``secrets.token_urlsafe(32)``. The raw
token lives only in the user's mailbox / URL; the database stores its
SHA256 hex digest. A DB leak is therefore not replayable against the
``ResetPassword`` RPC.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import client_ip_for_rate_limit, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.password_reset_token import PasswordResetToken
from uniffy.core.models.login.user import User
from uniffy.core.valkey.queue import get_queue
from uniffy.core.valkey.rate_limit import check_rate_limit
from uniffy.domains.auth.passwords import hash_password
from uniffy.domains.security.operations import SecurityOperations

_TOKEN_TTL = timedelta(minutes=30)
_TEMPLATE = "auth/password_reset"

# Loose caps mirror the login throttle ratio: the email bucket catches a
# targeted attack on one address, the IP bucket catches a spray. Both are
# loose enough that a legitimate user requesting a fresh link a few times
# in a row never trips. Per-token throttling on ``consume`` is the
# stronger defense and lives separately.
RESET_REQUEST_LIMIT_EMAIL = 5
RESET_REQUEST_LIMIT_IP = 20
RESET_REQUEST_WINDOW_SECONDS = 15 * 60

RESET_CONSUME_LIMIT_IP = 30
RESET_CONSUME_WINDOW_SECONDS = 15 * 60

# Preview is unauthenticated and confirms a token resolves to an email.
# Per-token-hash is the load-bearing bucket - bounds how many times one
# token can be confirmed if its value somehow leaks. Per-IP is best-effort
# and skipped when the IP is not trustable.
RESET_VERIFY_LIMIT_IP = 60
RESET_VERIFY_LIMIT_TOKEN = 10
RESET_VERIFY_WINDOW_SECONDS = 15 * 60


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _frontend_base_url() -> str:
    return os.getenv("UNIFFY_BASE_URL", "http://localhost:5173").rstrip("/")


def _reset_url(raw_token: str) -> str:
    return f"{_frontend_base_url()}/auth/reset-password?token={raw_token}"


@dataclass(frozen=True)
class PasswordResetPreview:
    """What the reset page shows before the user picks a new password."""

    email: str
    expires_at: datetime


class PasswordResetError(Exception):
    """Base class for password-reset failures the caller can render."""


class PasswordResetTokenNotFoundError(PasswordResetError):
    """Token does not match any row."""


class PasswordResetTokenExpiredError(PasswordResetError):
    """Token passed its ``expires_at``."""


class PasswordResetTokenUsedError(PasswordResetError):
    """Token already consumed."""


class PasswordResetOperations:
    """Operations around ``PasswordResetToken`` + the dispatch pipeline."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def request(
        self,
        email: str,
        requested_ip: str | None = None,
    ) -> None:
        """Send a reset link if the email maps to an active user.

        Always succeeds from the caller's perspective -- the RPC never
        reveals whether the address has an account. Rate-limited per
        email and per IP so the endpoint cannot be used to flood SMTP
        or to enumerate addresses by response timing.
        """
        normalized = email.strip().lower()
        if not normalized or "@" not in normalized:
            return

        await check_rate_limit(
            key=f"rl:auth:reset:email:{normalized}",
            limit=RESET_REQUEST_LIMIT_EMAIL,
            window_seconds=RESET_REQUEST_WINDOW_SECONDS,
            resource="password reset requests (per email)",
        )
        rate_limit_ip = client_ip_for_rate_limit()
        if rate_limit_ip:
            await check_rate_limit(
                key=f"rl:auth:reset:ip:{rate_limit_ip}",
                limit=RESET_REQUEST_LIMIT_IP,
                window_seconds=RESET_REQUEST_WINDOW_SECONDS,
                resource="password reset requests (per ip)",
            )

        user = (
            await self._session.execute(select(User).where(User.email == normalized))
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=None,
                action=Action.AUTH_PASSWORD_RESET_REQUESTED,
                resource_type=None,
                resource_id=None,
                details={"email_attempted": normalized, "outcome": "no_user"},
            )
            await self._session.commit()
            return

        primary_org_id, primary_org = await self._resolve_primary_org(user.id)

        if primary_org_id is not None:
            security = await SecurityOperations(self._session).get(primary_org_id)
            if not security.password_reset_enabled:
                await write_audit_event(
                    self._session,
                    organization_id=primary_org_id,
                    actor_user_id=user.id,
                    action=Action.AUTH_PASSWORD_RESET_BLOCKED,
                    resource_type="USER",
                    resource_id=user.id,
                    details={"email": normalized, "reason": "disabled_for_org"},
                )
                await self._session.commit()
                return

        raw_token = secrets.token_urlsafe(32)
        token_record = PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_token(raw_token),
            expires_at=datetime.now(UTC) + _TOKEN_TTL,
            requested_ip=requested_ip,
        )
        self._session.add(token_record)
        await self._session.commit()
        await self._session.refresh(token_record)

        await write_audit_event(
            self._session,
            organization_id=primary_org_id,
            actor_user_id=user.id,
            action=Action.AUTH_PASSWORD_RESET_REQUESTED,
            resource_type="USER",
            resource_id=user.id,
            details={
                "email": normalized,
                "token_id": str(token_record.id),
                "expires_at": token_record.expires_at.isoformat(),
                "config_source": "org" if primary_org_id is not None else "env",
            },
        )
        await self._session.commit()

        await self._enqueue_email(
            user=user,
            raw_token=raw_token,
            org=primary_org,
            token_record_id=token_record.id,
        )

    async def verify(self, raw_token: str) -> PasswordResetPreview:
        """Return ``(email, expires_at)`` for the reset page or raise.

        Rate-limited per-token-hash (load-bearing) + per-IP (best-effort,
        skipped on misconfigured proxies). The token bucket bounds how
        many times one token can be confirmed even if its raw value
        somehow leaks to an attacker (mail log, referrer); the IP bucket
        adds a second guard for spray scans from a single trusted client.
        """
        await check_rate_limit(
            key=f"rl:auth:reset_verify:token:{_hash_token(raw_token)}",
            limit=RESET_VERIFY_LIMIT_TOKEN,
            window_seconds=RESET_VERIFY_WINDOW_SECONDS,
            resource="password reset verify attempts (per token)",
        )
        rate_limit_ip = client_ip_for_rate_limit()
        if rate_limit_ip:
            await check_rate_limit(
                key=f"rl:auth:reset_verify:ip:{rate_limit_ip}",
                limit=RESET_VERIFY_LIMIT_IP,
                window_seconds=RESET_VERIFY_WINDOW_SECONDS,
                resource="password reset verify attempts (per ip)",
            )
        token_record, user = await self._load_active_token(raw_token)
        return PasswordResetPreview(
            email=user.email,
            expires_at=token_record.expires_at,
        )

    async def consume(self, raw_token: str, new_password: str) -> User:
        """Apply the new password + invalidate all existing sessions.

        Per-IP throttle bounds brute-force attempts against the token
        space; the underlying token is 256-bit so the cap is more about
        slowing crawlers than preventing guessing. The IP is read from
        the request ContextVar; behind an unconfigured reverse proxy
        the helper returns ``None`` and the per-IP bucket is skipped.
        """
        rate_limit_ip = client_ip_for_rate_limit()
        if rate_limit_ip:
            await check_rate_limit(
                key=f"rl:auth:reset_consume:ip:{rate_limit_ip}",
                limit=RESET_CONSUME_LIMIT_IP,
                window_seconds=RESET_CONSUME_WINDOW_SECONDS,
                resource="password reset attempts (per ip)",
            )
        from uniffy.domains.auth.password_policy import validate_password

        validate_password(new_password)

        token_record, user = await self._load_active_token(raw_token)

        user.hashed_password = hash_password(new_password)
        user.token_version = (user.token_version or 0) + 1
        token_record.used_at = datetime.now(UTC)

        primary_org_id, _ = await self._resolve_primary_org(user.id)
        await write_audit_event(
            self._session,
            organization_id=primary_org_id,
            actor_user_id=user.id,
            action=Action.AUTH_PASSWORD_RESET_COMPLETED,
            resource_type="USER",
            resource_id=user.id,
            details={
                "token_id": str(token_record.id),
                "new_token_version": user.token_version,
            },
        )
        await self._session.commit()
        await self._session.refresh(user)

        from uniffy.core.realtime.publisher import publish_token_revoke
        from uniffy.domains.auth.revocation import mark_token_version_revoked

        await mark_token_version_revoked(user.id, user.token_version)
        await publish_token_revoke(user.id, user.token_version)
        return user

    async def _load_active_token(
        self,
        raw_token: str,
    ) -> tuple[PasswordResetToken, User]:
        token_hash = _hash_token(raw_token)
        row = await self._session.execute(
            select(PasswordResetToken, User)
            .join(User, User.id == PasswordResetToken.user_id)
            .where(PasswordResetToken.token_hash == token_hash)
        )
        result = row.first()
        if not result:
            raise PasswordResetTokenNotFoundError("Reset link is invalid")
        token_record, user = result
        if token_record.used_at is not None:
            raise PasswordResetTokenUsedError("Reset link has already been used")
        if token_record.expires_at < datetime.now(UTC):
            raise PasswordResetTokenExpiredError("Reset link has expired")
        if not user.is_active:
            raise PasswordResetTokenNotFoundError("Reset link is invalid")
        return token_record, user

    async def _resolve_primary_org(
        self,
        user_id: UUID,
    ) -> tuple[UUID | None, Organization | None]:
        """Lowest-``joined_at`` active membership; falls back to ``(None, None)``."""
        result = await self._session.execute(
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_active.is_(True),
            )
            .order_by(OrganizationMember.joined_at.asc())
            .limit(1)
        )
        row = result.first()
        if not row:
            return None, None
        membership, org = row
        return membership.organization_id, org

    async def _enqueue_email(
        self,
        *,
        user: User,
        raw_token: str,
        org: Organization | None,
        token_record_id: UUID,
    ) -> None:
        context = {
            "user_name": user.full_name or user.username or "",
            "org_name": org.name if org else "Uniffy",
            "reset_url": _reset_url(raw_token),
            "expires_in_minutes": int(_TOKEN_TTL.total_seconds() // 60),
        }
        try:
            queue = get_queue("core")
        except RuntimeError:
            logger.warning(
                "password reset email enqueue skipped: core queue not initialised",
                component="auth",
                user_id=str(user.id),
            )
            return
        await queue.enqueue_job(
            "send_email",
            user.email,
            _TEMPLATE,
            json.dumps(context),
            organization_id=str(org.id) if org else None,
            idempotency_key=f"password-reset/{token_record_id}",
            user_id=str(user.id),
        )
