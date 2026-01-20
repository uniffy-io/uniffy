"""
Search operations - business logic for unified search.

Provides SearchOperations class that handles:
- Fuzzy search via Meilisearch with permission filtering
- Search result ranking
- URN metadata resolution
"""

from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from uwos.core.auth.permissions import ContentAccessQuery
from uwos.core.search.indexer import SearchIndexer
from uwos.domains.search.queries import SearchResult, execute_search, get_documents_by_urns


class SearchOperations:
    """
    Unified search operations.

    Provides methods for searching across all indexed content
    with permission-based filtering via Meilisearch.

    Parameters
    ----------
    session : AsyncSession
        Database session (used for permission queries and references).

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
        tag_filters: list[str] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[SearchResult], int]:
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
        tag_filters : list[str] | None
            Optional list of tags to filter by.
        my_content_only : bool
            If True, only return content owned by the user.
        owner_filter : UUID | None
            Filter by specific owner ID.
        limit : int
            Maximum number of results (default 20).
        offset : int
            Offset for pagination.

        Returns
        -------
        tuple[list[SearchResult], int]
            List of SearchResult objects and estimated total hits.

        """
        # Get user's group memberships for permission filtering
        user_group_ids = await self.access_query.get_user_group_ids(
            user_id=user_id,
            organization_id=organization_id,
        )

        # Execute the search with permission filtering via Meilisearch
        results, total = await execute_search(
            query_text=query_text,
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=user_group_ids,
            type_filters=type_filters,
            tag_filters=tag_filters,
            my_content_only=my_content_only,
            owner_filter=owner_filter,
            limit=limit,
            offset=offset,
        )

        return results, total

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
        tags: list[str] | None = None,
    ) -> None:
        """
        Index or update an item in Meilisearch.

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
        tags : list[str] | None
            Content tags.

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
            tags=tags,
        )

    async def delete_item(self, urn: str, organization_id: UUID | None = None) -> None:
        """
        Remove an item from Meilisearch.

        Parameters
        ----------
        urn : str
            Universal Resource Name to remove.
        organization_id : UUID | None
            If provided, only delete for this organization.

        """
        await self.indexer.remove(urn, organization_id)

    async def get_references(
        self,
        user_id: UUID,
        organization_id: UUID,
        target_urn: str,
        type_filters: list[str] | None = None,
        limit: int = 50,
    ) -> tuple[list[SearchResult], int]:
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
        tuple[list[SearchResult], int]
            List of referencing content and total count.

        """
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

        # Convert notes to SearchResult objects
        search_results: list[SearchResult] = []
        for note in notes:
            search_results.append(
                SearchResult(
                    urn=f"urn:uwos:content:NOTE:{note.id}",
                    organization_id=note.organization_id,
                    title=note.title,
                    description=note.content[:200] if note.content else None,
                    entity_type="note",
                    url_path=f"/notes/{note.id}",
                    visibility=note.visibility.value,
                    owner_id=note.owner_id,
                    tags=note.tags,
                    updated_at=note.updated_at,
                    rank_score=1.0,
                    search_score=None,
                )
            )

        return search_results, total

    async def resolve_urns(
        self,
        user_id: UUID,
        organization_id: UUID,
        urns: list[str],
    ) -> dict[str, SearchResult]:
        """
        Resolve metadata for a batch of URNs.

        Fetches documents from Meilisearch for the given URNs.
        Permission filtering is implicit since documents are only
        accessible if the user could see them in search.

        Parameters
        ----------
        user_id : UUID
            User performing the resolution.
        organization_id : UUID
            Organization ID for tenant isolation.
        urns : list[str]
            List of URNs to resolve (max 100).

        Returns
        -------
        dict[str, SearchResult]
            Mapping of URN -> SearchResult for accessible items.
            Missing or inaccessible URNs are omitted from the result.

        """
        if not urns:
            return {}

        # Limit to max 100 URNs
        urns = urns[:100]

        # Fetch documents from Meilisearch
        docs = await get_documents_by_urns(urns, organization_id)

        # Filter by permissions
        # Get user's group memberships
        user_group_ids = await self.access_query.get_user_group_ids(
            user_id=user_id,
            organization_id=organization_id,
        )
        user_group_id_strs = {str(gid) for gid in user_group_ids}

        accessible: dict[str, SearchResult] = {}
        for urn, result in docs.items():
            # Check permission
            if self._can_access(result, user_id, user_group_id_strs):
                accessible[urn] = result

        return accessible

    def _can_access(
        self,
        result: SearchResult,
        user_id: UUID,
        user_group_ids: set[str],
    ) -> bool:
        """
        Check if user can access this search result.

        Parameters
        ----------
        result : SearchResult
            The search result to check.
        user_id : UUID
            User ID.
        user_group_ids : set[str]
            Set of group ID strings the user belongs to.

        Returns
        -------
        bool
            True if user can access.

        """
        # Organization visibility - everyone can see
        if result.visibility == "ORGANIZATION":
            return True

        # Owner can always see
        if result.owner_id == user_id:
            return True

        # GROUP visibility requires group membership
        # Note: This simplified check assumes shared_group_ids would be
        # populated in the search result. For full implementation,
        # we'd need to fetch this from the source document.
        if result.visibility == "GROUP":
            # If we had shared_group_ids, we'd check overlap here
            # For now, allow if user owns it (already checked above)
            pass

        return False
