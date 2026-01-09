"""User repository for database operations."""

from uuid import UUID

from sqlalchemy import func, select, update
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
    is_active: bool = True,
    is_system_admin: bool = False,
    email_verified: bool = False,
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
    is_active : bool
        Whether user is active.
    is_system_admin : bool
        Whether user is system admin.
    email_verified : bool
        Whether email is verified.

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
        is_active=is_active,
        is_system_admin=is_system_admin,
        email_verified=email_verified,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def list_all_users(
    session: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    query_str: str | None = None,
) -> tuple[list[User], int]:
    """
    List all users, paginated.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    page : int
        Page number.
    page_size : int
        Page size.
    query_str : str | None
        Search query string (searches email, username, full_name).

    Returns
    -------
    tuple[list[User], int]
        List of users and total count.

    """
    stmt = select(User)

    if query_str:
        search = f"%{query_str}%"
        stmt = stmt.where(
            (User.email.ilike(search))
            | (User.username.ilike(search))
            | (User.full_name.ilike(search))
        )

    # Calculate total count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await session.execute(count_stmt)
    total_count = total_result.scalar_one()

    # Apply pagination
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    stmt = stmt.order_by(User.created_at.desc())

    result = await session.execute(stmt)
    return list(result.scalars().all()), total_count


async def update_user(session: AsyncSession, user_id: UUID, **kwargs) -> User | None:
    """
    Update a user.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    user_id : UUID
        User ID.
    **kwargs
        Fields to update.

    Returns
    -------
    User | None
        Updated user if found, None otherwise.

    """
    # Filter out None values and invalid keys
    valid_keys = {
        "full_name",
        "username",
        "email",
        "is_active",
        "is_system_admin",
        "email_verified",
        "accent_color",
    }
    update_data = {k: v for k, v in kwargs.items() if k in valid_keys and v is not None}

    if not update_data:
        return await get_user_by_id(session, user_id)

    stmt = (
        update(User)
        .where(User.id == user_id)
        .values(**update_data)
        .execution_options(synchronize_session="fetch")
    )

    await session.execute(stmt)
    await session.commit()

    return await get_user_by_id(session, user_id)
