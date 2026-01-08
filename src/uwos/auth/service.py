"""Authentication service."""

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uwos.auth.jwt import create_access_token, create_refresh_token, decode_access_token
from uwos.auth.password import hash_password, verify_password
from uwos.repositories.organization import (
    get_organization_by_slug,
    get_user_organization_membership,
)
from uwos.repositories.user import create_user, get_user_by_email

logger = logging.getLogger(__name__)


@dataclass
class AuthResult:
    """Authentication result containing tokens and user context."""

    access_token: str
    refresh_token: str
    user_id: UUID
    organization_id: UUID | None = None


class AuthenticationError(Exception):
    """Exception raised for authentication failures."""

    pass


async def authenticate_user(
    session: AsyncSession, email: str, password: str, organization_slug: str | None = None
) -> AuthResult:
    """
    Authenticate a user with email and password.

    Parameters
    ----------
    session : AsyncSession
        Database session.
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
    user = await get_user_by_email(session, email)
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
        org = await get_organization_by_slug(session, organization_slug)
        if not org:
            raise AuthenticationError("Organization not found")

        # Check if user is member of organization
        membership = await get_user_organization_membership(session, user.id, org.id)
        if not membership or not membership.is_active:
            raise AuthenticationError("User is not a member of this organization")

        organization_id = org.id

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


async def register_user(
    session: AsyncSession,
    email: str,
    username: str,
    password: str,
    full_name: str | None = None,
    organization_slug: str | None = None,
) -> AuthResult:
    """
    Register a new user.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    email : str
        User email.
    username : str
        Desired username.
    password : str
        User password.
    full_name : str | None
        Optional full name.
    organization_slug : str | None
        Optional organization to join after registration.

    Returns
    -------
    AuthResult
        Authentication tokens and user info.

    Raises
    ------
    AuthenticationError
        If registration fails.

    """
    # Check if email already exists
    existing_user = await get_user_by_email(session, email)
    if existing_user:
        raise AuthenticationError("Email already registered")

    # Hash password
    hashed_password = hash_password(password)

    # Create user
    user = await create_user(
        session,
        email=email,
        username=username,
        hashed_password=hashed_password,
        full_name=full_name,
    )

    logger.info(f"User {user.email} registered successfully")

    # Create tokens
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    return AuthResult(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id=user.id,
    )


async def refresh_access_token(
    session: AsyncSession, refresh_token: str, organization_slug: str | None = None
) -> AuthResult:
    """
    Refresh an access token.

    Parameters
    ----------
    session : AsyncSession
        Database session.
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
    AuthenticationError
        If refresh fails.

    """
    try:
        payload = decode_access_token(refresh_token)
    except Exception as e:
        raise AuthenticationError(f"Invalid refresh token: {e}")

    if payload.get("type") != "refresh":
        raise AuthenticationError("Invalid token type")

    user_id = UUID(payload["sub"])

    # Handle organization context
    organization_id = None
    if organization_slug:
        org = await get_organization_by_slug(session, organization_slug)
        if not org:
            raise AuthenticationError("Organization not found")

        membership = await get_user_organization_membership(session, user_id, org.id)
        if not membership or not membership.is_active:
            raise AuthenticationError("User is not a member of this organization")

        organization_id = org.id

    # Create new tokens
    access_token = create_access_token(user_id, organization_id)
    new_refresh_token = create_refresh_token(user_id)

    return AuthResult(
        access_token=access_token,
        refresh_token=new_refresh_token,
        user_id=user_id,
        organization_id=organization_id,
    )
