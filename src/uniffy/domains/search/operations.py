"""Unified search and reference resolution."""

import asyncio
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import ContentAccessQuery
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.content.references import parse_urn
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.files.file import File
from uniffy.core.models.login.user import User
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.search.meilisearch import SearchCandidateScope
from uniffy.core.types import AccessMode, ContentType
from uniffy.domains.permissions.resource_access import (
    ResourceAccessPurpose,
    ResourceAccessResolver,
    ResourceKey,
    ResourceRowState,
)
from uniffy.domains.search.authorized_search import AuthorizedSearch, AuthorizedSearchQuery
from uniffy.domains.search.queries import (
    SearchResult,
    UrnAvailability,
    execute_search,
    get_raw_documents_by_urns,
)
from uniffy.domains.tags import TagOperations

logger = logger.bind(component="search.operations")


class SearchOperations:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access_query = ContentAccessQuery(session)
        self.resource_access = ResourceAccessResolver(session)

    async def search(
        self,
        user_id: UUID,
        organization_id: UUID,
        query_text: str,
        type_filters: list[str] | None = None,
        tag_filters: list[str] | None = None,
        my_content_only: bool = False,
        owner_filter: UUID | None = None,
        metadata_filters: dict[str, str] | None = None,
        limit: int = 20,
        offset: int = 0,
        type_priority: list[str] | None = None,
        name_matches_only: bool = False,
    ) -> tuple[list[SearchResult], bool, int]:
        subject = await self.resource_access.subject(
            actor_id=user_id,
            organization_id=organization_id,
        )
        if not subject.is_active_member and subject.support_role is None:
            raise PermissionDeniedError("access", "organization")

        candidate_scope = (
            SearchCandidateScope.MEMBER_HINT
            if subject.is_active_member
            else SearchCandidateScope.ORGANIZATION
        )
        return await AuthorizedSearch(self.resource_access, execute_search).run(
            AuthorizedSearchQuery(
                user_id=user_id,
                organization_id=organization_id,
                query_text=query_text,
                user_group_ids=tuple(subject.group_ids),
                candidate_scope=candidate_scope,
                type_filters=tuple(type_filters) if type_filters else None,
                tag_filters=tuple(tag_filters) if tag_filters else None,
                my_content_only=my_content_only,
                owner_filter=owner_filter,
                metadata_filters=metadata_filters,
                limit=limit,
                offset=offset,
                type_priority=tuple(type_priority) if type_priority else None,
                name_matches_only=name_matches_only,
            )
        )

    async def get_references(
        self,
        user_id: UUID,
        organization_id: UUID,
        target_urn: str,
        type_filters: list[str] | None = None,
        limit: int = 50,
    ) -> tuple[list[SearchResult], int]:
        """Today only notes track outgoing references."""
        if type_filters and ContentType.NOTE.value.lower() not in type_filters:
            return [], 0

        access_filter = await self.access_query.build_accessible_filter(
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
            self.session,
            organization_id,
            ContentType.NOTE,
        )

        search_results: list[SearchResult] = []
        for note in notes:
            note_tags = [t.slug for t in tags_by_urn.get(urn_for(note), [])]
            effective_mode, effective_baseline = resolve_effective_policy(
                note.access_mode,
                note.baseline_role,
                default_mode,
                default_baseline,
            )
            search_results.append(
                SearchResult(
                    urn=urn_for(note),
                    organization_id=note.organization_id,
                    title=note.title,
                    description=note.content[:200] if note.content else None,
                    entity_type=ContentType.NOTE.value.lower(),
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
        if not urns:
            return {}

        urns = list(dict.fromkeys(urns[:100]))
        key_by_urn = {
            urn: ResourceKey(*parsed) for urn in urns if (parsed := parse_urn(urn)) is not None
        }
        if not key_by_urn:
            return {}

        raw_result, decisions_result = await asyncio.gather(
            get_raw_documents_by_urns(list(key_by_urn), organization_id),
            self.resource_access.resolve(
                actor_id=user_id,
                organization_id=organization_id,
                keys=key_by_urn.values(),
                purpose=ResourceAccessPurpose.REFERENCE,
            ),
            return_exceptions=True,
        )
        if isinstance(decisions_result, BaseException):
            logger.opt(exception=decisions_result).warning("PostgreSQL URN authorization failed")
            return {
                urn: _build_reference_result(
                    urn,
                    organization_id,
                    UrnAvailability.UNAVAILABLE,
                )
                for urn in key_by_urn
            }
        decisions = decisions_result
        if isinstance(raw_result, BaseException):
            logger.opt(exception=raw_result).warning("Meilisearch URN preview lookup failed")
            return {
                urn: _build_reference_result(
                    urn,
                    organization_id,
                    UrnAvailability.UNAVAILABLE,
                )
                for urn in key_by_urn
            }
        raw = raw_result

        resolved: dict[str, SearchResult] = {}
        available: dict[str, SearchResult] = {}
        for urn, key in key_by_urn.items():
            decision = decisions.get(key)
            if decision is None:
                resolved[urn] = _build_reference_result(
                    urn,
                    organization_id,
                    UrnAvailability.UNAVAILABLE,
                )
            elif decision.row_state in {ResourceRowState.DELETED, ResourceRowState.MISSING}:
                resolved[urn] = _build_reference_result(
                    urn,
                    organization_id,
                    UrnAvailability.DELETED,
                )
            elif not decision.can_view:
                resolved[urn] = _build_reference_result(
                    urn,
                    organization_id,
                    UrnAvailability.RESTRICTED,
                    can_request_access=decision.request_target is not None,
                )
            elif urn in raw.failed_urns or urn not in raw.documents:
                resolved[urn] = _build_reference_result(
                    urn,
                    organization_id,
                    UrnAvailability.UNAVAILABLE,
                )
            else:
                raw_document = raw.documents[urn]
                raw_document.availability = UrnAvailability.AVAILABLE
                raw_document.can_request_access = False
                resolved[urn] = raw_document
                available[urn] = raw_document

        await self._enrich_live_state(available, organization_id, user_id)
        return resolved

    async def _enrich_live_state(
        self,
        results: dict[str, SearchResult],
        organization_id: UUID,
        user_id: UUID,
    ) -> None:
        if not results:
            return

        task_ids: list[UUID] = []
        file_ids: list[UUID] = []
        project_ids: list[UUID] = []
        calendar_ids: list[UUID] = []
        note_ids: list[UUID] = []
        chat_ids: list[UUID] = []
        agent_ids: list[UUID] = []
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
                if et == ContentType.TASK.value.lower():
                    task_ids.append(content_id)
                elif et == ContentType.FILE.value.lower():
                    file_ids.append(content_id)
                elif et == ContentType.PROJECT.value.lower():
                    project_ids.append(content_id)
                elif et == ContentType.CALENDAR_EVENT.value.lower():
                    calendar_ids.append(content_id)
                elif et == ContentType.NOTE.value.lower():
                    note_ids.append(content_id)
                elif et == ContentType.CHAT.value.lower():
                    chat_ids.append(content_id)
                elif et == ContentType.AGENT.value.lower():
                    agent_ids.append(content_id)
                elif et == ContentType.TAG.value.lower():
                    tag_ids.append(content_id)
            except ValueError, IndexError:
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
        if tag_ids:
            await self._enrich_tags(results, tag_ids, urn_to_id, user_id, organization_id)

    async def _enrich_tasks(
        self,
        results: dict[str, SearchResult],
        task_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
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
            logger.exception(f"Failed to enrich task live state: {exc}")

    async def _load_field_options(
        self,
        project_ids: list[UUID],
    ) -> dict[UUID, dict[str, list[dict]]]:
        """Returns project_id -> field_id -> list of option dicts."""
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
            if row.config and "options" in row.config:  # noqa: PLR2004
                field_map.setdefault(row.project_id, {})[row.id] = row.config["options"]
        return field_map

    async def _get_subtask_counts(
        self,
        parent_ids: list[UUID],
    ) -> dict[UUID, tuple[int, int]]:
        """Returns parent_id -> (total, completed)."""
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
            logger.opt(exception=True).warning("Failed to enrich file live state")

    async def _enrich_projects(
        self,
        results: dict[str, SearchResult],
        project_ids: list[UUID],
        urn_to_id: dict[str, UUID],
        organization_id: UUID,
    ) -> None:
        try:
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
            logger.opt(exception=True).warning("Failed to enrich project live state")

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
                CalendarEvent.channel_id,
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
                sr.event_channel_id = str(row.channel_id) if row.channel_id else None
        except Exception:
            logger.opt(exception=True).warning("Failed to enrich calendar event live state")

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
            logger.opt(exception=True).warning("Failed to enrich note live state")

    async def _enrich_channels(
        self,
        results: dict[str, SearchResult],
        channel_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
        """Chat channel live state is denormalized at index time; no DB call here."""
        del results, channel_ids, urn_to_id

    async def _enrich_agents(
        self,
        results: dict[str, SearchResult],
        agent_ids: list[UUID],
        urn_to_id: dict[str, UUID],
    ) -> None:
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
            logger.opt(exception=True).warning("Failed to enrich agent live state")

    async def _enrich_tags(
        self,
        results: dict[str, SearchResult],
        tag_ids: list[UUID],
        urn_to_id: dict[str, UUID],
        user_id: UUID,
        organization_id: UUID,
    ) -> None:
        """Attach the per-user assignment count to authorized tag previews."""
        try:
            id_to_urn = {v: k for k, v in urn_to_id.items()}
            authorized_ids = {
                tag_id
                for tag_id in tag_ids
                if (urn := id_to_urn.get(tag_id)) is not None and urn in results
            }
            if not authorized_ids:
                return

            count_stmt = (
                select(TagAssignment.tag_id, func.count())
                .where(
                    TagAssignment.tag_id.in_(authorized_ids),
                    TagAssignment.assigned_by == user_id,
                )
                .group_by(TagAssignment.tag_id)
            )
            count_rows = (await self.session.execute(count_stmt)).all()
            counts: dict[UUID, int] = {row[0]: int(row[1]) for row in count_rows}

            for tag_id in authorized_ids:
                urn = id_to_urn.get(tag_id)
                if urn is None or urn not in results:
                    continue
                sr = results[urn]
                metadata = dict(sr.metadata or {})
                metadata["user_assignment_count"] = str(counts.get(tag_id, 0))
                sr.metadata = metadata
        except Exception:
            logger.opt(exception=True).warning("Failed to enrich tag live state")


def _build_reference_result(
    urn: str,
    organization_id: UUID,
    availability: UrnAvailability,
    *,
    can_request_access: bool = False,
) -> SearchResult:
    parsed = parse_urn(urn)
    entity_type = parsed[0].value.lower() if parsed is not None else ""
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
        availability=availability,
        can_request_access=can_request_access,
    )
