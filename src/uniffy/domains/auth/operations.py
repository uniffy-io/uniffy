"""Authentication operations - login, register, refresh token, session management."""

import os
from datetime import UTC, datetime, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import audit_ip_var, client_ip_for_rate_limit, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.devices import parse_device_label
from uniffy.core.auth.emails import normalize_email
from uniffy.core.auth.passwords.crypto import hash_password, verify_password
from uniffy.core.auth.passwords.policy import validate_password
from uniffy.core.auth.revocation import (
    mark_session_revoked,
    mark_sessions_revoked,
    mark_token_version_revoked,
)
from uniffy.core.auth.sessions import revoke_user_sessions
from uniffy.core.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from uniffy.core.config.registration import public_registration_enabled
from uniffy.core.errors import RateLimitExceededError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.rate_limit import check_rate_limit
from uniffy.domains.auth.contracts import hash_refresh_token
from uniffy.domains.auth.errors import AuthenticationError, RegistrationError, TokenError
from uniffy.domains.auth.metrics import AUTH_ATTEMPTS_TOTAL
from uniffy.domains.auth.mfa.challenge import (
    create_enrollment_only_token,
    create_mfa_challenge_token,
)
from uniffy.domains.auth.mfa.enforcement import (
    MfaRequirement,
    evaluate_mfa_requirement,
)
from uniffy.domains.auth.types import (
    AuthOutcome,
    AuthResult,
    MfaChallengeRequired,
    MfaEnrollmentRequired,
)
from uniffy.domains.calls.lifecycle import CallEvictionReason, CallRevocationLifecycle

logger = logger.bind(component="auth.operations")

LOGIN_RATE_LIMIT_EMAIL = 10
LOGIN_RATE_LIMIT_IP = 30
LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60

# Grace window in which a previously-issued refresh token still resolves to the
# current pair without tripping the reuse alarm. Covers the brief race when two
# tabs hit RefreshToken back-to-back and one tab reads the rotated token from
# localStorage a moment after the other tab rotated.
REFRESH_GRACE_SECONDS = 30


async def _publish_session_revoke_safe(user_id: UUID, session_id: UUID) -> None:
    """Best-effort fanout to the realtime router; never blocks the caller.

    A Valkey hiccup leaves the per-session marker in place (we already
    wrote it via ``mark_session_revoked``) - the WS just rides out to
    natural disconnect instead of getting the 4410 close. Fail-quiet.
    """
    try:
        from uniffy.core.realtime.publisher import publish_session_revoke

        await publish_session_revoke(user_id, session_id)
    except Exception:  # noqa: BLE001
        logger.warning(
            "auth.publish_session_revoke failed",
            user_id=str(user_id),
            session_id=str(session_id),
        )


