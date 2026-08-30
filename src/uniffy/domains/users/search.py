from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.users.avatars import get_avatar_url


class UserSearchIndexer:
    """Per-org user indexing for @ mention lookups and member search."""

    def __init__(self, session: AsyncSession, search_indexer: SearchIndexer) -> None:
        self._session = session
        self._indexer = search_indexer

    def _build_user_urn(self, user_id: UUID) -> str:
        return f"urn:uniffy:content:USER:{user_id}"

    async def index_for_organization(self, user: User, organization_id: UUID) -> None:
        urn = self._build_user_urn(user.id)
        url_path = f"/people/{user.id}"

        profile = await self._load_profile(organization_id, user.id)
        team_name = await self._first_team_name(organization_id, user.id)

        email = user.email
        job_title = profile.job_title if profile else None
        department = profile.department if profile else None
        timezone = profile.timezone if profile else None
        avatar_url = get_avatar_url(user.id, user.avatar_key)

        keywords_parts = [user.username, user.full_name, email, job_title, department, team_name]
        keywords = " ".join(part for part in keywords_parts if part)

        metadata: dict[str, str] = {}
        if avatar_url:
            metadata["avatar_url"] = avatar_url
        if email:
            metadata["user_email"] = email
        if job_title:
            metadata["job_title"] = job_title
        if department:
            metadata["department"] = department
        if team_name:
            metadata["team_name"] = team_name
        # Not part of keywords: zone names carry city names ("Europe/Sofia")
        # that would pollute people search.
        if timezone:
            metadata["timezone"] = timezone

        await self._indexer.index(
            urn=urn,
            organization_id=organization_id,
            title=user.full_name or user.username,
            entity_type="user",
            url_path=url_path,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.VIEWER,
            owner_id=user.id,
            keywords=keywords,
            description=email or "",
            metadata=metadata,
        )

        # Full denormalized payload; empty strings clear fields that mention
        # chips must stop showing once the profile no longer carries them.
        await publish_mention_state(
            organization_id,
            urn,
            {
                "title": user.full_name or user.username,
                "description": email or "",
                "user_email": email or "",
                "job_title": job_title or "",
                "department": department or "",
                "team_name": team_name or "",
                "timezone": timezone or "",
            },
        )

    async def _load_profile(self, organization_id: UUID, user_id: UUID) -> PeopleProfile | None:
        result = await self._session.execute(
            select(PeopleProfile).where(
                PeopleProfile.organization_id == organization_id,
                PeopleProfile.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _first_team_name(self, organization_id: UUID, user_id: UUID) -> str | None:
        result = await self._session.execute(
            select(Group.name)
            .join(GroupMember, GroupMember.group_id == Group.id)
            .where(
                Group.organization_id == organization_id,
                Group.kind == GroupKind.TEAM,
                GroupMember.user_id == user_id,
                GroupMember.is_active.is_(True),
            )
            .order_by(Group.name)
            .limit(1)
        )
        return result.scalars().first()

    async def index_for_all_organizations(self, user: User) -> None:
        result = await self._session.execute(
            select(OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == user.id)
            .where(OrganizationMember.is_active.is_(True))
        )
        org_ids = [row[0] for row in result.all()]

        for org_id in org_ids:
            await self.index_for_organization(user, org_id)

    async def remove_from_organization(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        urn = self._build_user_urn(user_id)
        await self._indexer.remove(urn, organization_id)

    async def remove_completely(self, user_id: UUID) -> None:
        urn = self._build_user_urn(user_id)
        # Passing organization_id=None removes the URN from every org index.
        await self._indexer.remove(urn, organization_id=None)
