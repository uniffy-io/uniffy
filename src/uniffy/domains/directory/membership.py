"""Directory membership capabilities consumed by other domains."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
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


async def filter_active_members(
    session: AsyncSession, organization_id: UUID, user_ids: Iterable[UUID]
) -> set[UUID]:
    """Keep the ids whose account and membership in `organization_id` are both active."""
    candidates = set(user_ids)
    if not candidates:
        return set()
    result = await session.execute(
        select(OrganizationMember.user_id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id.in_(candidates),
            OrganizationMember.is_active.is_(True),
            User.is_active.is_(True),
        )
    )
    return {row[0] for row in result.all()}
