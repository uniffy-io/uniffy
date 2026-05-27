"""Authentication operations - login, register, refresh token, session management."""

import os
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import audit_ip_var, write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import RateLimitExceededError
from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_mfa import UserMfa
from uniffy.core.models.login.user_session import UserSession
from uniffy.core.valkey.rate_limit import check_rate_limit
from uniffy.domains.auth.context import parse_device_label
from uniffy.domains.auth.errors import AuthenticationError, RegistrationError, TokenError
from uniffy.domains.auth.mfa.challenge import (
    create_enrollment_only_token,
    create_mfa_challenge_token,
)
from uniffy.domains.auth.mfa.enforcement import (
    MfaRequirement,
    evaluate_mfa_requirement,
)
from uniffy.domains.auth.passwords import hash_password, verify_password
from uniffy.domains.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
)
from uniffy.domains.auth.types import (
    AuthOutcome,
    AuthResult,
    MfaChallengeRequired,
    MfaEnrollmentRequired,
)
from uniffy.domains.system_config.operations import public_registration_enabled
from uniffy.observability.metrics import AUTH_ATTEMPTS_TOTAL

LOGIN_RATE_LIMIT_EMAIL = 10
LOGIN_RATE_LIMIT_IP = 30
LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60


async def is_public_registration_enabled(session: AsyncSession) -> bool:
    """Return True when the public ``Register`` RPC is allowed to create users.

    Resolution chain (in order):

    1. ``deployment_settings(namespace='system', key='public_registration')`` --
       the operator-edited row written from ``/platform/server-settings``.
    2. Env ``ALLOW_PUBLIC_REGISTRATION`` -- used as the seed value when no
       row exists. Operators can ship without env and set the flag from
       the UI, or ship with env and override later.
    3. Coded default ``False`` -- production-safe.
    """
    return await public_registration_enabled(session)


