"""Directory membership capabilities consumed by other domains."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.domains.directory.groups.cache import (
    get_cached_user_team_ids,
    set_cached_user_team_ids,
)


async def user_team_ids(
    session: AsyncSession,
    organization_id: UUID,
    user_id: UUID,
) -> list[UUID]:
    """Resolve active TEAM memberships through the hot-path cache."""
    cached = await get_cached_user_team_ids(organization_id, user_id)
    if cached is not None:
        return [UUID(value) for value in cached]

    result = await session.execute(
        select(Group.id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
            GroupMember.user_id == user_id,
            GroupMember.is_active.is_(True),
        )
    )
    team_ids = [row[0] for row in result.all()]
    await set_cached_user_team_ids(organization_id, user_id, [str(team_id) for team_id in team_ids])
    return team_ids
