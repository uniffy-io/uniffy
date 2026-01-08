"""User repository for database operations."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.models import User


async def get_user_by_id(session: AsyncSession, user_id: UUID) -> User | None:
    """
    Get a user by ID.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User ID to lookup.

    Returns
    -------
    User | None
        User if found, None otherwise.

    """
    result = await session.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """
    Get a user by email address.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    email : str
        Email address to lookup.

    Returns
    -------
    User | None
        User if found, None otherwise.

    """
    result = await session.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_username(session: AsyncSession, username: str) -> User | None:
    """
    Get a user by username.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    username : str
        Username to lookup.

    Returns
    -------
    User | None
        User if found, None otherwise.

    """
    result = await session.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def create_user(
    session: AsyncSession,
    email: str,
    username: str,
    hashed_password: str | None,
    full_name: str | None = None,
) -> User:
    """
    Create a new user.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    email : str
        User email.
    username : str
        Username.
    hashed_password : str | None
        Hashed password (None for SSO-only users).
    full_name : str | None
        Optional full name.

    Returns
    -------
    User
        Created user.

    """
    user = User(
        email=email,
        username=username,
        hashed_password=hashed_password,
        full_name=full_name,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
