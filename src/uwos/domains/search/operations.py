"""
Search operations - business logic for unified search.

Provides SearchOperations class that handles:
- Fuzzy search with permission filtering
- Search result ranking
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.auth.permissions import ContentAccessQuery
from uwos.core.models.search.search_index import SearchIndex
from uwos.core.search.indexer import SearchIndexer
from uwos.domains.search.queries import execute_search


class SearchOperations:
    """
    Unified search operations.

    Provides methods for searching across all indexed content
    with permission-based filtering.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    def __init__(self, session: AsyncSession) -> None:
        """
        Initialize search operations.

        Parameters
        ----------
        session : AsyncSession
            Database session.

        """
        self.session = session
        self.access_query = ContentAccessQuery(session)
        self.indexer = SearchIndexer(session)

    async def search(
        self,
        user_id: UUID,
        organization_id: UUID,
        query_text: str,
        type_filters: list[str] | None = None,
        limit: int = 20,
    ) -> list[tuple[SearchIndex, float]]:
        """
        Perform a fuzzy search across all accessible content.

        Parameters
        ----------
        user_id : UUID
            User performing the search.
        organization_id : UUID
            Organization ID for tenant isolation.
        query_text : str
            Search query string.
        type_filters : list[str] | None
            Optional list of entity types to filter by.
        limit : int
            Maximum number of results (default 20).

        Returns
        -------
        list[tuple[SearchIndex, float]]
            List of (SearchIndex, score) tuples sorted by relevance.

        """
        # Get user's group memberships for permission filtering
        user_group_ids = await self.access_query.get_user_group_ids(
            user_id=user_id,
            organization_id=organization_id,
        )

        # Execute the search with permission filtering
        results = await execute_search(
            session=self.session,
            query_text=query_text,
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=user_group_ids,
            type_filters=type_filters,
            limit=limit,
        )

        return results

    async def index_item(
        self,
        organization_id: UUID,
        urn: str,
        entity_type: str,
        title: str,
        url_path: str,
        visibility: str,
        owner_id: UUID,
        keywords: str | None = None,
        description: str | None = None,
        shared_group_ids: list[UUID] | None = None,
        shared_user_ids: list[UUID] | None = None,
    ) -> None:
        """
        Index or update an item in the search index.

        Parameters
        ----------
        organization_id : UUID
            Organization ID.
        urn : str
            Universal Resource Name.
        entity_type : str
            Type of entity (e.g., 'note', 'file').
        title : str
            Display title.
        url_path : str
            Frontend route path.
        visibility : str
            Visibility scope.
        owner_id : UUID
            Owner user ID.
        keywords : str | None
            Searchable text content.
        description : str | None
            Short description/snippet.
        shared_group_ids : list[UUID] | None
            Groups the item is shared with.
        shared_user_ids : list[UUID] | None
            Users the item is explicitly shared with.

        """
        await self.indexer.index(
            urn=urn,
            organization_id=organization_id,
            title=title,
            entity_type=entity_type,
            url_path=url_path,
            visibility=visibility,
            owner_id=owner_id,
            keywords=keywords,
            description=description,
            shared_group_ids=shared_group_ids,
            shared_user_ids=shared_user_ids,
        )
        await self.session.commit()

    async def delete_item(self, urn: str) -> None:
        """
        Remove an item from the search index.

        Parameters
        ----------
        urn : str
            Universal Resource Name to remove.

        """
        await self.indexer.remove(urn)
        await self.session.commit()