class AuthOperations:
    """Authentication operations handler."""

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize auth operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self._session = session

    async def authenticate(
        self,
        email: str,
        password: str,
        organization_slug: str | None = None,
        user_agent: str = "",
    ) -> AuthOutcome:
        """
        Authenticate a user with email and password.

        Parameters
        ----------
        email : str
            User email.
        password : str
            User password.
        organization_slug : str | None
            Optional organization slug to authenticate into.
        user_agent : str
            Client User-Agent for session tracking.

        Returns
        -------
        AuthResult
            Authentication tokens and user info.

        Raises
        ------
        AuthenticationError
            If authentication fails.

        """
        user: User | None = None
        organization_id: UUID | None = None
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

            organization_role = None
            domain_admin_domains: list[str] | None = None
            if organization_slug:
                (
                    organization_id,
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
                    resource_type="USER",
                    resource_id=user.id,
                    details={
                        "email": user.email,
                        "mfa_challenge_issued": True,
                    },
                )
                await self._session.commit()
                AUTH_ATTEMPTS_TOTAL.labels(
                    operation="authenticate", outcome="mfa_challenge"
                ).inc()
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
                    user.id, token_version=user.token_version
                )
                await write_audit_event(
                    self._session,
                    organization_id=organization_id,
                    actor_user_id=user.id,
                    action=Action.AUTH_LOGIN_SUCCESS,
                    resource_type="USER",
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

            session_record = await self._create_session(user.id, user_agent)

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

            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user.id,
                action=Action.AUTH_LOGIN_SUCCESS,
                resource_type="USER",
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
                organization_role=organization_role,
                session_id=session_record.id,
                domain_admin_domains=domain_admin_domains,
            )
        except RateLimitExceededError as exc:
            AUTH_ATTEMPTS_TOTAL.labels(
                operation="authenticate", outcome="rate_limited"
            ).inc()
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
                resource_type="USER" if user else None,
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
        """
        Register a new user.

        Parameters
        ----------
        email : str
            User email.
        username : str
            Desired username.
        password : str
            User password.
        full_name : str | None
            Optional full name.
        user_agent : str
            Client User-Agent for session tracking.

        Returns
        -------
        AuthResult
            Authentication tokens and user info.

        Raises
        ------
        RegistrationError
            If registration fails.

        """
        try:
            if not await is_public_registration_enabled(self._session):
                await write_audit_event(
                    self._session,
                    organization_id=None,
                    actor_user_id=None,
                    action=Action.AUTH_REGISTER_REJECTED,
                    resource_type=None,
                    resource_id=None,
                    details={"email_attempted": email},
                )
                await self._session.commit()
                raise RegistrationError(
                    "Public registration is disabled. You must be invited."
                )

            # Check if email already exists
            existing_user = await self._get_user_by_email(email)
            if existing_user:
                raise RegistrationError("Email already registered")

            # Check if username already exists
            existing_username = await self._get_user_by_username(username)
            if existing_username:
                raise RegistrationError("Username already taken")

            # Hash password and create user
            hashed_password = hash_password(password)

            user = User(
                email=email,
                username=username,
                hashed_password=hashed_password,
                full_name=full_name,
            )
            self._session.add(user)
            await self._session.commit()
            await self._session.refresh(user)

            logger.info(f"User {user.email} registered successfully")

            # Create session record
            session_record = await self._create_session(user.id, user_agent)

            # Create tokens with token_version and session_id
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
        """
        Refresh an access token.

        Validates that the user still exists, is active, and the token version
        matches. Also validates the session is still active (if session_id present).

        Parameters
        ----------
        refresh_token : str
            Refresh token.
        organization_slug : str | None
            Optional organization to switch context.

        Returns
        -------
        AuthResult
            New authentication tokens.

        Raises
        ------
        TokenError
            If refresh fails (invalid token, user deactivated, or token revoked).

        """
        try:
            try:
                payload = decode_access_token(refresh_token)
            except Exception as e:
                raise TokenError(f"Invalid refresh token: {e}")

            if payload.get("type") != "refresh":
                raise TokenError("Invalid token type")

            user_id = UUID(payload["sub"])
            token_version_in_jwt = payload.get("tkv")
            session_id_str = payload.get("sid")

            # Verify user exists and is active (security checkpoint)
            user = await self._get_user_by_id(user_id)
            if not user:
                raise TokenError("User not found")

            if not user.is_active:
                raise TokenError("User account is deactivated")

            # Verify token version matches (for immediate revocation)
            if token_version_in_jwt is not None and token_version_in_jwt != user.token_version:
                logger.warning(
                    f"Token version mismatch for user {user_id}: "
                    f"token has {token_version_in_jwt}, user has {user.token_version}"
                )
                raise TokenError("Token has been revoked")

            # Validate session is still active (if session_id present)
            session_id: UUID | None = None
            if session_id_str:
                session_id = UUID(session_id_str)
                await self._validate_and_touch_session(session_id, user_id)

            # Handle organization context
            organization_id = None
            organization_role = None
            domain_admin_domains: list[str] | None = None
            if organization_slug:
                (
                    organization_id,
                    organization_role,
                    domain_admin_domains,
                ) = await self._verify_org_membership(user_id, organization_slug)

            # Create new tokens with current token_version, preserving session_id
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

            AUTH_ATTEMPTS_TOTAL.labels(operation="refresh", outcome="success").inc()

            await write_audit_event(
                self._session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AUTH_TOKEN_REFRESHED,
                resource_type="USER",
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
                organization_role=organization_role,
                session_id=session_id,
                domain_admin_domains=domain_admin_domains,
            )
        except TokenError:
            AUTH_ATTEMPTS_TOTAL.labels(operation="refresh", outcome="failure").inc()
            raise

    async def list_sessions(self, user_id: UUID) -> list[UserSession]:
        """
        List active (non-revoked) sessions for a user.

        Parameters
        ----------
        user_id : UUID
            User ID.

        Returns
        -------
        list[UserSession]
            Active sessions ordered by last_activity descending.

        """
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
        """
        Revoke a specific session.

        Parameters
        ----------
        user_id : UUID
            User ID (for ownership verification).
        session_id : UUID
            Session to revoke.

        Returns
        -------
        bool
            True if the session was revoked.

        Raises
        ------
        TokenError
            If session not found or not owned by user.

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
            resource_type="USER_SESSION",
            resource_id=session_id,
            details={"initiator": "self"},
        )
        await self._session.commit()

        logger.info(f"Session {session_id} revoked for user {user_id}")
        return True

    async def revoke_other_sessions(
        self,
        user_id: UUID,
        current_session_id: UUID,
    ) -> int:
        """
        Revoke all sessions except the current one.

        Parameters
        ----------
        user_id : UUID
            User ID.
        current_session_id : UUID
            Session to keep active.

        Returns
        -------
        int
            Number of sessions revoked.

        """
        now = datetime.now(UTC)
        result = await self._session.execute(
            update(UserSession)
            .where(
                UserSession.user_id == user_id,
                UserSession.id != current_session_id,
                UserSession.is_revoked.is_(False),
            )
            .values(is_revoked=True, revoked_at=now)
        )

        # Rotate cache_key_seed to invalidate all device caches
        await self._session.execute(
            update(User).where(User.id == user_id).values(cache_key_seed=os.urandom(32))
        )

        revoked_count = result.rowcount  # type: ignore[union-attr]
        await write_audit_event(
            self._session,
            organization_id=None,
            actor_user_id=user_id,
            action=Action.AUTH_TOKEN_REVOKED,
            resource_type="USER",
            resource_id=user_id,
            details={
                "actor": "self",
                "revoked_session_count": revoked_count,
                "kept_session_id": str(current_session_id),
            },
        )

        await self._session.commit()

        logger.info(
            f"Revoked {revoked_count} other sessions for user {user_id}, "
            f"kept session {current_session_id}"
        )
        return revoked_count

    async def get_cache_key_seed(self, user_id: UUID) -> bytes:
        """
        Return the cache_key_seed for the authenticated user.

        Parameters
        ----------
        user_id : UUID
            User ID.

        Returns
        -------
        bytes
            32-byte cache key seed.

        Raises
        ------
        AuthenticationError
            If user not found.

        """
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
        """
        Rotate cache_key_seed for a user. Generates a new 32-byte random seed.

        Parameters
        ----------
        user_id : UUID
            Authenticated user ID.
        target_user_id : UUID | None
            If set, rotate another user's seed (admin only).

        Returns
        -------
        bytes
            The new 32-byte cache key seed.

        """
        effective_user_id = target_user_id or user_id
        new_seed = os.urandom(32)

        await self._session.execute(
            update(User).where(User.id == effective_user_id).values(cache_key_seed=new_seed)
        )
        await self._session.commit()

        logger.info(f"Cache key seed rotated for user {effective_user_id}")
        return new_seed

    async def logout_session(self, user_id: UUID, session_id: UUID) -> None:
        """
        Revoke the current session on logout.

        Parameters
        ----------
        user_id : UUID
            User ID.
        session_id : UUID
            Session to revoke.

        """
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
                resource_type="USER_SESSION",
                resource_id=session_id,
                details={"initiator": "logout"},
            )
            await self._session.commit()
            logger.info(f"Logout: session {session_id} revoked for user {user_id}")

    async def _create_session(
        self,
        user_id: UUID,
        user_agent: str,
    ) -> UserSession:
        """Create a new session record."""
        device_label = parse_device_label(user_agent)
        session_record = UserSession(
            user_id=user_id,
            user_agent=user_agent[:512],  # Truncate to max length
            device_label=device_label,
        )
        self._session.add(session_record)
        await self._session.commit()
        await self._session.refresh(session_record)
        return session_record

    async def _validate_and_touch_session(
        self,
        session_id: UUID,
        user_id: UUID,
    ) -> None:
        """
        Validate session is still active and update last_activity.

        Raises TokenError if session is revoked or not found.
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
        await self._session.commit()

    async def _load_user_mfa(self, user_id: UUID) -> UserMfa | None:
        """Return the user's MFA row or ``None`` when they never enrolled."""
        result = await self._session.execute(
            select(UserMfa).where(UserMfa.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def _enforce_login_rate_limit(self, email: str) -> None:
        """Throttle the password step before bcrypt burns CPU.

        Two buckets, both per-15-min: per-email (the credential under
        attack) and per-IP (the source). Both are bump-on-every-attempt
        so brute force trips the counter even when the attacker rotates
        across multiple stolen credentials. Email is lowercased so case
        variants share one bucket. Missing IP (no audit middleware on
        this path, unlikely) skips that bucket; the per-email guard is
        the must-have.
        """
        email_key = (email or "").strip().lower()
        if email_key:
            await check_rate_limit(
                key=f"rl:auth:login:email:{email_key}",
                limit=LOGIN_RATE_LIMIT_EMAIL,
                window_seconds=LOGIN_RATE_LIMIT_WINDOW_SECONDS,
                resource="login attempts (per email)",
            )
        ip = audit_ip_var.get()
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
        """Get user by email address."""
        result = await self._session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def _get_user_by_username(self, username: str) -> User | None:
        """Get user by username."""
        result = await self._session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def _verify_org_membership(
        self,
        user_id: UUID,
        organization_slug: str,
    ) -> tuple[UUID, str, list[str]]:
        """
        Verify user is member of organization and return org ID, role, and domain admin domains.

        Returns
        -------
        tuple[UUID, str, list[str]]
            Organization ID, user's role, and list of domain admin domain values.

        Raises
        ------
        AuthenticationError
            If organization not found or user not a member.

        """
        # Get organization by slug
        result = await self._session.execute(
            select(Organization).where(Organization.slug == organization_slug)
        )
        org = result.scalar_one_or_none()

        if not org:
            raise AuthenticationError("Organization not found")

        if org.deleted_at is not None:
            raise AuthenticationError("Organization has been deleted")

        if org.is_suspended:
            raise AuthenticationError("Organization is suspended")

        # Check membership
        result = await self._session.execute(
            select(OrganizationMember).where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.organization_id == org.id,
            )
        )
        membership = result.scalar_one_or_none()

        if not membership or not membership.is_active:
            raise AuthenticationError("User is not a member of this organization")

        # Fetch domain admin domains
        from uniffy.core.auth.domain_admin import get_user_domain_admins

        domain_admins = await get_user_domain_admins(self._session, user_id, org.id)
        domain_admin_values = [d.value for d in domain_admins]

        return org.id, membership.role.value, domain_admin_values
