"""Expansion of mentioned TEAM URNs into their active member ids."""

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember


@dataclass(frozen=True)
class TeamExpansion:
    team_id: UUID
    name: str
    member_ids: tuple[UUID, ...]


async def expand_team_mentions(
    session: AsyncSession,
    organization_id: UUID,
    team_ids: Sequence[UUID],
) -> list[TeamExpansion]:
    """Active members of every mentioned team, in one query, in ``team_ids`` order.

    ACCESS-kind groups expand to nothing: only TEAM groups are mentionable, and
    a stale or hand-crafted URN must never leak an access group's roster. Teams
    with no active members are absent from the result.
    """
    if not team_ids:
        return []

    result = await session.execute(
        select(Group.id, Group.name, GroupMember.user_id)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .join(
            OrganizationMember,
            OrganizationMember.user_id == GroupMember.user_id,
        )
        .where(
            Group.id.in_(team_ids),
            Group.kind == GroupKind.TEAM,
            Group.organization_id == organization_id,
            GroupMember.is_active == True,  # noqa: E712
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active == True,  # noqa: E712
        )
        .distinct()
    )

    names: dict[UUID, str] = {}
    members: dict[UUID, list[UUID]] = {}
    for team_id, name, user_id in result.all():
        names[team_id] = name
        members.setdefault(team_id, []).append(user_id)

    expansions: list[TeamExpansion] = []
    emitted: set[UUID] = set()
    for team_id in team_ids:
        if team_id in emitted or team_id not in members:
            continue
        emitted.add(team_id)
        expansions.append(
            TeamExpansion(
                team_id=team_id,
                name=names[team_id],
                member_ids=tuple(members[team_id]),
            )
        )
    return expansions
