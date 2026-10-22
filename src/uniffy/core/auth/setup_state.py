"""Whether the deployment still waits for its first run setup."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.user import User


async def setup_required(session: AsyncSession) -> bool:
    """Any user row closes setup, so registration must not create the first one."""
    return (await session.execute(select(User.id).limit(1))).scalar_one_or_none() is None


__all__ = ["setup_required"]
