"""PostgreSQL-backed identity lookups and platform-role gates."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, PermissionDeniedError
from uniffy.core.models.login.user import User


async def get_user_by_id(session: AsyncSession, user_id: UUID) -> User:
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise NotFoundError("User", str(user_id))
    return user


async def require_system_admin(session: AsyncSession, user_id: UUID) -> User:
    user = await get_user_by_id(session, user_id)
    if not user.is_system_admin:
        raise PermissionDeniedError("Requires system admin privileges")
    return user


__all__ = ["get_user_by_id", "require_system_admin"]
