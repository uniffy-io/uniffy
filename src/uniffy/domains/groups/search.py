"""TEAM-kind groups as org-open search entities for Ctrl+K and mentions.

ACCESS groups stay out of the index entirely: they may be private and their
roster is the sharing graph. The TEAM invariant ``is_private == False`` is
what makes org-open indexing safe.
"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole
from uniffy.core.valkey.mentions import publish_mention_state


def build_team_urn(group_id: UUID) -> str:
    return f"urn:uniffy:content:TEAM:{group_id}"


class TeamSearchIndexer:
    """Index + publish stay paired by construction, per the mention contract."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._indexer = SearchIndexer(session)

    async def index_team(self, group: Group) -> None:
        if group.kind is not GroupKind.TEAM:
            await self.remove_team(group.id, group.organization_id)
            return

        urn = build_team_urn(group.id)
        member_count = await self._active_member_count(group.id)
        parent_label = await self._parent_name(group)

        metadata: dict[str, str] = {"member_count": str(member_count)}
        if parent_label:
            metadata["parent_label"] = parent_label

        keywords = " ".join(part for part in (group.name, parent_label) if part)

        await self._indexer.index(
            urn=urn,
            organization_id=group.organization_id,
            title=group.name,
            entity_type="team",
            url_path=f"/people?team={group.id}",
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
            owner_id=group.created_by_user_id,
            keywords=keywords,
            description=group.description or "",
            metadata=metadata,
        )

        # Full denormalized payload; empty strings clear fields a chip must
        # stop showing (e.g. the parent badge after a detach).
        await publish_mention_state(
            group.organization_id,
            urn,
            {
                "title": group.name,
                "description": group.description or "",
                "member_count": str(member_count),
                "parent_label": parent_label or "",
            },
        )

    async def remove_team(self, group_id: UUID, organization_id: UUID) -> None:
        urn = build_team_urn(group_id)
        await self._indexer.remove(urn, organization_id)
        await publish_mention_state(organization_id, urn, {"urn_status": "DELETED"})

    async def sync_teams(self, organization_id: UUID, group_ids: list[UUID]) -> None:
        """Refresh docs for ``group_ids``; rows that are not (or no longer)
        TEAM kind are tombstoned by ``index_team``."""
        if not group_ids:
            return
        result = await self._session.execute(
            select(Group).where(
                Group.organization_id == organization_id,
                Group.id.in_(group_ids),
            )
        )
        for group in result.scalars().all():
            await self.index_team(group)

    async def child_team_ids(self, group_id: UUID) -> list[UUID]:
        """Direct child teams denormalize this team's name as parent_label."""
        result = await self._session.execute(
            select(Group.id).where(
                Group.parent_group_id == group_id,
                Group.kind == GroupKind.TEAM,
            )
        )
        return [row[0] for row in result.all()]

    async def _active_member_count(self, group_id: UUID) -> int:
        result = await self._session.execute(
            select(func.count(GroupMember.id)).where(
                GroupMember.group_id == group_id,
                GroupMember.is_active.is_(True),
            )
        )
        return int(result.scalar() or 0)

    async def _parent_name(self, group: Group) -> str | None:
        if group.parent_group_id is None:
            return None
        result = await self._session.execute(
            select(Group.name).where(Group.id == group.parent_group_id)
        )
        return result.scalar_one_or_none()
