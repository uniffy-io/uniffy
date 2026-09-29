"""Bounded projection of outgoing references across the content the actor can read."""

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions import ContentAccessQuery
from uniffy.core.models.calendar.event import CalendarEvent
from uniffy.core.models.notes.note import Note
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.scheduling.calendar.operations import CalendarEventReader

GRAPH_MAX_ROWS_PER_TYPE = 1000
GRAPH_MAX_REFERENCES_PER_SOURCE = 50
GRAPH_MAX_EDGES = 20_000


class GraphEdgeCollector:
    def __init__(
        self,
        *,
        max_rows: int = GRAPH_MAX_ROWS_PER_TYPE,
        max_references_per_source: int = GRAPH_MAX_REFERENCES_PER_SOURCE,
        max_edges: int = GRAPH_MAX_EDGES,
    ) -> None:
        self.max_rows = max_rows
        self.max_references_per_source = max_references_per_source
        self.max_edges = max_edges
        self.edges: list[tuple[str, str]] = []
        self.truncated = False
        self._seen: set[tuple[str, str]] = set()

    def add_rows(
        self,
        rows: Sequence[tuple[UUID, Sequence[object] | None]],
        content_type: ContentType,
    ) -> bool:
        """Returns False once the global edge budget is spent."""
        if len(rows) > self.max_rows:
            self.truncated = True

        for content_id, references in rows[: self.max_rows]:
            source = build_content_urn(content_type, content_id)
            source_edges = 0
            for target in references or []:
                if not isinstance(target, str) or not target or target == source:
                    continue
                edge = (source, target)
                if edge in self._seen:
                    continue
                if source_edges >= self.max_references_per_source:
                    self.truncated = True
                    break
                if len(self.edges) >= self.max_edges:
                    self.truncated = True
                    return False
                self._seen.add(edge)
                self.edges.append(edge)
                source_edges += 1

        return True


async def build_content_graph(
    session: AsyncSession,
    access_query: ContentAccessQuery,
    user_id: UUID,
    organization_id: UUID,
    max_rows_per_type: int = GRAPH_MAX_ROWS_PER_TYPE,
) -> tuple[list[tuple[str, str]], bool]:
    collector = GraphEdgeCollector(max_rows=max_rows_per_type)
    query_limit = max_rows_per_type + 1

    note_filter = await access_query.build_accessible_filter(
        user_id=user_id,
        organization_id=organization_id,
        content_type=ContentType.NOTE,
        content_id_column=Note.id,
        owner_id_column=Note.owner_id,
        access_mode_column=Note.access_mode,
        baseline_role_column=Note.baseline_role,
    )
    note_rows = (
        await session.execute(
            select(Note.id, Note.outgoing_references)
            .where(
                Note.organization_id == organization_id,
                Note.is_deleted == False,  # noqa: E712
                Note.outgoing_references.isnot(None),
                note_filter,
            )
            .order_by(Note.updated_at.desc())
            .limit(query_limit)
        )
    ).all()
    has_capacity = collector.add_rows(note_rows, ContentType.NOTE)

    if has_capacity:
        project_filter = await access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.PROJECT,
            content_id_column=Project.id,
            owner_id_column=Project.owner_id,
            access_mode_column=Project.access_mode,
            baseline_role_column=Project.baseline_role,
        )
        accessible_projects = select(Project.id).where(
            Project.organization_id == organization_id,
            Project.is_deleted == False,  # noqa: E712
            project_filter,
        )
        task_rows = (
            await session.execute(
                select(Task.id, Task.outgoing_references)
                .where(
                    Task.organization_id == organization_id,
                    Task.project_id.in_(accessible_projects),
                    Task.is_deleted == False,  # noqa: E712
                    Task.outgoing_references.isnot(None),
                )
                .order_by(Task.updated_at.desc())
                .limit(query_limit)
            )
        ).all()
        has_capacity = collector.add_rows(task_rows, ContentType.TASK)

    if has_capacity:
        event_filter = await CalendarEventReader(session).event_access_filter(
            user_id, organization_id
        )
        event_rows = (
            await session.execute(
                select(CalendarEvent.id, CalendarEvent.outgoing_references)
                .where(
                    CalendarEvent.organization_id == organization_id,
                    CalendarEvent.is_deleted == False,  # noqa: E712
                    CalendarEvent.outgoing_references.isnot(None),
                    event_filter,
                )
                .order_by(CalendarEvent.updated_at.desc())
                .limit(query_limit)
            )
        ).all()
        collector.add_rows(event_rows, ContentType.CALENDAR_EVENT)

    return collector.edges, collector.truncated
