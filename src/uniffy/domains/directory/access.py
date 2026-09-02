from collections.abc import Collection, Mapping
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.types import ContentRole, ContentType
from uniffy.domains.permissions.access.subject import AccessSubject
from uniffy.domains.permissions.access.types import (
    ResourceAccessDecision,
    ResourceKey,
    ResourceRowState,
)


async def resolve_directory_resources(
    session: AsyncSession,
    subject: AccessSubject,
    candidates: Mapping[ContentType, Collection[UUID]],
) -> dict[ResourceKey, ResourceAccessDecision]:
    decisions: dict[ResourceKey, ResourceAccessDecision] = {}
    user_ids = candidates.get(ContentType.USER, ())
    active_users = set()
    if user_ids and subject.is_active_member:
        active_users = set(
            (
                await session.execute(
                    select(User.id)
                    .join(OrganizationMember, OrganizationMember.user_id == User.id)
                    .where(
                        User.id.in_(user_ids),
                        User.is_active.is_(True),
                        OrganizationMember.organization_id == subject.organization_id,
                        OrganizationMember.is_active.is_(True),
                    )
                )
            ).scalars()
        )
    for content_id in user_ids:
        key = ResourceKey(ContentType.USER, content_id)
        live = content_id in active_users
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE if live else ResourceRowState.MISSING,
            can_view=live,
            role=ContentRole.VIEWER if live else None,
        )

    team_ids = candidates.get(ContentType.TEAM, ())
    teams = set()
    if team_ids and subject.is_active_member:
        teams = set(
            (
                await session.execute(
                    select(Group.id).where(
                        Group.id.in_(team_ids),
                        Group.organization_id == subject.organization_id,
                        Group.kind == GroupKind.TEAM,
                    )
                )
            ).scalars()
        )
    for content_id in team_ids:
        key = ResourceKey(ContentType.TEAM, content_id)
        live = content_id in teams
        decisions[key] = ResourceAccessDecision(
            key=key,
            row_state=ResourceRowState.LIVE if live else ResourceRowState.MISSING,
            can_view=live,
            role=ContentRole.VIEWER if live else None,
        )

    return decisions
