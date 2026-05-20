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
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.files.file import File
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.tags.tag import Tag, TagAssignment
from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.types import AccessMode, ContentRole, ContentType
from uniffy.domains.search.queries import SearchResult, execute_search, get_documents_by_urns
from uniffy.domains.tags import TagOperations
from uniffy.domains.tags.visibility import TagVisibilityFilter


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
        metadata_filters: dict[str, str] | None = None,
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
        metadata_filters : dict[str, str] | None
            Filter by metadata fields (e.g., channel_id, sender_id).
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
            metadata_filters=metadata_filters,
            limit=limit,
            offset=offset,
        )

        # Tag entity rows are indexed OPEN_TO_ORG so Meili lets every org
        # member resolve them. Spotlight respects the unified-tag privacy
        # rule by dropping rows whose underlying assignments aren't visible
        # to the caller. ``total`` is a Meili estimate; the post-filter
        # only narrows the page so the estimate stays directionally correct.
        tag_results = [r for r in results if r.entity_type == "tag"]
        if tag_results:
            visible_tags = await self._filter_visible_tag_results(
                user_id, organization_id, tag_results
            )
            visible_urns = {r.urn for r in visible_tags}
            results = [
                r
                for r in results
                if r.entity_type != "tag" or r.urn in visible_urns
            ]

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

        urn_for = lambda n: f"urn:uniffy:content:NOTE:{n.id}"  # noqa: E731
        tags_by_urn = await TagOperations(self.session).get_for_urns(
            organization_id=organization_id,
            content_urns=[urn_for(n) for n in notes],
        )

        default_mode, default_baseline = await resolve_content_defaults(
            self.session, organization_id, ContentType.NOTE,
        )

        search_results: list[SearchResult] = []
        for note in notes:
            note_tags = [t.slug for t in tags_by_urn.get(urn_for(note), [])]
            effective_mode, effective_baseline = resolve_effective_policy(
                note.access_mode, note.baseline_role, default_mode, default_baseline,
            )
            search_results.append(
                SearchResult(
                    urn=urn_for(note),
                    organization_id=note.organization_id,
                    title=note.title,
                    description=note.content[:200] if note.content else None,
                    entity_type="note",
                    url_path=f"/notes/{note.id}",
                    access_mode=effective_mode.value,
                    baseline_role=(
                        effective_baseline.value if effective_baseline is not None else None
                    ),
                    owner_id=note.owner_id,
                    tags=note_tags or None,
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

        Fetches documents from Meilisearch for the given URNs and
        enriches with live state. URNs absent from the search index
        (deleted, never indexed, or hidden by permissions) are returned
        as tombstone results with ``urn_status='DELETED'`` so chips can
        render a "no longer available" state instead of a generic
        fallback. Missing entries are never silently dropped -- the
        caller asked for these URNs and is owed an answer for each.

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
            Mapping of URN -> SearchResult, one entry per input URN.

        """
        if not urns:
            return {}

        # Limit to max 100 URNs
        urns = urns[:100]

        # Fetch documents from Meilisearch with permission filtering
        user_group_ids = await self._get_user_group_ids(user_id)
        accessible = await get_documents_by_urns(
            urns,
            organization_id,
            user_id,
            user_group_ids,
        )

        # Enrich with live state from the database
        await self._enrich_live_state(accessible, organization_id, user_id)

        # Mark surviving entries as OK and synthesize tombstones for the rest
        for sr in accessible.values():
            sr.urn_status = "OK"
        for urn in urns:
            if urn in accessible:
                continue
            accessible[urn] = _build_tombstone(urn, organization_id)

        return accessible

    async def _enrich_live_state(
        self,
        results: dict[str, SearchResult],
        organization_id: UUID,
        user_id: UUID,
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
        calendar_ids: list[UUID] = []
        note_ids: list[UUID] = []
        chat_ids: list[UUID] = []
        agent_ids: list[UUID] = []
        user_ids: list[UUID] = []
        tag_ids: list[UUID] = []

        urn_to_id: dict[str, UUID] = {}

        for urn, result in results.items():
            try:
                parts = urn.split(":")
                if len(parts) < 5:
                    continue
                content_id = UUID(parts[4])
                urn_to_id[urn] = content_id

                et = result.entity_type.lower()
                if et == "task":
                    task_ids.append(content_id)
                elif et == "file":
                    file_ids.append(content_id)
                elif et == "project":
                    project_ids.append(content_id)
                elif et == "calendar_event":
                    calendar_ids.append(content_id)
                elif et == "note":
                    note_ids.append(content_id)
                elif et == "chat":
                    chat_ids.append(content_id)
                elif et == "agent":
                    agent_ids.append(content_id)
                elif et == "user":
                    user_ids.append(content_id)
                elif et == "tag":
                    tag_ids.append(content_id)
            except (ValueError, IndexError):
                continue

        if task_ids:
            await self._enrich_tasks(results, task_ids, urn_to_id)
        if file_ids:
            await self._enrich_files(results, file_ids, urn_to_id)
        if project_ids:
            await self._enrich_projects(results, project_ids, urn_to_id, organization_id)
        if calendar_ids:
            await self._enrich_calendar_events(results, calendar_ids, urn_to_id)
        if note_ids:
            await self._enrich_notes(results, note_ids, urn_to_id)
        if chat_ids:
            await self._enrich_channels(results, chat_ids, urn_to_id)
        if agent_ids:
            await self._enrich_agents(results, agent_ids, urn_to_id)
        if user_ids:
            await self._enrich_users(results, user_ids, urn_to_id)
        if tag_ids:
            await self._enrich_tags(
                results, tag_ids, urn_to_id, user_id, organization_id
            )

    async def _enrich_tasks(
        self,
        results: dict[str, SearchResult],
        task_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """
        Enrich task results with live state including status, priority,
        project context, subtask counts, and assignee info.

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
            stmt = (
                select(
                    Task.id,
                    Task.status,
                    Task.priority,
                    Task.due_date,
                    Task.assignee_ids,
                    Task.task_type,
                    Task.number,
                    Task.blocked_by_task_ids,
                    Task.project_id,
                    Project.name.label("project_name"),
                    Project.slug.label("project_slug"),
                    Project.color.label("project_color"),
                )
                .join(Project, Task.project_id == Project.id)
                .where(
                    and_(
                        Task.id.in_(task_ids),
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
            )
            result = await self.session.execute(stmt)
            task_rows = result.all()

            # Collect project IDs for field definition lookup
            project_ids_set: set[UUID] = set()
            for row in task_rows:
                project_ids_set.add(row.project_id)

            # Batch-load field definitions for status and priority options
            field_options = await self._load_field_options(list(project_ids_set))

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

            # Batch-load subtask counts
            subtask_counts = await self._get_subtask_counts(task_ids)

            # Apply enrichment to results
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in task_rows:
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                sr = results[urn]
                sr.status = row.status
                sr.due_date = row.due_date
                sr.priority = row.priority
                sr.task_type = row.task_type
                sr.task_number = row.number
                sr.project_name = row.project_name
                sr.project_slug = row.project_slug
                sr.project_color = row.project_color

                # Resolve status/priority label and color from field definitions
                proj_fields = field_options.get(row.project_id, {})
                status_opts = proj_fields.get("field_status", [])
                for opt in status_opts:
                    if opt.get("id") == row.status:
                        sr.status_label = opt.get("label")
                        sr.status_color = opt.get("color")
                        break
                priority_opts = proj_fields.get("field_priority", [])
                for opt in priority_opts:
                    if opt.get("id") == row.priority:
                        sr.priority_label = opt.get("label")
                        sr.priority_color = opt.get("color")
                        break

                # Blocked-by count
                if row.blocked_by_task_ids:
                    sr.blocked_by_count = len(row.blocked_by_task_ids)

                # Subtask counts
                sub_total, sub_done = subtask_counts.get(row.id, (0, 0))
                sr.subtask_total = sub_total
                sr.subtask_completed = sub_done

                # Assignee IDs and first assignee name
                aids = task_assignees.get(row.id)
                if aids:
                    sr.assignee_ids = aids
                    sr.assignee_name = assignee_names.get(aids[0])
        except Exception as exc:
            logger.error(f"Failed to enrich task live state: {exc}", exc_info=True)

    async def _load_field_options(
        self,
        project_ids: list[UUID],
    ) -> dict[UUID, dict[str, list[dict]]]:
        """
        Load status and priority SelectOption arrays from field definitions.

        Returns
        -------
        dict[UUID, dict[str, list[dict]]]
            Mapping of project_id -> field_id -> list of SelectOption dicts.

        """
        if not project_ids:
            return {}

        stmt = select(
            FieldDefinition.project_id,
            FieldDefinition.id,
            FieldDefinition.config,
        ).where(
            and_(
                FieldDefinition.project_id.in_(project_ids),
                FieldDefinition.id.in_(["field_status", "field_priority"]),
            )
        )
        result = await self.session.execute(stmt)

        field_map: dict[UUID, dict[str, list[dict]]] = {}
        for row in result.all():
            if row.config and "options" in row.config:
                field_map.setdefault(row.project_id, {})[row.id] = row.config["options"]
        return field_map

    async def _get_subtask_counts(
        self,
        parent_ids: list[UUID],
    ) -> dict[UUID, tuple[int, int]]:
        """
        Batch-load subtask counts (total, completed) for parent tasks.

        Returns
        -------
        dict[UUID, tuple[int, int]]
            Mapping of parent_id -> (total_count, completed_count).

        """
        if not parent_ids:
            return {}

        stmt = (
            select(
                Task.parent_id,
                func.count(Task.id).label("total"),
                func.count(Task.completed_at).label("completed"),
            )
            .where(
                and_(
                    Task.parent_id.in_(parent_ids),
                    Task.is_deleted == False,  # noqa: E712
                )
            )
            .group_by(Task.parent_id)
        )
        result = await self.session.execute(stmt)

        return {row.parent_id: (row.total, row.completed) for row in result.all()}

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
                File.mime_type,
                File.size_bytes,
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
                results[urn].file_mime_type = row.mime_type
                results[urn].file_size = row.size_bytes or 0
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
            stmt = (
                select(
                    Task.project_id,
                    func.count(Task.id).label("total"),
                    func.count(Task.completed_at).label("completed"),
                )
                .where(
                    and_(
                        Task.project_id.in_(project_ids),
                        Task.organization_id == organization_id,
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
                .group_by(Task.project_id)
            )
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

    async def _enrich_calendar_events(
        self,
        results: dict[str, SearchResult],
        event_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """Enrich calendar event results with time, location, and meeting URL."""
        try:
            stmt = select(
                CalendarEvent.id,
                CalendarEvent.start_time,
                CalendarEvent.end_time,
                CalendarEvent.is_all_day,
                CalendarEvent.location,
                CalendarEvent.meeting_url,
            ).where(
                and_(
                    CalendarEvent.id.in_(event_ids),
                    CalendarEvent.is_deleted == False,  # noqa: E712
                )
            )
            result = await self.session.execute(stmt)
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in result.all():
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                sr = results[urn]
                sr.event_start_time = row.start_time.isoformat() if row.start_time else None
                sr.event_end_time = row.end_time.isoformat() if row.end_time else None
                sr.event_is_all_day = row.is_all_day or False
                sr.event_location = row.location
                sr.event_meeting_url = row.meeting_url
        except Exception:
            logger.warning("Failed to enrich calendar event live state", exc_info=True)

    async def _enrich_notes(
        self,
        results: dict[str, SearchResult],
        note_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """Enrich note results with node type and unified-tag slugs."""
        try:
            stmt = select(
                Note.id,
                Note.node_type,
                Note.organization_id,
            ).where(
                and_(
                    Note.id.in_(note_ids),
                    Note.is_deleted == False,  # noqa: E712
                )
            )
            result = await self.session.execute(stmt)
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            note_rows = list(result.all())
            urns = [
                id_to_urn[row.id]
                for row in note_rows
                if id_to_urn.get(row.id) and id_to_urn[row.id] in results
            ]
            org_id = note_rows[0].organization_id if note_rows else None
            tags_by_urn: dict[str, list] = {}
            if urns and org_id is not None:
                tags_by_urn = await TagOperations(self.session).get_for_urns(
                    organization_id=org_id,
                    content_urns=urns,
                )
            for row in note_rows:
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                results[urn].note_node_type = row.node_type.value if row.node_type else None
                results[urn].content_tags = [t.slug for t in tags_by_urn.get(urn, [])] or None
        except Exception:
            logger.warning("Failed to enrich note live state", exc_info=True)

    async def _enrich_channels(
        self,
        results: dict[str, SearchResult],
        channel_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """Chat channel live state is denormalized into the search index at
        write time (see ``ChatChannelOperations._index_for_search``). No
        database call needed at resolve time -- the Meilisearch document
        already carries ``channel_type`` and ``member_count`` in metadata.
        """
        del results, channel_ids, urn_to_id

    async def _enrich_agents(
        self,
        results: dict[str, SearchResult],
        agent_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """Enrich agent results with avatar emoji and theme color."""
        try:
            stmt = select(
                Agent.id,
                Agent.avatar_emoji,
                Agent.theme_color,
            ).where(Agent.id.in_(agent_ids))
            result = await self.session.execute(stmt)
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in result.all():
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                results[urn].agent_emoji = row.avatar_emoji
                results[urn].agent_theme_color = row.theme_color
        except Exception:
            logger.warning("Failed to enrich agent live state", exc_info=True)

    async def _enrich_users(
        self,
        results: dict[str, SearchResult],
        user_ids_list: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """Enrich user results with avatar URL and email."""
        try:
            stmt = select(
                User.id,
                User.email,
                User.avatar_key,
            ).where(User.id.in_(user_ids_list))
            result = await self.session.execute(stmt)
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for row in result.all():
                urn = id_to_urn.get(row.id)
                if not urn or urn not in results:
                    continue
                sr = results[urn]
                sr.user_email = row.email
                if row.avatar_key:
                    sr.user_avatar_url = f"/api/avatars/{row.avatar_key}"
        except Exception:
            logger.warning("Failed to enrich user live state", exc_info=True)

    async def _get_user_group_ids(self, user_id: UUID) -> list[UUID]:
        """Return the active group ids for a user."""
        result = await self.session.execute(
            select(GroupMember.group_id).where(
                GroupMember.user_id == user_id,
                GroupMember.is_active == True,  # noqa: E712
            )
        )
        return [row[0] for row in result.all()]

    async def _filter_visible_tag_results(
        self,
        user_id: UUID,
        organization_id: UUID,
        tag_results: list[SearchResult],
    ) -> list[SearchResult]:
        """Hydrate tag rows from PG and run them through the visibility filter.

        Tag entity docs in Meilisearch only carry name / slug / color and
        a denormalized usage breakdown -- they intentionally don't carry
        the per-assignment data needed for the visibility predicate.
        Hydrate from PG (one batched ``IN`` query) and delegate to
        :class:`TagVisibilityFilter`.
        """
        urn_to_tag_id: dict[str, UUID] = {}
        for sr in tag_results:
            parts = sr.urn.split(":")
            if len(parts) != 5:
                continue
            try:
                urn_to_tag_id[sr.urn] = UUID(parts[4])
            except ValueError:
                continue

        if not urn_to_tag_id:
            return []

        result = await self.session.execute(
            select(Tag).where(
                Tag.organization_id == organization_id,
                Tag.id.in_(urn_to_tag_id.values()),
            )
        )
        tag_by_id = {t.id: t for t in result.scalars().all()}

        candidates = [
            tag_by_id[tag_id]
            for tag_id in urn_to_tag_id.values()
            if tag_id in tag_by_id
        ]
        visibility = TagVisibilityFilter(self.session, user_id, organization_id)
        visible_ids = await visibility.visible_id_set(candidates)
        return [
            sr
            for sr in tag_results
            if urn_to_tag_id.get(sr.urn) in visible_ids
        ]

    async def _enrich_tags(
        self,
        results: dict[str, SearchResult],
        tag_ids: list[UUID],
        urn_to_id: dict[str, UUID],
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Drop invisible tag URNs (so they tombstone) and inject the
        per-user ``user_assignment_count`` for the survivors.

        ``user_assignment_count`` is the only tag field that cannot be
        denormalized into the Meilisearch doc -- it's per-user and would
        require fan-out we don't pay for. A single indexed
        ``COUNT(*) GROUP BY tag_id WHERE assigned_by = :user`` covers
        the whole batch.
        """
        try:
            stmt = select(Tag).where(
                Tag.organization_id == organization_id,
                Tag.id.in_(tag_ids),
            )
            tag_rows = (await self.session.execute(stmt)).scalars().all()
            tag_by_id = {t.id: t for t in tag_rows}

            visibility = TagVisibilityFilter(self.session, user_id, organization_id)
            candidates = [tag_by_id[tid] for tid in tag_ids if tid in tag_by_id]
            visible_ids = await visibility.visible_id_set(candidates)

            id_to_urn = {v: k for k, v in urn_to_id.items()}
            for tag_id in tag_ids:
                urn = id_to_urn.get(tag_id)
                if urn is None or urn not in results:
                    continue
                if tag_id not in visible_ids:
                    results.pop(urn, None)

            if not visible_ids:
                return

            count_stmt = (
                select(TagAssignment.tag_id, func.count())
                .where(
                    TagAssignment.tag_id.in_(visible_ids),
                    TagAssignment.assigned_by == user_id,
                )
                .group_by(TagAssignment.tag_id)
            )
            count_rows = (await self.session.execute(count_stmt)).all()
            counts: dict[UUID, int] = {row[0]: int(row[1]) for row in count_rows}

            for tag_id in visible_ids:
                urn = id_to_urn.get(tag_id)
                if urn is None or urn not in results:
                    continue
                sr = results[urn]
                metadata = dict(sr.metadata or {})
                metadata["user_assignment_count"] = str(counts.get(tag_id, 0))
                sr.metadata = metadata
        except Exception:
            logger.warning("Failed to enrich tag live state", exc_info=True)


def _build_tombstone(urn: str, organization_id: UUID) -> SearchResult:
    """Build a placeholder ``SearchResult`` for a URN missing from the
    search index.

    The chip renders this as a "deleted / no longer available" state. We
    deliberately do not hit the database to distinguish DELETED vs
    NOT_FOUND vs FORBIDDEN -- "missing from index" is treated uniformly
    as DELETED, which is the only state that makes user-facing sense
    for a previously-typed mention.
    """
    parts = urn.split(":")
    entity_type = parts[3].lower() if len(parts) >= 5 else ""
    return SearchResult(
        urn=urn,
        organization_id=organization_id,
        title="",
        description=None,
        entity_type=entity_type,
        url_path="",
        access_mode=AccessMode.OWNER_ONLY.value,
        baseline_role=None,
        owner_id=organization_id,
        tags=None,
        metadata=None,
        updated_at=None,
        rank_score=0.0,
        search_score=None,
        urn_status="DELETED",
    )
