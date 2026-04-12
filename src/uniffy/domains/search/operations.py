"""
Search operations - business logic for unified search.

Provides SearchOperations class that handles:
- Fuzzy search via Meilisearch with permission filtering
- Search result ranking
- URN metadata resolution
"""

from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import ContentAccessQuery
from uniffy.core.models.files.file import File
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.search.queries import SearchResult, execute_search, get_documents_by_urns


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
        exclude_type_filters: list[str] | None = None,
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
        user_group_ids = await self._get_user_group_ids(user_id)

        # Execute the search with permission filtering via Meilisearch
        results, total = await execute_search(
            query_text=query_text,
            organization_id=organization_id,
            user_id=user_id,
            user_group_ids=user_group_ids,
            type_filters=type_filters,
            exclude_type_filters=exclude_type_filters,
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
        access_mode: AccessMode,
        baseline_role: ContentRole | None,
        owner_id: UUID,
        keywords: str | None = None,
        description: str | None = None,
        shared_group_ids: list[UUID] | None = None,
        shared_user_ids: list[UUID] | None = None,
        tags: list[str] | None = None,
    ) -> None:
        """Index or update an item in Meilisearch."""
        await self.indexer.index(
            urn=urn,
            organization_id=organization_id,
            title=title,
            entity_type=entity_type,
            url_path=url_path,
            access_mode=access_mode,
            baseline_role=baseline_role,
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
        if type_filters and "note" not in type_filters:
            return [], 0

        # Query notes that have the target URN in outgoing_references,
        # filtered through the canonical access filter.
        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.NOTE,
            content_id_column=Note.id,
            owner_id_column=Note.owner_id,
            access_mode_column=Note.access_mode,
            baseline_role_column=Note.baseline_role,
        )

        query = select(Note).where(
            and_(
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.outgoing_references.contains([target_urn]),
                access_filter,
            )
        )

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        query = query.order_by(Note.updated_at.desc()).limit(limit)

        result = await self.session.execute(query)
        notes = list(result.scalars().all())

        search_results: list[SearchResult] = []
        for note in notes:
            search_results.append(
                SearchResult(
                    urn=f"urn:uniffy:content:NOTE:{note.id}",
                    organization_id=note.organization_id,
                    title=note.title,
                    description=note.content[:200] if note.content else None,
                    entity_type="note",
                    url_path=f"/notes/{note.id}",
                    access_mode=note.access_mode.value,
                    baseline_role=(
                        note.baseline_role.value if note.baseline_role is not None else None
                    ),
                    owner_id=note.owner_id,
                    tags=note.tags,
                    metadata=None,
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

        Fetches documents from Meilisearch for the given URNs,
        then enriches with live state from the database (task status,
        file processing status, project task counts, etc.).

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

        # Fetch documents from Meilisearch with permission filtering
        user_group_ids = await self._get_user_group_ids(user_id)
        accessible = await get_documents_by_urns(
            urns, organization_id, user_id, user_group_ids,
        )

        # Enrich with live state from the database
        await self._enrich_live_state(accessible, organization_id)

        return accessible

    async def _enrich_live_state(
        self,
        results: dict[str, SearchResult],
        organization_id: UUID,
    ) -> None:
        """
        Enrich resolved URN results with live state from the database.

        Queries database tables for task status, file processing status,
        and project task counts. Modifies results in place.

        Parameters
        ----------
        results : dict[str, SearchResult]
            Mapping of URN -> SearchResult to enrich.
        organization_id : UUID
            Organization scope.

        """
        if not results:
            return

        # Categorize URNs by type for batch queries
        task_ids: list[UUID] = []
        file_ids: list[UUID] = []
        project_ids: list[UUID] = []

        urn_to_id: dict[str, UUID] = {}

        for urn, result in results.items():
            try:
                # Parse UUID from URN (format: urn:uniffy:content:TYPE:uuid)
                parts = urn.split(":")
                if len(parts) < 5:
                    continue
                content_id = UUID(parts[4])
                urn_to_id[urn] = content_id

                if result.entity_type == "task":
                    task_ids.append(content_id)
                elif result.entity_type == "file":
                    file_ids.append(content_id)
                elif result.entity_type == "project":
                    project_ids.append(content_id)
            except (ValueError, IndexError):
                continue

        # Enrich tasks with status, due_date, assignee
        if task_ids:
            await self._enrich_tasks(results, task_ids, urn_to_id)

        # Enrich files with processing status
        if file_ids:
            await self._enrich_files(results, file_ids, urn_to_id)

        # Enrich projects with completed/total task counts
        if project_ids:
            await self._enrich_projects(results, project_ids, urn_to_id, organization_id)

    async def _enrich_tasks(
        self,
        results: dict[str, SearchResult],
        task_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """
        Enrich task results with live status, due_date, and assignee name.

        Parameters
        ----------
        results : dict[str, SearchResult]
            Results to enrich in place.
        task_ids : list[UUID]
            Task IDs to query.
        urn_to_id : dict[str, UUID]
            Mapping of URN to content ID.

        """
        try:
            stmt = select(
                Task.id,
                Task.status,
                Task.due_date,
                Task.assignee_ids,
            ).where(
                and_(
                    Task.id.in_(task_ids),
                    Task.is_deleted == False,  # noqa: E712
                )
            )
            result = await self.session.execute(stmt)
            task_rows = result.all()

            # Collect assignee IDs for name resolution
            all_assignee_ids: set[UUID] = set()
            task_assignees: dict[UUID, list[str]] = {}
            for row in task_rows:
                if row.assignee_ids:
                    task_assignees[row.id] = row.assignee_ids
                    for aid in row.assignee_ids:
                        try:
                            all_assignee_ids.add(UUID(aid))
                        except ValueError:
                            continue

            # Resolve assignee names
            assignee_names: dict[str, str] = {}
            if all_assignee_ids:
                name_stmt = select(User.id, User.full_name, User.username).where(
                    User.id.in_(all_assignee_ids)
                )
                name_result = await self.session.execute(name_stmt)
                for name_row in name_result.all():
                    assignee_names[str(name_row[0])] = name_row[1] or name_row[2]

            # Apply enrichment to results
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in task_rows:
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                sr = results[urn]
                sr.status = row.status
                sr.due_date = row.due_date
                # Get first assignee name
                aids = task_assignees.get(row.id)
                if aids:
                    sr.assignee_name = assignee_names.get(aids[0])
        except Exception:
            logger.warning("Failed to enrich task live state", exc_info=True)

    async def _enrich_files(
        self,
        results: dict[str, SearchResult],
        file_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """
        Enrich file results with processing status.

        Parameters
        ----------
        results : dict[str, SearchResult]
            Results to enrich in place.
        file_ids : list[UUID]
            File IDs to query.
        urn_to_id : dict[str, UUID]
            Mapping of URN to content ID.

        """
        try:
            stmt = select(
                File.id,
                File.extraction_status,
            ).where(
                and_(
                    File.id.in_(file_ids),
                    File.is_deleted == False,  # noqa: E712
                )
            )
            result = await self.session.execute(stmt)

            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in result.all():
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                results[urn].processing_status = row.extraction_status.value
        except Exception:
            logger.warning("Failed to enrich file live state", exc_info=True)

    async def _enrich_projects(
        self,
        results: dict[str, SearchResult],
        project_ids: list[UUID],
        urn_to_id: dict[str, UUID],
        organization_id: UUID,
    ) -> None:
        """
        Enrich project results with completed/total task counts.

        Parameters
        ----------
        results : dict[str, SearchResult]
            Results to enrich in place.
        project_ids : list[UUID]
            Project IDs to query.
        urn_to_id : dict[str, UUID]
            Mapping of URN to content ID.
        organization_id : UUID
            Organization scope.

        """
        try:
            # Count total and completed tasks per project
            stmt = select(
                Task.project_id,
                func.count(Task.id).label("total"),
                func.count(Task.completed_at).label("completed"),
            ).where(
                and_(
                    Task.project_id.in_(project_ids),
                    Task.organization_id == organization_id,
                    Task.is_deleted == False,  # noqa: E712
                )
            ).group_by(Task.project_id)
            result = await self.session.execute(stmt)

            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in result.all():
                urn = id_to_urn.get(row.project_id)
                if not urn or urn not in results:
                    continue
                results[urn].total_tasks = row.total
                results[urn].completed_tasks = row.completed
        except Exception:
            logger.warning("Failed to enrich project live state", exc_info=True)

    async def _get_user_group_ids(self, user_id: UUID) -> list[UUID]:
        """Return the active group ids for a user."""
        result = await self.session.execute(
            select(GroupMember.group_id).where(
                GroupMember.user_id == user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

