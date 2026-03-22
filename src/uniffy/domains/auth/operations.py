"""Authentication operations - login, register, refresh token, session management."""

import os
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization import Organization
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.domains.auth.context import parse_device_label
from uniffy.domains.auth.errors import AuthenticationError, RegistrationError, TokenError
from uniffy.domains.auth.passwords import hash_password, verify_password
from uniffy.domains.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
)
from uniffy.domains.auth.types import AuthResult
from uniffy.observability.metrics import AUTH_ATTEMPTS_TOTAL


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
    ) -> AuthResult:
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
        try:
            # Get user by email
            user = await self._get_user_by_email(email)
            if not user:
                raise AuthenticationError("Invalid email or password")

            # Check if user is active
            if not user.is_active:
                raise AuthenticationError("User account is deactivated")

            # Verify password
            if not user.hashed_password:
                raise AuthenticationError("Password login not available. Please use SSO.")

            if not verify_password(password, user.hashed_password):
                raise AuthenticationError("Invalid email or password")

            # Handle organization context
            organization_id = None
            organization_role = None
            if organization_slug:
                organization_id, organization_role = await self._verify_org_membership(
                    user.id, organization_slug
                )

            # Create session record
            session_record = await self._create_session(user.id, user_agent)

            # Create tokens with token_version and session_id
            access_token = create_access_token(
                user.id,
                organization_id,
                token_version=user.token_version,
                session_id=session_record.id,
            )
            refresh_token = create_refresh_token(
                user.id,
                token_version=user.token_version,
                session_id=session_record.id,
            )

            logger.info(f"User {user.email} authenticated successfully")
            AUTH_ATTEMPTS_TOTAL.labels(operation="authenticate", outcome="success").inc()

            return AuthResult(
                access_token=access_token,
                refresh_token=refresh_token,
                user_id=user.id,
                organization_id=organization_id,
                organization_role=organization_role,
                session_id=session_record.id,
            )
        except AuthenticationError:
            AUTH_ATTEMPTS_TOTAL.labels(operation="authenticate", outcome="failure").inc()
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
            if organization_slug:
                organization_id, organization_role = await self._verify_org_membership(
                    user_id, organization_slug
                )

            # Create new tokens with current token_version, preserving session_id
            access_token = create_access_token(
                user_id,
                organization_id,
                token_version=user.token_version,
                session_id=session_id,
            )
            new_refresh_token = create_refresh_token(
                user_id,
                token_version=user.token_version,
                session_id=session_id,
            )

            AUTH_ATTEMPTS_TOTAL.labels(operation="refresh", outcome="success").inc()

            return AuthResult(
                access_token=access_token,
                refresh_token=new_refresh_token,
                user_id=user_id,
                organization_id=organization_id,
                organization_role=organization_role,
                session_id=session_id,
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
            update(User)
            .where(User.id == user_id)
            .values(cache_key_seed=os.urandom(32))
        )

        await self._session.commit()
        revoked_count = result.rowcount  # type: ignore[union-attr]

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
        result = await self._session.execute(
            select(User.cache_key_seed).where(User.id == user_id)
        )
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
            update(User)
            .where(User.id == effective_user_id)
            .values(cache_key_seed=new_seed)
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
    ) -> tuple[UUID, str]:
        """
        Verify user is member of organization and return org ID and role.

        Returns
        -------
        tuple[UUID, str]
            Organization ID and user's role (MEMBER, ADMIN, or OWNER).

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

        return org.id, membership.role.value
