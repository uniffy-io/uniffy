"""Transaction locks shared by time records, approval transitions and destructive cleanup."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def lock_time_organization(
    session: AsyncSession, organization_id: UUID, *, exclusive: bool = False
) -> None:
    lock = func.pg_advisory_xact_lock if exclusive else func.pg_advisory_xact_lock_shared
    await session.execute(select(lock(func.hashtextextended(f"time:org:{organization_id}", 0))))


async def lock_time_people(
    session: AsyncSession, organization_id: UUID, user_ids: Iterable[UUID]
) -> None:
    # Lock absent timers and sheets too. Organization gates precede sorted people, then task rows.
    await lock_time_organization(session, organization_id)
    for user_id in sorted(set(user_ids)):
        await session.execute(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtextextended(f"time:person:{organization_id}:{user_id}", 0)
                )
            )
        )
