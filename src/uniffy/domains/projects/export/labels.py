"""Batched label lookups for project exports, loaded once per project and once per row batch."""

from collections.abc import Iterable, Sequence
from uuid import UUID

from sqlalchemy import and_, exists, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.field_definition import (
    FieldDefinition,
    ProjectFieldType,
    SystemProjectFieldId,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.domains.directory.subjects import subject_names
from uniffy.domains.projects.queries import get_fields_for_projects
from uniffy.domains.projects.tasks.expressions import MAX_ANCESTRY_DEPTH
from uniffy.domains.tags.reader import TagReader


def parse_ids(raws: Iterable[str]) -> set[UUID]:
    ids: set[UUID] = set()
    for raw in raws:
        try:
            ids.add(UUID(str(raw)))
        except ValueError:
            continue
    return ids


class ExportLabels:
    """Human-readable values for ids, scoped to one organization and the projects being exported.

    Subject names come from the directory's picker names, so a private group the exporter is not
    in stays an id, and emails only resolve for people who belong or belonged to the organization.
    Task keys only resolve for live tasks of the exported projects.
    """

    def __init__(self, session: AsyncSession, organization_id: UUID, user_id: UUID) -> None:
        self.session = session
        self.organization_id = organization_id
        self.user_id = user_id
        self._slugs: dict[UUID, str] = {}
        self._fields: dict[UUID, dict[str, FieldDefinition]] = {}
        self._options: dict[tuple[UUID, str], dict[str, str]] = {}
        self._sprints: dict[UUID, Sprint] = {}
        self._emails: dict[UUID, str] = {}
        self._names: dict[UUID, str] = {}
        self._resolved_subjects: set[UUID] = set()
        self._keys: dict[UUID, str] = {}
        self._tags: dict[UUID, list[str]] = {}
        self._depths: dict[UUID, int] = {}

    @property
    def project_ids(self) -> list[UUID]:
        return list(self._slugs)

    async def load_projects(self, projects: Sequence[Project]) -> dict[UUID, list[FieldDefinition]]:
        self._slugs = {project.id: project.slug for project in projects}
        grouped = await get_fields_for_projects(self.session, self.project_ids)
        fields_by_project = {project.id: grouped.get(str(project.id), []) for project in projects}
        for project_id, fields in fields_by_project.items():
            self._fields[project_id] = {field.id: field for field in fields}
            for field in fields:
                options = (field.config or {}).get("options", [])
                self._options[(project_id, field.id)] = {
                    str(option.get("id", option.get("label", ""))): str(
                        option.get("label") or option.get("id", "")
                    )
                    for option in options
                    if isinstance(option, dict)
                }
        sprints = await self.session.execute(
            select(Sprint).where(
                and_(
                    Sprint.project_id.in_(self.project_ids),
                    Sprint.organization_id == self.organization_id,
                )
            )
        )
        self._sprints = {sprint.id: sprint for sprint in sprints.scalars().all()}
        return fields_by_project

    def sprints(self, project_id: UUID) -> list[Sprint]:
        rows = [sprint for sprint in self._sprints.values() if sprint.project_id == project_id]
        return sorted(rows, key=lambda sprint: (sprint.sort_order, sprint.name))

    def fields(self, project_id: UUID) -> list[FieldDefinition]:
        return sorted(self._fields.get(project_id, {}).values(), key=lambda f: f.sort_order)

    async def load_tasks(self, project_id: UUID, tasks: Sequence[Task]) -> None:
        """Resolve every id the given rows reference, in one query per kind."""
        subjects: set[str] = set()
        key_ids: set[UUID] = set()
        for task in tasks:
            subjects.update(task.assignee_ids or [])
            subjects.add(str(task.owner_id))
            if task.parent_id is not None:
                key_ids.add(task.parent_id)
            key_ids.update(parse_ids(task.blocked_by_task_ids or []))
            for field_id, value in (task.field_values or {}).items():
                field = self.field(project_id, field_id)
                if field is not None and field.type == ProjectFieldType.PERSON:
                    subjects.update(value if isinstance(value, list) else [value])
        await self.load_subjects(subjects)
        await self.load_task_keys(key_ids)
        await self._load_tags([task.id for task in tasks])
        await self._load_depths(project_id, [task.id for task in tasks])

    async def load_subjects(self, raws: Iterable[str | UUID]) -> None:
        wanted = parse_ids(str(raw) for raw in raws if raw) - self._resolved_subjects
        if not wanted:
            return
        self._resolved_subjects |= wanted
        member = exists().where(
            and_(
                OrganizationMember.user_id == User.id,
                OrganizationMember.organization_id == self.organization_id,
            )
        )
        emails = await self.session.execute(
            select(User.id, User.email).where(and_(User.id.in_(wanted), member))
        )
        self._emails.update({row.id: row.email for row in emails.all()})
        names = subject_names(self.organization_id, self.user_id)
        rows = await self.session.execute(
            select(names.c.subject_id, names.c.name).where(names.c.subject_id.in_(wanted))
        )
        self._names.update({row.subject_id: row.name for row in rows.all()})

    async def load_task_keys(self, ids: Iterable[UUID]) -> None:
        """Replace the key lookup with the given tasks', so it never outgrows one batch."""
        self._keys = {}
        wanted = set(ids)
        if not wanted:
            return
        rows = await self.session.execute(
            select(Task.id, Task.project_id, Task.number).where(
                and_(
                    Task.id.in_(wanted),
                    Task.organization_id == self.organization_id,
                    Task.project_id.in_(self.project_ids),
                    Task.is_deleted == False,  # noqa: E712
                )
            )
        )
        for row in rows.all():
            self._keys[row.id] = self.key(self._slugs[row.project_id], row.number)

    async def _load_tags(self, task_ids: list[UUID]) -> None:
        urn_to_id = {build_content_urn(ContentType.TASK, task_id): task_id for task_id in task_ids}
        bulk = await TagReader(self.session).get_for_urns(
            organization_id=self.organization_id, content_urns=list(urn_to_id)
        )
        self._tags = {urn_to_id[urn]: [tag.name for tag in tags] for urn, tags in bulk.items()}

    async def _load_depths(self, project_id: UUID, task_ids: list[UUID]) -> None:
        """Depth counted as the table counts it: a parent outside the live tasks is one level."""
        self._depths = {}
        if not task_ids:
            return
        anchor = Task.__table__.alias("export_anchor")
        walk = (
            select(
                anchor.c.id.label("task_id"),
                anchor.c.id.label("ancestor_id"),
                anchor.c.parent_id.label("next_parent_id"),
                literal(0).label("depth"),
            )
            .where(anchor.c.id.in_(task_ids))
            .cte(name="export_ancestry", recursive=True)
        )
        parent = Task.__table__.alias("export_parent")
        walk = walk.union_all(
            select(
                walk.c.task_id,
                parent.c.id,
                parent.c.parent_id,
                walk.c.depth + 1,
            )
            .select_from(
                walk.outerjoin(
                    parent,
                    and_(
                        parent.c.id == walk.c.next_parent_id,
                        parent.c.project_id == project_id,
                        parent.c.organization_id == self.organization_id,
                        parent.c.is_deleted == False,  # noqa: E712
                    ),
                )
            )
            .where(
                and_(
                    walk.c.next_parent_id.is_not(None),
                    walk.c.ancestor_id.is_not(None),
                    walk.c.depth < MAX_ANCESTRY_DEPTH,
                )
            )
        )
        rows = await self.session.execute(
            select(walk.c.task_id, func.max(walk.c.depth)).group_by(walk.c.task_id)
        )
        self._depths = {task_id: depth for task_id, depth in rows.all()}

    @staticmethod
    def key(slug: str, number: int) -> str:
        return f"{slug}-{number}"

    def slug(self, project_id: UUID) -> str:
        return self._slugs.get(project_id, "")

    def field(self, project_id: UUID, field_id: str | None) -> FieldDefinition | None:
        return self._fields.get(project_id, {}).get(field_id) if field_id else None

    def field_name(self, project_id: UUID, field_id: str | None) -> str:
        field = self.field(project_id, field_id)
        return field.name if field else (field_id or "")

    def option_label(self, project_id: UUID, field_id: str, raw: str) -> str:
        return self._options.get((project_id, field_id), {}).get(raw, raw)

    def status_label(self, project_id: UUID, raw: str) -> str:
        return self.option_label(project_id, SystemProjectFieldId.STATUS, raw)

    def priority_label(self, project_id: UUID, raw: str) -> str:
        return self.option_label(project_id, SystemProjectFieldId.PRIORITY, raw)

    @staticmethod
    def task_type_label(raw: str) -> str:
        return raw.replace("_", " ").capitalize()

    def subject_label(self, raw: str | UUID) -> str:
        try:
            subject_id = UUID(str(raw))
        except ValueError:
            return str(raw)
        return self._emails.get(subject_id) or self._names.get(subject_id) or str(raw)

    def email(self, user_id: UUID | None) -> str:
        return self._emails.get(user_id, "") if user_id else ""

    def sprint_name(self, sprint_id: UUID | str | None) -> str:
        if not sprint_id:
            return ""
        try:
            sprint = self._sprints.get(UUID(str(sprint_id)))
        except ValueError:
            return str(sprint_id)
        return sprint.name if sprint else ""

    def task_key(self, task_id: UUID | None) -> str:
        return self._keys.get(task_id, "") if task_id else ""

    def task_key_from_text(self, raw: str) -> str:
        try:
            return self.task_key(UUID(str(raw)))
        except ValueError:
            return ""

    def tags(self, task_id: UUID) -> list[str]:
        return self._tags.get(task_id, [])

    def depth(self, task_id: UUID) -> int:
        return self._depths.get(task_id, 0)
