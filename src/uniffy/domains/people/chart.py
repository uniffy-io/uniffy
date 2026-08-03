"""Org chart assembly from manager edges."""

from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.avatars import get_avatar_url
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.domains.people.operations import MAX_CHART_DEPTH
from uniffy.domains.people.teams import list_team_nodes, teams_for_users


async def build_org_chart_payload(session: AsyncSession, organization_id: UUID) -> dict[str, Any]:
    """The full-org chart as a cacheable dict; every ACTIVE member is a node.

    A member whose manager is deactivated (or missing) surfaces as a root.
    Cycles and depth overruns degrade to a truncated forest, never a hang:
    unreachable nodes are force-rooted with their manager edge dropped.
    """
    result = await session.execute(
        select(OrganizationMember, User, PeopleProfile)
        .join(User, User.id == OrganizationMember.user_id)
        .outerjoin(
            PeopleProfile,
            and_(
                PeopleProfile.organization_id == organization_id,
                PeopleProfile.user_id == User.id,
            ),
        )
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.is_active.is_(True),
        )
        .order_by(User.full_name, User.username)
    )
    rows = result.all()

    users = {user.id: (user, profile) for _, user, profile in rows}
    manager: dict[UUID, UUID | None] = {}
    for _, user, profile in rows:
        edge = profile.manager_user_id if profile else None
        # An edge to a non-member (deactivated, removed) is dead: root.
        manager[user.id] = edge if edge in users else None

    children: dict[UUID | None, list[UUID]] = defaultdict(list)
    for user_id, manager_id in manager.items():
        children[manager_id].append(user_id)

    truncated = False
    visited: set[UUID] = set()
    roots = list(children[None])

    def walk(start: UUID) -> None:
        nonlocal truncated
        stack = [(start, 1)]
        while stack:
            node, depth = stack.pop()
            if node in visited:
                truncated = True
                continue
            visited.add(node)
            if depth >= MAX_CHART_DEPTH:
                if children[node]:
                    truncated = True
                continue
            for child in children[node]:
                stack.append((child, depth + 1))

    for root in roots:
        walk(root)

    # Whatever the root walk could not reach sits inside a cycle; break it by
    # force-rooting one member per pass until every node is placed.
    for user_id in sorted(users, key=str):
        if user_id not in visited:
            truncated = True
            manager[user_id] = None
            children[None].append(user_id)
            roots.append(user_id)
            walk(user_id)

    # Descendant counts over the final (acyclic) placement, iterative post-order.
    placed_children: dict[UUID | None, list[UUID]] = defaultdict(list)
    for user_id, manager_id in manager.items():
        placed_children[manager_id].append(user_id)
    descendants: dict[UUID, int] = {}
    for root in roots:
        order: list[UUID] = []
        stack = [root]
        seen: set[UUID] = set()
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            order.append(node)
            stack.extend(placed_children[node])
        for node in reversed(order):
            descendants[node] = sum(
                1 + descendants.get(child, 0) for child in placed_children[node]
            )

    teams = await teams_for_users(session, organization_id, list(users))

    nodes = []
    for _, user, profile in rows:
        nodes.append(
            {
                "user_id": str(user.id),
                "display_name": user.full_name or user.username,
                "avatar_url": get_avatar_url(user.id, user.avatar_key) or None,
                "job_title": profile.job_title if profile else None,
                "department": profile.department if profile else None,
                "manager_user_id": str(manager[user.id]) if manager[user.id] else None,
                "teams": teams.get(user.id, []),
                "descendant_count": descendants.get(user.id, 0),
            }
        )

    return {
        "nodes": nodes,
        "root_user_ids": [str(root) for root in roots],
        "teams": await list_team_nodes(session, organization_id),
        "truncated": truncated,
    }
