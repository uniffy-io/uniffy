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

    async def get_references(
        self,
        user_id: UUID,
        organization_id: UUID,
        target_urn: str,
        type_filters: list[str] | None = None,
        limit: int = 50,
    ) -> tuple[list[SearchIndex], int]:
        """
        Get all content that references a specific URN.

        Searches for content where the target URN appears in
        outgoing_references. Currently only notes track references.

        Parameters
        ----------
        user_id : UUID
            User performing the query.
        organization_id : UUID
            Organization ID.
        target_urn : str
            URN to find references to.
        type_filters : list[str] | None
            Optional entity type filters.
        limit : int
            Maximum results.

        Returns
        -------
        tuple[list[SearchIndex], int]
            List of referencing content and total count.

        """
        from sqlalchemy import and_, func, or_, select

        from uwos.core.models.notes.note import Note

        # Get user's group memberships for permission filtering
        user_group_ids = await self.access_query.get_user_group_ids(
            user_id=user_id,
            organization_id=organization_id,
        )

        # Query notes that have the target URN in outgoing_references
        query = select(Note).where(
            and_(
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.outgoing_references.contains([target_urn]),
            )
        )

        # Permission filtering
        permission_conditions = [
            Note.visibility == "ORGANIZATION",
            Note.owner_id == user_id,
        ]

        if user_group_ids:
            # For GROUP visibility, check if user is in a shared group
            # This is simplified - in production would need to join ContentGroupLink
            permission_conditions.append(
                and_(
                    Note.visibility == "GROUP",
                    Note.owner_id == user_id,  # Owner can always see their GROUP notes
                )
            )

        query = query.where(or_(*permission_conditions))

        # Apply type filter (only notes for now)
        if type_filters and "note" not in type_filters:
            # No other types support references yet
            return [], 0

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Apply limit
        query = query.order_by(Note.updated_at.desc()).limit(limit)

        result = await self.session.execute(query)
        notes = list(result.scalars().all())

        # Convert notes to SearchIndex-like objects for consistent response
        search_results: list[SearchIndex] = []
        for note in notes:
            search_results.append(
                SearchIndex(
                    urn=f"urn:uwos:content:NOTE:{note.id}",
                    organization_id=note.organization_id,
                    title=note.title,
                    description=note.content[:200] if note.content else None,
                    keywords=None,
                    entity_type="note",
                    url_path=f"/notes/{note.id}",
                    visibility=note.visibility.value,
                    owner_id=note.owner_id,
                    updated_at=note.updated_at,
                )
            )

        return search_results, total