class AuthOperations:
    def __init__(
        self,
        session: AsyncSession,
        call_lifecycle: CallRevocationLifecycle,
    ) -> None:
        self._session = session
        self._call_lifecycle = call_lifecycle

    async def authenticate(
        self,
        email: str,
        password: str,
        organization_slug: str | None = None,
        user_agent: str = "",
    ) -> AuthOutcome:
        """Authenticate via email + password and return tokens or an MFA challenge."""
        user: User | None = None
        organization_id: UUID | None = None
        email = normalize_email(email)
        try:
            await self._enforce_login_rate_limit(email)

            user = await self._get_user_by_email(email)
            if not user:
                raise AuthenticationError("Invalid email or password")

            if not user.is_active:
                raise AuthenticationError("User account is deactivated")

            if not user.hashed_password:
                raise AuthenticationError("Password login not available. Please use SSO.")

            if not verify_password(password, user.hashed_password):
                raise AuthenticationError("Invalid email or password")

            organization_slug_resolved: str | None = None
            organization_role = None
            domain_admin_domains: list[str] | None = None
            if organization_slug:
                (
                    organization_id,
                    organization_slug_resolved,
                    organization_role,
                    domain_admin_domains,
                ) = await self._verify_org_membership(user.id, organization_slug)

            mfa_row = await self._load_user_mfa(user.id)
            if mfa_row is not None and mfa_row.enabled:
                challenge = create_mfa_challenge_token(
                    user.id,
                    organization_id=organization_id,
                    token_version=user.token_version,
                )
                await write_audit_event(
                    self._session,
                    organization_id=organization_id,
                    actor_user_id=user.id,
                    action=Action.AUTH_LOGIN_SUCCESS,
                    resource_type=AuditResourceType.USER,
                    resource_id=user.id,
                    details={
                        "email": user.email,
                        "mfa_challenge_issued": True,
                    },
                )
                await self._session.commit()
                AUTH_ATTEMPTS_TOTAL.labels(operation="authenticate", outcome="mfa_challenge").inc()
                return MfaChallengeRequired(
                    challenge_token=challenge,
                    methods=("totp", "recovery_code"),
                )

            requirement = await evaluate_mfa_requirement(
                self._session,
                user=user,
                user_mfa=mfa_row,
            )
            if requirement.requirement == MfaRequirement.HARD_REQUIRED:
                enrollment_token = create_enrollment_only_token(
                    user.id,
                    organization_id=organization_id,
                    token_version=user.token_version,
                )
                await write_audit_event(
                    self._session,
                    organization_id=organization_id,
                    actor_user_id=user.id,
                    action=Action.AUTH_LOGIN_SUCCESS,
                    resource_type=AuditResourceType.USER,
                    resource_id=user.id,
                    details={
                        "email": user.email,
                        "enrollment_required": True,
                    },
                )
                await self._session.commit()
                AUTH_ATTEMPTS_TOTAL.labels(
                    operation="authenticate", outcome="enrollment_required"
                ).inc()
                return MfaEnrollmentRequired(
                    enrollment_token=enrollment_token,
                    grace_expires_at=None,
                )

            session_record = await self._stage_session(
                user.id, user_agent, organization_id=organization_id
            )

            access_token = create_access_token(
                user.id,
                organization_id,
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
            session_record.refresh_token_hash = hash_refresh_token(refresh_token)

            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user.id,
                action=Action.AUTH_LOGIN_SUCCESS,
                resource_type=AuditResourceType.USER,
                resource_id=user.id,
                details={
                    "email": user.email,
                    "session_id": str(session_record.id),
                },
            )
            await self._session.commit()

            logger.info(f"User {user.email} authenticated successfully")
            AUTH_ATTEMPTS_TOTAL.labels(operation="authenticate", outcome="success").inc()

            return AuthResult(
                access_token=access_token,
                refresh_token=refresh_token,
                user_id=user.id,
                organization_id=organization_id,
                organization_slug=organization_slug_resolved,
                organization_role=organization_role,
                session_id=session_record.id,
                domain_admin_domains=domain_admin_domains,
            )
        except RateLimitExceededError as exc:
            AUTH_ATTEMPTS_TOTAL.labels(operation="authenticate", outcome="rate_limited").inc()
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=None,
                action=Action.AUTH_LOGIN_RATE_LIMITED,
                resource_type=None,
                resource_id=None,
                details={
                    "email_attempted": email,
                    "resource": exc.resource,
                    "retry_after_seconds": exc.retry_after,
                },
            )
            await self._session.commit()
            raise
        except AuthenticationError as exc:
            AUTH_ATTEMPTS_TOTAL.labels(operation="authenticate", outcome="failure").inc()
            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user.id if user else None,
                action=Action.AUTH_LOGIN_FAILURE,
                resource_type=AuditResourceType.USER if user else None,
                resource_id=user.id if user else None,
                details={
                    "email_attempted": email,
                    "failure_reason": str(exc),
                },
            )
            await self._session.commit()
            raise

    async def register(
        self,
        email: str,
        username: str,
        password: str,
        full_name: str | None = None,
        user_agent: str = "",
    ) -> AuthResult:
        """Register a new user; refused when public registration is disabled.

        Every reject path - public-registration disabled, collision,
        password-policy failure - writes ``AUTH_REGISTER_REJECTED`` with a
        ``reason`` tag so an attacker trying to enumerate accounts shows
        up as a burst of rejects in the audit log instead of disappearing
        into application logs.
        """
        email = normalize_email(email)
        try:
            if not await public_registration_enabled(self._session):
                await self._audit_register_rejected(
                    email=email, reason="public_registration_disabled"
                )
                raise RegistrationError("Public registration is disabled. You must be invited.")

            existing_user = await self._get_user_by_email(email)
            existing_username = await self._get_user_by_username(username)
            if existing_user or existing_username:
                # Audit the actual reason for ops visibility; client message
                # stays generic so the API does not leak which field hit.
                await self._audit_register_rejected(
                    email=email,
                    reason=("email_taken" if existing_user else "username_taken"),
                    username=username,
                )
                raise RegistrationError("Could not create account with these credentials")

            try:
                validate_password(password)
            except Exception as exc:
                await self._audit_register_rejected(
                    email=email,
                    reason="password_policy",
                    username=username,
                    detail=str(exc),
                )
                raise RegistrationError(str(exc)) from exc

            hashed_password = hash_password(password)

            user = User(
                email=email,
                username=username,
                hashed_password=hashed_password,
                full_name=full_name,
            )
            try:
                self._session.add(user)
                await self._session.flush()

                session_record = await self._stage_session(user.id, user_agent)

                access_token = create_access_token(
                    user.id,
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
                session_record.refresh_token_hash = hash_refresh_token(refresh_token)
                await write_audit_event(
                    self._session,
                    organization_id=None,
                    actor_user_id=user.id,
                    action=Action.AUTH_REGISTER_SUCCESS,
                    resource_type=AuditResourceType.USER,
                    resource_id=user.id,
                    details={
                        "email": user.email,
                        "username": user.username,
                        "session_id": str(session_record.id),
                    },
                )
                await self._session.commit()
            except Exception:
                await self._session.rollback()
                raise

            logger.info(f"User {user.email} registered successfully")
            AUTH_ATTEMPTS_TOTAL.labels(operation="register", outcome="success").inc()

            return AuthResult(
                access_token=access_token,
                refresh_token=refresh_token,
                user_id=user.id,
                session_id=session_record.id,
            )
        except RegistrationError:
            AUTH_ATTEMPTS_TOTAL.labels(operation="register", outcome="failure").inc()
            raise

    async def refresh_token(
        self,
        refresh_token: str,
        organization_slug: str | None = None,
    ) -> AuthResult:
        """Refresh an access token; rotates the refresh token + detects reuse.

        The session row owns the tenant binding: a refresh stays in whichever
        org the session was created for. Passing ``organization_slug`` is
        only accepted when it matches the session's bound org (idempotent
        no-op) - any cross-org switch must go through ``switch_organization``
        instead, so a leaked refresh token cannot pivot tenants.
        """
        try:
            try:
                payload = decode_refresh_token(refresh_token)
            except Exception as e:
                raise TokenError(f"Invalid refresh token: {e}")

            user_id = UUID(payload["sub"])
            token_version_in_jwt = payload.get("tkv")
            session_id_str = payload.get("sid")

            user = await self._get_user_by_id(user_id)
            if not user:
                raise TokenError("User not found")

            if not user.is_active:
                raise TokenError("User account is deactivated")

            if token_version_in_jwt is not None and token_version_in_jwt != user.token_version:
                logger.warning(
                    f"Token version mismatch for user {user_id}: "
                    f"token has {token_version_in_jwt}, user has {user.token_version}"
                )
                raise TokenError("Token has been revoked")

            session_id: UUID | None = None
            session_record: UserSession | None = None
            if session_id_str:
                session_id = UUID(session_id_str)
                session_record = await self._validate_and_touch_session(session_id, user_id)
                await self._enforce_refresh_rotation(
                    user=user,
                    session_record=session_record,
                    incoming_refresh=refresh_token,
                )

            organization_id: UUID | None = None
            organization_slug_resolved: str | None = None
            organization_role: str | None = None
            domain_admin_domains: list[str] | None = None

            session_org_id = session_record.organization_id if session_record else None

            if session_org_id is not None:
                (
                    organization_id,
                    organization_slug_resolved,
                    organization_role,
                    domain_admin_domains,
                ) = await self._verify_org_membership_by_id(user_id, session_org_id)
                if organization_slug and organization_slug != organization_slug_resolved:
                    raise TokenError(
                        "Refresh is bound to a different organization; "
                        "call SwitchOrganization to change tenant context"
                    )
            elif organization_slug:
                (
                    organization_id,
                    organization_slug_resolved,
                    organization_role,
                    domain_admin_domains,
                ) = await self._verify_org_membership(user_id, organization_slug)
                if session_record is not None:
                    session_record.organization_id = organization_id

            access_token = create_access_token(
                user_id,
                organization_id,
                token_version=user.token_version,
                session_id=session_id,
                full_name=user.full_name,
                avatar_key=user.avatar_key,
            )
            new_refresh_token = create_refresh_token(
                user_id,
                token_version=user.token_version,
                session_id=session_id,
            )

            if session_record is not None:
                now = datetime.now(UTC)
                session_record.previous_refresh_token_hash = session_record.refresh_token_hash
                session_record.previous_refresh_rotated_at = now
                session_record.refresh_token_hash = hash_refresh_token(new_refresh_token)

            AUTH_ATTEMPTS_TOTAL.labels(operation="refresh", outcome="success").inc()

            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AUTH_TOKEN_REFRESHED,
                resource_type=AuditResourceType.USER,
                resource_id=user_id,
                details={"session_id": str(session_id) if session_id else None},
                dedupe_key=str(user_id),
                dedupe_ttl_seconds=3600,
            )
            await self._session.commit()

            return AuthResult(
                access_token=access_token,
                refresh_token=new_refresh_token,
                user_id=user_id,
                organization_id=organization_id,
                organization_slug=organization_slug_resolved,
                organization_role=organization_role,
                session_id=session_id,
                domain_admin_domains=domain_admin_domains,
            )
        except TokenError:
            AUTH_ATTEMPTS_TOTAL.labels(operation="refresh", outcome="failure").inc()
            raise

    async def switch_organization(
        self,
        refresh_token: str,
        organization_slug: str,
        user_agent: str = "",
    ) -> AuthResult:
        """Move the user into ``organization_slug`` by minting a fresh session.

        Validates the incoming refresh + rotation state the same way
        ``refresh_token`` does, then revokes the current session and
        creates a new one bound to the target org. The old refresh
        token is single-use against this RPC.
        """
        try:
            try:
                payload = decode_refresh_token(refresh_token)
            except Exception as e:
                raise TokenError(f"Invalid refresh token: {e}")

            user_id = UUID(payload["sub"])
            token_version_in_jwt = payload.get("tkv")
            session_id_str = payload.get("sid")

            user = await self._get_user_by_id(user_id)
            if not user:
                raise TokenError("User not found")
            if not user.is_active:
                raise TokenError("User account is deactivated")
            if token_version_in_jwt is not None and token_version_in_jwt != user.token_version:
                raise TokenError("Token has been revoked")

            if session_id_str:
                old_session_id = UUID(session_id_str)
                old_session = await self._validate_and_touch_session(old_session_id, user_id)
                await self._enforce_refresh_rotation(
                    user=user,
                    session_record=old_session,
                    incoming_refresh=refresh_token,
                )
            else:
                old_session = None
                old_session_id = None

            (
                organization_id,
                organization_slug_resolved,
                organization_role,
                domain_admin_domains,
            ) = await self._verify_org_membership(user_id, organization_slug)

            if old_session is not None:
                old_session.is_revoked = True
                old_session.revoked_at = datetime.now(UTC)

            new_session = await self._stage_session(
                user_id, user_agent, organization_id=organization_id
            )

            access_token = create_access_token(
                user_id,
                organization_id,
                token_version=user.token_version,
                session_id=new_session.id,
                full_name=user.full_name,
                avatar_key=user.avatar_key,
            )
            new_refresh = create_refresh_token(
                user_id,
                token_version=user.token_version,
                session_id=new_session.id,
            )
            new_session.refresh_token_hash = hash_refresh_token(new_refresh)

            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AUTH_TOKEN_REFRESHED,
                resource_type=AuditResourceType.USER_SESSION,
                resource_id=new_session.id,
                details={
                    "event": "org_switch",
                    "previous_session_id": str(old_session_id) if old_session_id else None,
                    "target_org_id": str(organization_id),
                },
            )
            await self._session.commit()

            if old_session_id is not None:
                await mark_session_revoked(old_session_id)
                await _publish_session_revoke_safe(user_id, old_session_id)
                await self._call_lifecycle.evict_user(
                    self._session,
                    user_id,
                    reason=CallEvictionReason.SESSION_REVOKED,
                    session_ids=[old_session_id],
                )

            AUTH_ATTEMPTS_TOTAL.labels(operation="switch_org", outcome="success").inc()

            return AuthResult(
                access_token=access_token,
                refresh_token=new_refresh,
                user_id=user_id,
                organization_id=organization_id,
                organization_slug=organization_slug_resolved,
                organization_role=organization_role,
                session_id=new_session.id,
                domain_admin_domains=domain_admin_domains,
            )
        except TokenError:
            AUTH_ATTEMPTS_TOTAL.labels(operation="switch_org", outcome="failure").inc()
            raise

    async def _enforce_refresh_rotation(
        self,
        *,
        user: User,
        session_record: UserSession,
        incoming_refresh: str,
    ) -> None:
        """Refuse stolen-token replay; tolerate the brief cross-tab race."""
        incoming_hash = hash_refresh_token(incoming_refresh)
        current = session_record.refresh_token_hash
        previous = session_record.previous_refresh_token_hash
        rotated_at = session_record.previous_refresh_rotated_at

        if current is None:
            # Legacy session from before rotation tracking existed.
            return
        if incoming_hash == current:
            return
        if (
            previous is not None
            and incoming_hash == previous
            and rotated_at is not None
            and datetime.now(UTC) - rotated_at <= timedelta(seconds=REFRESH_GRACE_SECONDS)
        ):
            return

        await self._punish_refresh_reuse(user=user, session_record=session_record)
        raise TokenError("Refresh token reuse detected; all sessions revoked")

    async def _punish_refresh_reuse(
        self,
        *,
        user: User,
        session_record: UserSession,
    ) -> None:
        """Revoke every active session for the user and bump ``token_version``.

        Reusing an old refresh after rotation is the textbook stolen-token
        signal - either the attacker or the legitimate client is racing the
        other on the next refresh, so the safe move is to kill both.
        """
        revoked_ids = await revoke_user_sessions(self._session, user.id)

        user.token_version = (user.token_version or 0) + 1
        new_version = user.token_version
        await self._session.execute(
            update(User)
            .where(User.id == user.id)
            .values(
                token_version=new_version,
                cache_key_seed=os.urandom(32),
            )
        )

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user.id,
            action=Action.AUTH_REFRESH_REUSE_DETECTED,
            resource_type=AuditResourceType.USER,
            resource_id=user.id,
            details={
                "trigger_session_id": str(session_record.id),
                "revoked_session_count": len(revoked_ids),
                "new_token_version": new_version,
            },
        )
        await self._session.commit()
        await mark_token_version_revoked(user.id, new_version)
        await mark_sessions_revoked(revoked_ids)
        # Publish the token_version bump so the realtime router closes
        # every open WS for this user with code 4410 instead of letting
        # the streams ride out their natural disconnect.
        from uniffy.core.realtime.publisher import publish_token_revoke

        await publish_token_revoke(user.id, new_version)
        await self._call_lifecycle.evict_user(
            self._session,
            user.id,
            reason=CallEvictionReason.SESSION_REVOKED,
        )
        logger.warning(
            "auth.refresh_reuse_detected",
            user_id=str(user.id),
            session_id=str(session_record.id),
        )

    async def list_sessions(self, user_id: UUID) -> list[UserSession]:
        """List active (non-revoked) sessions, ordered by last_activity desc."""
        result = await self._session.execute(
            select(UserSession)
            .where(
                UserSession.user_id == user_id,
                UserSession.is_revoked.is_(False),
            )
            .order_by(UserSession.last_activity.desc())
        )
        return list(result.scalars().all())

    async def revoke_session(self, user_id: UUID, session_id: UUID) -> bool:
        """Revoke a session owned by `user_id`.

        Flips the DB row and publishes a Valkey revoked-sid marker so
        the access token issued from this session is rejected within a
        Valkey round-trip rather than waiting for natural expiry.
        """
        result = await self._session.execute(
            select(UserSession).where(
                UserSession.id == session_id,
                UserSession.user_id == user_id,
                UserSession.is_revoked.is_(False),
            )
        )
        session_record = result.scalar_one_or_none()

        if not session_record:
            raise TokenError("Session not found")

        session_record.is_revoked = True
        session_record.revoked_at = datetime.now(UTC)

        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.AUTH_SESSION_TERMINATED,
            resource_type=AuditResourceType.USER_SESSION,
            resource_id=session_id,
            details={"initiator": "self"},
        )
        await self._session.commit()
        await mark_session_revoked(session_id)
        await _publish_session_revoke_safe(user_id, session_id)
        await self._call_lifecycle.evict_user(
            self._session,
            user_id,
            reason=CallEvictionReason.SESSION_REVOKED,
            session_ids=[session_id],
        )

        logger.info(f"Session {session_id} revoked for user {user_id}")
        return True

    async def revoke_other_sessions(
        self,
        user_id: UUID,
        current_session_id: UUID,
    ) -> int:
        """Revoke all sessions except `current_session_id`; returns the count.

        Each revoked session publishes its own Valkey ``revoked_sid``
        marker so the matching access tokens stop working within a
        Valkey round-trip - bumping ``token_version`` would also kill
        the current session, which is the opposite of what the user
        asked for.
        """
        now = datetime.now(UTC)
        target_rows = (
            await self._session.execute(
                select(UserSession.id).where(
                    UserSession.user_id == user_id,
                    UserSession.id != current_session_id,
                    UserSession.is_revoked.is_(False),
                )
            )
        ).all()
        target_session_ids = [row[0] for row in target_rows]

        if target_session_ids:
            await self._session.execute(
                update(UserSession)
                .where(UserSession.id.in_(target_session_ids))
                .values(is_revoked=True, revoked_at=now)
            )

        # Rotate cache_key_seed so device-side caches invalidate.
        await self._session.execute(
            update(User).where(User.id == user_id).values(cache_key_seed=os.urandom(32))
        )

        revoked_count = len(target_session_ids)
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.AUTH_TOKEN_REVOKED,
            resource_type=AuditResourceType.USER,
            resource_id=user_id,
            details={
                "actor": "self",
                "revoked_session_count": revoked_count,
                "kept_session_id": str(current_session_id),
            },
        )

        await self._session.commit()
        await mark_sessions_revoked(target_session_ids)
        for sid in target_session_ids:
            await _publish_session_revoke_safe(user_id, sid)
        await self._call_lifecycle.evict_user(
            self._session,
            user_id,
            reason=CallEvictionReason.SESSION_REVOKED,
            session_ids=target_session_ids,
        )

        logger.info(
            f"Revoked {revoked_count} other sessions for user {user_id}, "
            f"kept session {current_session_id}"
        )
        return revoked_count

    async def get_cache_key_seed(self, user_id: UUID) -> bytes:
        """Return the 32-byte cache_key_seed for the authenticated user."""
        result = await self._session.execute(select(User.cache_key_seed).where(User.id == user_id))
        seed = result.scalar_one_or_none()
        if seed is None:
            raise AuthenticationError("User not found")
        return seed

    async def rotate_cache_key_seed(
        self,
        user_id: UUID,
        target_user_id: UUID | None = None,
    ) -> bytes:
        """Generate and store a fresh 32-byte cache_key_seed."""
        effective_user_id = target_user_id or user_id
        new_seed = os.urandom(32)

        await self._session.execute(
            update(User).where(User.id == effective_user_id).values(cache_key_seed=new_seed)
        )
        await self._session.commit()

        logger.info(f"Cache key seed rotated for user {effective_user_id}")
        return new_seed

    async def logout_session(self, user_id: UUID, session_id: UUID) -> None:
        """Revoke the current session on logout; publishes the Valkey marker too."""
        result = await self._session.execute(
            select(UserSession).where(
                UserSession.id == session_id,
                UserSession.user_id == user_id,
                UserSession.is_revoked.is_(False),
            )
        )
        session_record = result.scalar_one_or_none()
        if session_record:
            session_record.is_revoked = True
            session_record.revoked_at = datetime.now(UTC)
            await write_audit_event(
                self._session,
                organization_id=None,
                actor_user_id=user_id,
                action=Action.AUTH_SESSION_TERMINATED,
                resource_type=AuditResourceType.USER_SESSION,
                resource_id=session_id,
                details={"initiator": "logout"},
            )
            await self._session.commit()
            await mark_session_revoked(session_id)
            await _publish_session_revoke_safe(user_id, session_id)
            await self._call_lifecycle.evict_user(
                self._session,
                user_id,
                reason=CallEvictionReason.SESSION_REVOKED,
                session_ids=[session_id],
            )
            logger.info(f"Logout: session {session_id} revoked for user {user_id}")

    async def _audit_register_rejected(
        self,
        *,
        email: str,
        reason: str,
        username: str | None = None,
        detail: str | None = None,
    ) -> None:
        """Write + commit an ``AUTH_REGISTER_REJECTED`` row with the reason tag."""
        details: dict[str, str] = {
            "email_attempted": email,
            "reason": reason,
        }
        if username is not None:
            details["username_attempted"] = username
        if detail is not None:
            details["detail"] = detail
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=None,
            action=Action.AUTH_REGISTER_REJECTED,
            resource_type=None,
            resource_id=None,
            details=details,
        )
        await self._session.commit()

    async def _stage_session(
        self,
        user_id: UUID,
        user_agent: str,
        organization_id: UUID | None = None,
    ) -> UserSession:
        """Stage a session in the caller's authoritative transaction.

        ``organization_id`` pins the session to a tenant; later refreshes
        re-mint access tokens against this org so a forgotten slug on the
        client cannot silently drop the user out of their org. ``None`` is
        used by register-without-org and the MFA-not-yet-bound flows; the
        first explicit org context written to the session promotes it.
        """
        device_label = parse_device_label(user_agent)
        session_record = UserSession(
            user_id=user_id,
            organization_id=organization_id,
            user_agent=user_agent[:512],
            device_label=device_label,
            ip_address=(audit_ip_var.get() or "")[:45],
        )
        self._session.add(session_record)
        await self._session.flush()
        return session_record

    async def _validate_and_touch_session(
        self,
        session_id: UUID,
        user_id: UUID,
    ) -> UserSession:
        """Validate the session is still active and return the row.

        Raises ``TokenError`` if revoked or missing. Returned so the
        caller can read + mutate the refresh-token rotation columns
        inside the same transaction.
        """
        result = await self._session.execute(
            select(UserSession).where(
                UserSession.id == session_id,
                UserSession.user_id == user_id,
            )
        )
        session_record = result.scalar_one_or_none()

        if not session_record:
            raise TokenError("Session not found")

        if session_record.is_revoked:
            raise TokenError("Session has been revoked")

        session_record.last_activity = datetime.now(UTC)
        return session_record

    async def _load_user_mfa(self, user_id: UUID) -> UserMfa | None:
        """Return the user's MFA row or ``None`` when they never enrolled."""
        result = await self._session.execute(select(UserMfa).where(UserMfa.user_id == user_id))
        return result.scalar_one_or_none()

    async def _enforce_login_rate_limit(self, email: str) -> None:
        """Throttle the password step before bcrypt burns CPU.

        Per-email is the must-have bucket; per-IP is a defense in depth that
        only applies when the IP is actually a client identifier (public
        address, or ``TRUSTED_PROXY_HOPS`` configured). Behind an
        unconfigured reverse proxy the per-IP bucket would collapse every
        request onto the proxy's socket address and lock out everyone, so
        we skip it rather than DoS the whole tenant.
        """
        email_key = (email or "").strip().lower()
        if email_key:
            await check_rate_limit(
                key=f"rl:auth:login:email:{email_key}",
                limit=LOGIN_RATE_LIMIT_EMAIL,
                window_seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS,
                resource="login attempts (per email)",
            )
        ip = client_ip_for_rate_limit()
        if ip:
            await check_rate_limit(
                key=f"rl:auth:login:ip:{ip}",
                limit=LOGIN_RATE_LIMIT_IP,
                window_seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS,
                resource="login attempts (per ip)",
            )

    async def _get_user_by_id(self, user_id: UUID) -> User | None:
        """Get user by ID."""
        result = await self._session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def _get_user_by_email(self, email: str) -> User | None:
        """Get user by email address; the caller is responsible for normalization."""
        result = await self._session.execute(
            select(User).where(User.email == normalize_email(email))
        )
        return result.scalar_one_or_none()

    async def _get_user_by_username(self, username: str) -> User | None:
        """Get user by username."""
        result = await self._session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_slug: str,
    ) -> tuple[UUID, str, str, list[str]]:
        """Resolve a slug to ``(org_id, slug, role, domain_admins)``.

        Raises ``AuthenticationError`` when the org does not exist, is
        suspended/deleted, or the user is not an active member.
        """
        result = await self._session.execute(
            select(Organization).where(Organization.slug == organization_slug)
        )
        org = result.scalar_one_or_none()
        if not org:
            raise AuthenticationError("Organization not found")
        return await self._finalize_org_membership(user_id, org)

    async def _verify_org_membership_by_id(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> tuple[UUID, str, str, list[str]]:
        """Same as ``_verify_org_membership`` but keyed off the session's bound id."""
        result = await self._session.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        org = result.scalar_one_or_none()
        if not org:
            raise AuthenticationError("Organization not found")
        return await self._finalize_org_membership(user_id, org)

    async def _finalize_org_membership(
        self,
        user_id: UUID,
        org: Organization,
    ) -> tuple[UUID, str, str, list[str]]:
        if org.deleted_at is not None:
            raise AuthenticationError("Organization has been deleted")
        if org.is_suspended:
            raise AuthenticationError("Organization is suspended")

        result = await self._session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org.id,
            )
        )
        membership = result.scalar_one_or_none()
        if not membership or not membership.is_active:
            raise AuthenticationError("User is not a member of this organization")

        from uniffy.core.auth.domain_admin import get_user_domain_admins

        domain_admins = await get_user_domain_admins(self._session, user_id, org.id)
        domain_admin_values = [d.value for d in domain_admins]

        return org.id, org.slug, membership.role.value, domain_admin_values
