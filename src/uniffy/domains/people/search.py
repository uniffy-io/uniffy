"""Search re-index + mention fanout for people whose denormalized facts changed."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.search import SearchIndexer
from uniffy.domains.users.search import UserSearchIndexer


async def sync_people_search(
    session: AsyncSession,
    search_indexer: SearchIndexer,
    organization_id: UUID,
    user_ids: list[UUID],
) -> None:
    """Refresh search and mention state only for members that remain active."""
    if not user_ids:
        return
    result = await session.execute(
        select(User)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
            User.id.in_(user_ids),
        )
    )
    users = list(result.scalars().all())
    if not users:
        return
    indexer = UserSearchIndexer(session, search_indexer)
    for user in users:
        await indexer.index_for_organization(user, organization_id)
