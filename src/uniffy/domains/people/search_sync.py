"""Search re-index + mention fanout for people whose denormalized facts changed."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.domains.users.search import UserSearchIndexer


async def sync_people_search(
    session: AsyncSession, organization_id: UUID, user_ids: list[UUID]
) -> None:
    """Refresh the Meilisearch document (which also fans out mention state)
    for every ACTIVE member in ``user_ids``; removed members keep their
    removal path (`remove_from_organization`) as the only index mutation.
    """
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
    indexer = UserSearchIndexer(session)
    for user in users:
        await indexer.index_for_organization(user, organization_id)
