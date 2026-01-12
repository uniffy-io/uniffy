"""Authentication operations - login, register, refresh token."""

from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.models.login.organization import Organization
from uwos.core.models.login.organization_member import OrganizationMember
from uwos.core.models.login.user import User
from uwos.domains.auth.errors import AuthenticationError, RegistrationError, TokenError
from uwos.domains.auth.passwords import hash_password, verify_password
from uwos.domains.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
)
from uwos.domains.auth.types import AuthResult


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

        Returns
        -------
        AuthResult
            Authentication tokens and user info.

        Raises
        ------
        AuthenticationError
            If authentication fails.

        """
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
        if organization_slug:
            organization_id = await self._verify_org_membership(user.id, organization_slug)

        # Create tokens
        access_token = create_access_token(user.id, organization_id)
        refresh_token = create_refresh_token(user.id)

        logger.info(f"User {user.email} authenticated successfully")

        return AuthResult(
            access_token=access_token,
            refresh_token=refresh_token,
            user_id=user.id,
            organization_id=organization_id,
        )

    async def register(
        self,
        email: str,
        username: str,
        password: str,
        full_name: str | None = None,
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

        Returns
        -------
        AuthResult
            Authentication tokens and user info.

        Raises
        ------
        RegistrationError
            If registration fails.

        """
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

        # Create tokens
        access_token = create_access_token(user.id)
        refresh_token = create_refresh_token(user.id)

        return AuthResult(
            access_token=access_token,
            refresh_token=refresh_token,
            user_id=user.id,
        )

    async def refresh_token(
        self,
        refresh_token: str,
        organization_slug: str | None = None,
    ) -> AuthResult:
        """
        Refresh an access token.

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
            If refresh fails.

        """
        try:
            payload = decode_access_token(refresh_token)
        except Exception as e:
            raise TokenError(f"Invalid refresh token: {e}")

        if payload.get("type") != "refresh":
            raise TokenError("Invalid token type")

        user_id = UUID(payload["sub"])

        # Handle organization context
        organization_id = None
        if organization_slug:
            organization_id = await self._verify_org_membership(user_id, organization_slug)

        # Create new tokens
        access_token = create_access_token(user_id, organization_id)
        new_refresh_token = create_refresh_token(user_id)

        return AuthResult(
            access_token=access_token,
            refresh_token=new_refresh_token,
            user_id=user_id,
            organization_id=organization_id,
        )

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

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
    ) -> UUID:
        """
        Verify user is member of organization and return org ID.

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

        return org.id
