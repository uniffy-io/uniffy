from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.users.avatars import get_avatar_url


class UserSearchIndexer:
    """Per-org user indexing for @ mention lookups and member search."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._indexer = SearchIndexer(session)

    def _build_user_urn(self, user_id: UUID) -> str:
        return f"urn:uniffy:content:USER:{user_id}"

    async def index_for_organization(self, user: User, organization_id: UUID) -> None:
        urn = self._build_user_urn(user.id)
        url_path = f"/admin/users/{user.id}"

        keywords_parts = [user.email, user.username]
        if user.full_name:
            keywords_parts.append(user.full_name)
        keywords = " ".join(keywords_parts)

        avatar_url = get_avatar_url(user.id, user.avatar_key)
        metadata: dict[str, str] | None = {"avatar_url": avatar_url} if avatar_url else None

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
            description=user.email,
            rank_score=1.0,
            metadata=metadata,
        )

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
