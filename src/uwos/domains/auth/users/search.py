"""User search indexing utilities."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.models.login.organization_member import OrganizationMember
from uwos.core.models.login.user import User
from uwos.core.search.indexer import SearchIndexer, build_content_urn
from uwos.core.types import ContentType, VisibilityScope


class UserSearchIndexer:
    """
    Utility for indexing users in the search system.

    Users are global entities but are indexed per organization they belong to,
    allowing users to be found via @mentions within each organization context.

    Parameters
    ----------
    session : AsyncSession
        Database session for queries.

    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize user search indexer.

        Parameters
        ----------
        session : AsyncSession
            Database session for queries.

        """
        self._session = session
        self._indexer = SearchIndexer(session)

    async def index_for_organization(
        self,
        user: User,
        organization_id: UUID,
    ) -> None:
        """
        Index a user for a specific organization.

        Creates a search index entry that allows the user to be found
        via @mentions within the given organization.

        Parameters
        ----------
        user : User
            User to index.
        organization_id : UUID
            Organization to index the user for.

        """
        urn = build_content_urn(ContentType.USER, user.id)

        # Build keywords from user attributes
        keywords_parts = [user.username, user.email]
        if user.full_name:
            keywords_parts.append(user.full_name)
        keywords = " ".join(keywords_parts)

        # Title is display name (full_name or username)
        title = user.full_name or user.username

        # Description is email
        description = user.email

        await self._indexer.index(
            urn=urn,
            organization_id=organization_id,
            title=title,
            entity_type="user",
            url_path=f"/users/{user.id}",
            visibility=VisibilityScope.ORGANIZATION.value,
            owner_id=user.id,
            keywords=keywords,
            description=description,
            rank_score=1.5,  # Boost users slightly for easier @mention discovery
        )

    async def index_for_all_organizations(self, user: User) -> None:
        """
        Index a user for all organizations they belong to.

        Call this when user details change to update all search entries.

        Parameters
        ----------
        user : User
            User to index.

        """
        # Get all organizations the user belongs to
        result = await self._session.execute(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == user.id,
                OrganizationMember.is_active == True,  # noqa: E712
            )
        )
        org_ids = list(result.scalars().all())

        for org_id in org_ids:
            await self.index_for_organization(user, org_id)

    async def remove_from_organization(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """
        Remove user from search index for a specific organization.

        Call this when a user leaves an organization.

        Parameters
        ----------
        user_id : UUID
            User ID to remove.
        organization_id : UUID
            Organization to remove the user from.

        """
        await self._indexer.remove_by_content(ContentType.USER, user_id, organization_id)

    async def remove_completely(self, user_id: UUID) -> None:
        """
        Remove user from search index completely.

        Call this when a user is deleted or deactivated.

        Parameters
        ----------
        user_id : UUID
            User ID to remove.

        """
        await self._indexer.remove_by_content(ContentType.USER, user_id)
