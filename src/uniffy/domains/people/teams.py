"""Team-flavoured reads and structure writes over TEAM-kind groups."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.domains.groups.operations import GroupOperations
from uniffy.domains.groups.search import TeamSearchIndexer
from uniffy.domains.people.cache import (
    get_cached_user_team_ids,
    invalidate_org_people,
    set_cached_user_team_ids,
)

UNSET = object()


async def teams_for_users(
    session: AsyncSession, organization_id: UUID, user_ids: list[UUID]
) -> dict[UUID, list[dict]]:
    """TEAM memberships per user in ONE query; inactive memberships confer nothing."""
    if not user_ids:
        return {}
    result = await session.execute(
        select(GroupMember.user_id, Group.id, Group.name, Group.lead_user_id)
        .join(Group, Group.id == GroupMember.group_id)
        .where(
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
            GroupMember.user_id.in_(user_ids),
            GroupMember.is_active.is_(True),
        )
        .order_by(Group.name)
    )
    teams: dict[UUID, list[dict]] = {}
    for user_id, group_id, name, lead_user_id in result.all():
        teams.setdefault(user_id, []).append(
            {
                "group_id": str(group_id),
                "name": name,
                "lead_user_id": str(lead_user_id) if lead_user_id else None,
            }
        )
    return teams


async def user_team_ids(
    session: AsyncSession, organization_id: UUID, user_id: UUID
) -> list[UUID]:
    """TEAM ids the user actively belongs to; cached because the chat unread
    aggregate reads it on every bootstrap."""
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
    await set_cached_user_team_ids(organization_id, user_id, [str(tid) for tid in team_ids])
    return team_ids


def _team_node(group: Group) -> dict[str, Any]:
    return {
        "group_id": str(group.id),
        "name": group.name,
        "description": group.description,
        "parent_group_id": str(group.parent_group_id) if group.parent_group_id else None,
        "lead_user_id": str(group.lead_user_id) if group.lead_user_id else None,
    }


def _break_parent_cycles(nodes: list[dict[str, Any]]) -> None:
    """Null the parent edge on any node whose ancestor chain loops back to it.

    The DB write path guards against cycles, but a payload must terminate even
    on malformed data (concurrent writes, manual fixes)."""
    parents = {node["group_id"]: node["parent_group_id"] for node in nodes}
    for node in nodes:
        seen: set[str] = set()
        current = node["parent_group_id"]
        while current is not None and current not in seen:
            seen.add(current)
            current = parents.get(current)
        if current is not None:
            node["parent_group_id"] = None


async def list_team_nodes(session: AsyncSession, organization_id: UUID) -> list[dict[str, Any]]:
    """All TEAM groups, parent edges cycle-broken."""
    result = await session.execute(
        select(Group)
        .where(Group.organization_id == organization_id, Group.kind == GroupKind.TEAM)
        .order_by(Group.name)
    )
    nodes = [_team_node(group) for group in result.scalars().all()]
    _break_parent_cycles(nodes)
    return nodes


async def get_team(
    session: AsyncSession, organization_id: UUID, group_id: UUID
) -> tuple[dict[str, Any], list[str]]:
    """One team node plus its ACTIVE member user ids (bounded, no pagination)."""
    result = await session.execute(
        select(Group).where(
            Group.id == group_id,
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
        )
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise NotFoundError("Team", str(group_id))

    members = await session.execute(
        select(GroupMember.user_id)
        .join(
            OrganizationMember,
            OrganizationMember.user_id == GroupMember.user_id,
        )
        .where(
            GroupMember.group_id == group_id,
            GroupMember.is_active.is_(True),
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
        )
    )
    member_ids = [str(row[0]) for row in members.all()]
    return _team_node(group), member_ids


async def update_team(
    session: AsyncSession,
    organization_id: UUID,
    actor_id: UUID,
    group_id: UUID,
    *,
    lead_user_id: UUID | None | object = UNSET,
    parent_group_id: UUID | None | object = UNSET,
) -> dict[str, Any]:
    """Structure edits (lead, parent) on a TEAM; caller gates on org admin."""
    result = await session.execute(
        select(Group).where(
            Group.id == group_id,
            Group.organization_id == organization_id,
            Group.kind == GroupKind.TEAM,
        )
    )
    group = result.scalar_one_or_none()
    if group is None:
        raise NotFoundError("Team", str(group_id))

    group_ops = GroupOperations(session)
    changed = False
    parent_changed = False

    if lead_user_id is not UNSET and group.lead_user_id != lead_user_id:
        if lead_user_id is not None:
            await group_ops.require_active_member(organization_id, lead_user_id, "lead_user_id")
        previous = group.lead_user_id
        group.lead_user_id = lead_user_id
        await write_audit_event(
            session,
            organization_id=organization_id,
            actor_user_id=actor_id,
            action=Action.TEAM_LEAD_CHANGED,
            resource_type="GROUP",
            resource_id=group_id,
            details={
                "previous_lead_user_id": str(previous) if previous else None,
                "lead_user_id": str(lead_user_id) if lead_user_id else None,
            },
        )
        changed = True

    if parent_group_id is not UNSET and group.parent_group_id != parent_group_id:
        if parent_group_id is not None:
            if parent_group_id == group_id:
                raise ValidationError("parent_group_id", "a team cannot be its own parent")
            await group_ops.require_team_parent(organization_id, parent_group_id)
            await group_ops.reject_parent_cycle(organization_id, group_id, parent_group_id)
        previous = group.parent_group_id
        group.parent_group_id = parent_group_id
        await write_audit_event(
            session,
            organization_id=organization_id,
            actor_user_id=actor_id,
            action=Action.TEAM_PARENT_CHANGED,
            resource_type="GROUP",
            resource_id=group_id,
            details={
                "previous_parent_group_id": str(previous) if previous else None,
                "parent_group_id": str(parent_group_id) if parent_group_id else None,
            },
        )
        changed = True
        parent_changed = True

    if changed:
        await session.commit()
        await invalidate_org_people(organization_id)
        if parent_changed:
            # The team's search doc denormalizes the parent name.
            await TeamSearchIndexer(session).index_team(group)
    node, _ = await get_team(session, organization_id, group_id)
    return node
