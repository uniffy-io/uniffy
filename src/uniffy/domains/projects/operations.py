"""Projects and tasks operations."""

import re
import secrets
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import String, and_, cast, delete, func, literal, not_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.content.members import (
    ContentMembersOperations,
    register_attachment_cascade_loader,
    register_content_loader,
)
from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.events import (
    NotificationEvent,
    emit_notification,
    extract_mentioned_team_ids,
    extract_mentioned_user_ids,
)
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.user import User
from uniffy.core.models.permissions.content_member import ContentMember
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.task_watcher import TaskWatcher
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    AccessMode,
    ContentRole,
    ContentType,
    NotificationType,
    SubjectType,
    generate_id,
)
from uniffy.core.valkey import publish_content_access_changed
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.projects import queries
from uniffy.domains.projects.recurrence import (
    compute_next_occurrence,
    parse_recurrence_config,
    serialize_recurrence_config,
)
from uniffy.domains.projects.validation import validate_field_values
from uniffy.domains.tags import TagAssignment, TagOperations

logger = logger.bind(component="projects.operations")

_SLUG_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{1,4}$")


class ProjectOperations(BaseContentOperations[Project]):
    content_type = ContentType.PROJECT
    model_class = Project

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    def _build_search_keywords(self, model: Project) -> str:
        parts = [model.name]
        if model.description:
            parts.append(model.description)
        return " ".join(parts)

    def _get_search_title(self, model: Project) -> str:
        return model.name

    def _get_url_path(self, model: Project) -> str:
        return f"/projects/{model.id}"

    def _get_search_description(self, model: Project) -> str | None:
        if model.description:
            return model.description[:200]
        return None

    async def _get_search_tags_async(self, model: Project) -> list[str] | None:
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    async def _sync_project_tags(
        self,
        *,
        actor_id: UUID,
        project: Project,
        tag_ids: list[UUID] | None,
    ) -> None:
        """``tag_ids=None`` leaves manual assignments untouched."""
        if tag_ids is None:
            return
        tag_ops = TagOperations(self.session)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=project.organization_id,
            content_urn=build_content_urn(self.content_type, project.id),
            tag_ids=tag_ids,
        )

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        description: str = "",
        icon: str = "folder",
        color: str = "#3b82f6",
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        group_ids: list[UUID] | None = None,
        slug: str | None = None,
        tag_ids: list[UUID] | None = None,
    ) -> Project:
        """``access_mode`` / ``baseline_role`` default to the org defaults
        for ``ContentType.PROJECT``.
        """
        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        resolved_slug = await self._resolve_slug(organization_id, name, slug)
        project = Project(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            description=description,
            icon=icon,
            color=color,
            access_mode=access_mode,
            baseline_role=baseline_role,
            slug=resolved_slug,
            task_counter=0,
        )
        self.session.add(project)
        await self.session.flush()
        await self.session.refresh(project)

        await self._create_default_fields(project.id)
        default_view_id = await self._create_default_views(project.id)
        project.default_view_id = default_view_id

        await self.session.commit()
        await self.session.refresh(project)

        if group_ids:
            members_ops = ContentMembersOperations(self.session)
            for gid in group_ids:
                await members_ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id=project.id,
                    subject_type=SubjectType.GROUP,
                    subject_id=gid,
                    role=ContentRole.VIEWER,
                )

        await self._sync_project_tags(
            actor_id=user_id,
            project=project,
            tag_ids=tag_ids,
        )

        await self._index_for_search(project, skip_member_lookup=not group_ids)
        await self.session.commit()

        effective_mode, _ = await self._effective_policy(organization_id, project)
        await self._broadcast_open_to_org_create(organization_id, project.id, effective_mode)

        return project

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        **kwargs,
    ) -> Project:
        """Access-policy changes go through ``permissions.v1.MembersService``, never this method."""
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_manage(user_id, organization_id, project)

        kwargs.pop("access_mode", None)
        kwargs.pop("baseline_role", None)
        tag_ids = kwargs.pop("tag_ids", None)

        name_changed = "name" in kwargs and kwargs["name"] != project.name

        for key, value in kwargs.items():
            if value is not None and hasattr(project, key):
                setattr(project, key, value)

        project.version += 1
        project.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(project)

        await self._sync_project_tags(
            actor_id=user_id,
            project=project,
            tag_ids=tag_ids,
        )

        await self._index_for_search(project)
        await self.session.commit()

        if name_changed:
            try:
                project_urn = build_content_urn(self.content_type, project.id)
                await propagate_rename(
                    session=self.session,
                    organization_id=organization_id,
                    target_urn=project_urn,
                    new_label=project.name,
                )
                await self.session.commit()
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to propagate project rename to mentions",
                    project_id=str(project_id)
                )

        return project

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        permanent: bool = False,
    ) -> bool:
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_delete(user_id, organization_id, project)

        if permanent:
            tag_ops = TagOperations(self.session)
            project_urn = build_content_urn(self.content_type, project_id)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=project_urn,
            )
            task_id_rows = await self.session.execute(
                select(Task.id).where(Task.project_id == project_id)
            )
            for (task_id,) in task_id_rows:
                await tag_ops.unassign_all_for_urn(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(ContentType.TASK, task_id),
                )
            await queries.delete_project_cascade(self.session, project_id)
            await self.session.delete(project)
        else:
            project.is_deleted = True
            project.deleted_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(
                Action.PROJECT_PERMANENTLY_DELETED
                if permanent
                else Action.PROJECT_DELETED
            ),
            resource_type=ContentType.PROJECT.value,
            resource_id=project_id,
            details={"name": project.name},
        )

        await self.session.commit()
        await self.search_indexer.remove(
            build_content_urn(self.content_type, project_id), organization_id
        )
        # Drop tasks indexed under this project; ``metadata.project_id`` is filterable.
        await self.search_indexer.remove_by_filter(
            f'entity_type = "task" AND metadata.project_id = "{project_id}"'
        )
        return True

    async def list_projects(
        self,
        user_id: UUID,
        organization_id: UUID,
        access_mode: AccessMode | None = None,
        include_deleted: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Project], int]:
        query = select(Project).where(Project.organization_id == organization_id)

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Project.id,
            owner_id_column=Project.owner_id,
            access_mode_column=Project.access_mode,
            baseline_role_column=Project.baseline_role,
        )
        query = query.where(access_filter)

        if access_mode is not None:
            query = query.where(Project.access_mode == access_mode)

        if not include_deleted:
            query = query.where(Project.is_deleted == False)  # noqa: E712

        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        query = query.order_by(Project.updated_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        projects = list(result.scalars().all())

        return projects, total

    def _generate_slug_candidate(self, name: str) -> str:
        words = [w for w in name.split() if w]
        if len(words) >= 2:
            candidate = "".join(w[0] for w in words)[:5].upper()
        else:
            cleaned = re.sub(r"[^a-zA-Z0-9]", "", name)
            candidate = cleaned[:3].upper() if cleaned else "PRJ"
        return candidate if len(candidate) >= 2 else (candidate + "PROJ")[:5]

    async def _resolve_slug(
        self,
        organization_id: UUID,
        name: str,
        requested_slug: str | None,
    ) -> str:
        candidate = requested_slug.upper() if requested_slug else self._generate_slug_candidate(name)
        if not _SLUG_PATTERN.match(candidate):
            raise ValidationError(
                "slug",
                f"Slug '{candidate}' must be 2-5 uppercase letters/digits starting with a letter",
            )
        for suffix in ["", "2", "3", "4", "5", "6", "7", "8", "9"]:
            slug_to_try = candidate + suffix
            exists = await self.session.execute(
                select(Project).where(
                    Project.organization_id == organization_id,
                    Project.slug == slug_to_try,
                    Project.is_deleted == False,  # noqa: E712
                )
            )
            if exists.scalar_one_or_none() is None:
                return slug_to_try
        return candidate[:4] + secrets.token_hex(1).upper()

    async def _create_default_fields(self, project_id: UUID) -> None:
        default_fields = [
            FieldDefinition(
                id="field_title",
                project_id=project_id,
                name="Title",
                type="text",
                is_required=True,
                is_system=True,
                sort_order=0,
                config={},
            ),
            FieldDefinition(
                id="field_status",
                project_id=project_id,
                name="Status",
                type="single_select",
                is_required=False,
                is_system=True,
                sort_order=1,
                config={
                    "options": [
                        {
                            "id": "status_todo",
                            "label": "To Do",
                            "color": "#6b7280",
                            "sortOrder": 0,
                        },
                        {
                            "id": "status_in_progress",
                            "label": "In Progress",
                            "color": "#3b82f6",
                            "sortOrder": 1,
                        },
                        {
                            "id": "status_review",
                            "label": "Review",
                            "color": "#f59e0b",
                            "sortOrder": 2,
                        },
                        {
                            "id": "status_done",
                            "label": "Done",
                            "color": "#22c55e",
                            "sortOrder": 3,
                        },
                    ]
                },
            ),
            FieldDefinition(
                id="field_priority",
                project_id=project_id,
                name="Priority",
                type="single_select",
                is_required=False,
                is_system=True,
                sort_order=2,
                config={
                    "options": [
                        {
                            "id": "priority_low",
                            "label": "Low",
                            "color": "#22c55e",
                            "sortOrder": 0,
                        },
                        {
                            "id": "priority_medium",
                            "label": "Medium",
                            "color": "#f59e0b",
                            "sortOrder": 1,
                        },
                        {
                            "id": "priority_high",
                            "label": "High",
                            "color": "#ef4444",
                            "sortOrder": 2,
                        },
                        {
                            "id": "priority_urgent",
                            "label": "Urgent",
                            "color": "#dc2626",
                            "sortOrder": 3,
                        },
                    ]
                },
            ),
            FieldDefinition(
                id="field_assignee",
                project_id=project_id,
                name="Assignee",
                type="person",
                is_required=False,
                is_system=True,
                sort_order=3,
                config={"allowMultiple": True},
            ),
            FieldDefinition(
                id="field_start_date",
                project_id=project_id,
                name="Start Date",
                type="date",
                is_required=False,
                is_system=True,
                sort_order=4,
                config={},
            ),
            FieldDefinition(
                id="field_due_date",
                project_id=project_id,
                name="Due Date",
                type="date",
                is_required=False,
                is_system=True,
                sort_order=5,
                config={},
            ),
        ]

        for field in default_fields:
            self.session.add(field)

        await self.session.flush()

    async def _create_default_views(self, project_id: UUID) -> str:
        """Create the default views (table, board, roadmap) for a project."""
        default_views = [
            ViewConfig(
                id="view_table",
                project_id=project_id,
                name="Table",
                type="table",
                is_default=True,
                config={
                    "type": "table",
                    "visibleFieldIds": [
                        "field_title",
                        "field_status",
                        "field_priority",
                        "field_assignee",
                        "field_due_date",
                    ],
                    "columnWidths": {},
                    "sortFieldId": None,
                    "sortDirection": "asc",
                    "groupByFieldId": None,
                },
            ),
            ViewConfig(
                id="view_board",
                project_id=project_id,
                name="Board",
                type="board",
                is_default=False,
                config={
                    "type": "board",
                    "statusFieldId": "field_status",
                    "visibleFieldIds": ["field_priority", "field_assignee", "field_due_date"],
                    "collapsedColumnIds": [],
                },
            ),
            ViewConfig(
                id="view_roadmap",
                project_id=project_id,
                name="Roadmap",
                type="roadmap",
                is_default=False,
                config={
                    "type": "roadmap",
                    "startDateFieldId": "field_start_date",
                    "endDateFieldId": "field_due_date",
                    "zoomLevel": "week",
                    "visibleFieldIds": ["field_status", "field_priority"],
                },
            ),
        ]

        for view in default_views:
            self.session.add(view)

        await self.session.flush()

        return "view_table"


class TaskOperations(BaseContentOperations[Task]):
    """Task CRUD operations with permissions delegated to the parent project."""

    content_type = ContentType.TASK
    model_class = Task

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session)

    def _build_search_keywords(self, model: Task) -> str:
        parts = [model.title]
        if model.description:
            parts.append(model.description)
        return " ".join(parts)

    def _get_search_title(self, model: Task) -> str:
        return model.title

    def _get_url_path(self, model: Task) -> str:
        return f"/projects/{model.project_id}/tasks/{model.id}"

    def _get_search_description(self, model: Task) -> str | None:
        if model.description:
            return model.description[:200]
        return None

    def _get_search_metadata(self, model: Task) -> dict[str, str] | None:
        """``project_id`` is filterable so project delete can cascade-remove tasks in one call."""
        return {"project_id": str(model.project_id)}

    async def _get_search_tags_async(self, model: Task) -> list[str] | None:
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    async def _sync_task_tags(
        self,
        *,
        actor_id: UUID,
        task: Task,
        tag_ids: list[UUID] | None,
    ) -> None:
        """``tag_ids=None`` leaves manual assignments untouched."""
        if tag_ids is None:
            return
        tag_ops = TagOperations(self.session)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=task.organization_id,
            content_urn=build_content_urn(self.content_type, task.id),
            tag_ids=tag_ids,
        )

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Task ids that carry every tag id (ALL)."""
        urn_prefix = "urn:uniffy:content:TASK:"
        urn_expr = func.concat(urn_prefix, cast(Task.id, String))
        return (
            select(Task.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(Task.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    def _tag_any_subquery(self, tag_ids: list[UUID]):
        """Task ids that carry at least one tag id (ANY)."""
        urn_prefix = "urn:uniffy:content:TASK:"
        urn_expr = func.concat(urn_prefix, cast(Task.id, String))
        return (
            select(Task.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .distinct()
        )

    async def _resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        content: Task,
    ) -> ContentRole | None:
        """Tasks inherit role from the parent project."""
        project = await self.session.get(Project, content.project_id)
        if project is None:
            return None
        return await self.permission_checker.effective_role(
            user_id=user_id,
            organization_id=organization_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            owner_id=project.owner_id,
            access_mode=project.access_mode,
            baseline_role=project.baseline_role,
        )

    async def _index_for_search(
        self,
        model: Task,
        skip_member_lookup: bool = False,
    ) -> None:
        """Indexes the task under its parent project's access policy."""
        project = await self.session.get(Project, model.project_id)
        if project is None:
            return

        shared_user_ids: list[UUID] = []
        shared_group_ids: list[UUID] = []
        blocked_user_ids: list[UUID] = []
        blocked_group_ids: list[UUID] = []

        if not skip_member_lookup:
            # Index sharing metadata against the project's members.
            from uniffy.core.models.permissions.content_member import ContentMember
            from uniffy.core.types import SubjectType as SubjectTypeLocal

            result = await self.session.execute(
                select(
                    ContentMember.subject_type,
                    ContentMember.subject_id,
                    ContentMember.role,
                ).where(
                    ContentMember.content_type == ContentType.PROJECT,
                    ContentMember.content_id == project.id,
                )
            )
            for subject_type, subject_id, role in result.all():
                if subject_type == SubjectTypeLocal.USER:
                    if role == ContentRole.BLOCKED:
                        blocked_user_ids.append(subject_id)
                    else:
                        shared_user_ids.append(subject_id)
                elif subject_type == SubjectTypeLocal.GROUP:
                    if role == ContentRole.BLOCKED:
                        blocked_group_ids.append(subject_id)
                    else:
                        shared_group_ids.append(subject_id)

        default_mode, default_baseline = await resolve_content_defaults(
            self.session, model.organization_id, ContentType.PROJECT,
        )
        effective_mode, effective_baseline = resolve_effective_policy(
            project.access_mode, project.baseline_role, default_mode, default_baseline,
        )

        await self.search_indexer.index(
            urn=build_content_urn(self.content_type, model.id),
            organization_id=model.organization_id,
            title=self._get_search_title(model),
            entity_type=self.content_type.value,
            url_path=self._get_url_path(model),
            owner_id=model.owner_id,
            access_mode=effective_mode.value,
            baseline_role=(
                effective_baseline.value if effective_baseline is not None else None
            ),
            keywords=self._build_search_keywords(model),
            description=self._get_search_description(model),
            shared_user_ids=shared_user_ids if shared_user_ids else None,
            shared_group_ids=shared_group_ids if shared_group_ids else None,
            blocked_user_ids=blocked_user_ids if blocked_user_ids else None,
            blocked_group_ids=blocked_group_ids if blocked_group_ids else None,
            tags=await self._get_search_tags_async(model),
            metadata=self._get_search_metadata(model),
        )

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        title: str,
        task_type: str = "task",
        tag_ids: list[UUID] | None = None,
        **kwargs,
    ) -> Task:
        """Requires EDIT on the parent project."""
        project_ops = ProjectOperations(self.session)
        project = await project_ops.get_by_id(user_id, organization_id, project_id)
        await project_ops._require_edit(user_id, organization_id, project)

        counter_result = await self.session.execute(
            text(
                "UPDATE projects_projects "
                "SET task_counter = task_counter + 1 "
                "WHERE id = :project_id "
                "RETURNING task_counter"
            ),
            {"project_id": str(project_id)},
        )
        task_number = counter_result.scalar_one()

        await self._validate_field_values(
            project_id, kwargs.get("field_values"), task_type=task_type
        )

        parent_id = kwargs.get("parent_id")
        if parent_id is not None:
            if isinstance(parent_id, str):
                parent_id = UUID(parent_id)
            await self._validate_no_circular_parent(None, parent_id)

        description = kwargs.get("description", "")
        outgoing_references = queries.extract_urns_from_content(description) if description else []

        max_sort_order = await self.session.execute(
            select(func.max(Task.sort_order)).where(
                and_(
                    Task.project_id == project_id,
                    Task.organization_id == organization_id,
                    Task.is_deleted == False,  # noqa: E712
                )
            )
        )
        current_max = max_sort_order.scalar() or 0
        new_sort_order = current_max + 65536

        initial_status = kwargs.get("status", "status_todo")

        task = Task(
            project_id=project_id,
            organization_id=organization_id,
            owner_id=user_id,
            title=title,
            description=description,
            status=initial_status,
            priority=kwargs.get("priority", "priority_medium"),
            assignee_ids=kwargs.get("assignee_ids"),
            start_date=kwargs.get("start_date"),
            due_date=kwargs.get("due_date"),
            parent_id=parent_id,
            blocked_by_task_ids=kwargs.get("blocked_by_task_ids"),
            is_milestone=kwargs.get("is_milestone", False),
            recurrence_rule=kwargs.get("recurrence_rule"),
            sort_order=kwargs.get("sort_order", new_sort_order),
            field_values=kwargs.get("field_values"),
            outgoing_references=outgoing_references or None,
            created_at=datetime.now(UTC),
            number=task_number,
            task_type=task_type,
            sprint_id=kwargs.get("sprint_id"),
            # Creating straight into the done column has to stamp completion the
            # same way moving a task there does; otherwise the task reads as
            # open everywhere completion is measured by ``completed_at``.
            completed_at=datetime.now(UTC) if initial_status == "status_done" else None,
        )
        self.session.add(task)
        await self.session.flush()
        await self.session.refresh(task)

        await self._log_activity(task.id, user_id, "created")

        watcher_user_ids = [user_id]
        if task.assignee_ids:
            watcher_user_ids += await self._expand_assignees_to_users(
                [UUID(uid) for uid in task.assignee_ids]
            )
        await WatcherOperations(self.session).ensure_watching(
            watcher_user_ids, organization_id, task.id
        )

        await self.session.commit()
        await self.session.refresh(task)

        await self._sync_task_tags(actor_id=user_id, task=task, tag_ids=tag_ids)

        await self._index_for_search(task)

        await self._emit_assignment_notifications(task, user_id, None, task.assignee_ids)
        await self._emit_mention_notifications(task, user_id, None, task.outgoing_references)

        audience = await self._resolve_project_audience(organization_id, project)
        await publish_content_access_changed(
            content_type=content_type_to_proto(ContentType.PROJECT),
            content_id=project_id,
            action="child_added",
            organization_id=organization_id,
            target_user_ids=audience,
        )

        return task

    async def _resolve_project_audience(
        self,
        organization_id: UUID,
        project: Project,
    ) -> list[UUID] | None:
        """User ids that can view ``project`` (to ping their open task board), or
        ``None`` for an org-wide broadcast when the project is OPEN_TO_ORG.

        Targeting members directly keeps a private project's id off the org-wide
        channel; OPEN_TO_ORG projects are visible to everyone anyway.
        """
        default_mode, default_baseline = await resolve_content_defaults(
            self.session, organization_id, ContentType.PROJECT,
        )
        effective_mode, _ = resolve_effective_policy(
            project.access_mode, project.baseline_role, default_mode, default_baseline,
        )
        if effective_mode == AccessMode.OPEN_TO_ORG:
            return None

        rows = await self.session.execute(
            select(
                ContentMember.subject_type,
                ContentMember.subject_id,
                ContentMember.role,
            ).where(
                ContentMember.content_type == ContentType.PROJECT,
                ContentMember.content_id == project.id,
            )
        )
        viewers: set[UUID] = {project.owner_id}
        blocked: set[UUID] = set()
        group_ids: list[UUID] = []
        for subject_type, subject_id, role in rows.all():
            if subject_type == SubjectType.USER:
                (blocked if role == ContentRole.BLOCKED else viewers).add(subject_id)
            elif subject_type == SubjectType.GROUP and role != ContentRole.BLOCKED:
                group_ids.append(subject_id)
        if group_ids:
            members = await self.session.execute(
                select(GroupMember.user_id).where(
                    GroupMember.group_id.in_(group_ids),
                    GroupMember.is_active == True,  # noqa: E712
                )
            )
            viewers.update(row[0] for row in members.all())
        return list(viewers - blocked)

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        **kwargs,
    ) -> tuple[Task, Task | None]:
        task = await self.get_by_id(user_id, organization_id, task_id)
        await self._require_edit(user_id, organization_id, task)

        tag_ids = kwargs.pop("tag_ids", None)

        if "status" in kwargs and kwargs["status"] != task.status:
            unresolved = await self._check_blockers_resolved(task, kwargs["status"])
            if unresolved:
                blocker_names = [f"#{b['number']} {b['title']}" for b in unresolved[:5]]
                suffix = f" and {len(unresolved) - 5} more" if len(unresolved) > 5 else ""
                raise ValidationError(
                    "status",
                    "Cannot complete task: blocked by unresolved tasks: "
                    f"{', '.join(blocker_names)}{suffix}",
                )

        if "blocked_by_task_ids" in kwargs and kwargs["blocked_by_task_ids"]:
            await self._validate_no_circular_dependency(task_id, kwargs["blocked_by_task_ids"])

        if "parent_id" in kwargs and kwargs["parent_id"] is not None:
            proposed_parent = kwargs["parent_id"]
            if isinstance(proposed_parent, str):
                proposed_parent = UUID(proposed_parent)
            if proposed_parent != task.parent_id:
                await self._validate_no_circular_parent(task_id, proposed_parent)
                kwargs["parent_id"] = proposed_parent

        if kwargs.get("field_values") or kwargs.get("task_type"):
            effective_type = kwargs.get("task_type", task.task_type)
            merged_values = dict(task.field_values or {})
            if kwargs.get("field_values"):
                merged_values.update(kwargs["field_values"])
            await self._validate_field_values(
                task.project_id,
                merged_values,
                task_type=effective_type,
            )

        old_references = list(task.outgoing_references) if task.outgoing_references else None

        title_changed = "title" in kwargs and kwargs["title"] != task.title
        old_status = task.status
        old_due_date = task.due_date
        old_priority = task.priority
        old_assignee_ids = list(task.assignee_ids) if task.assignee_ids else []
        old_title = task.title
        previous_parent_id = task.parent_id
        parent_changed = (
            "parent_id" in kwargs and kwargs.get("parent_id") != task.parent_id
        )

        nullable_fields = {
            "start_date",
            "due_date",
            "description",
            "parent_id",
            "recurrence_rule",
            "sprint_id",
            "estimated_minutes",
            "time_spent_minutes",
        }

        for key, value in kwargs.items():
            if not hasattr(task, key):
                continue
            if value is None and key not in nullable_fields:
                continue
            old_value = getattr(task, key)

            if key == "field_values" and isinstance(value, dict):
                merged = dict(task.field_values or {})
                merged.update(value)
                setattr(task, key, merged)
            else:
                setattr(task, key, value)

            if key == "status" and old_value != value:
                if value == "status_done" and task.completed_at is None:
                    task.completed_at = datetime.now(UTC)
                elif old_value == "status_done" and value != "status_done":
                    task.completed_at = None

                await self._log_activity(
                    task_id,
                    user_id,
                    "status_changed",
                    field_id="field_status",
                    previous_value=str(old_value),
                    new_value=str(value),
                )
            elif key == "priority" and old_value != value:
                await self._log_activity(
                    task_id,
                    user_id,
                    "priority_changed",
                    field_id="field_priority",
                    previous_value=str(old_value),
                    new_value=str(value),
                )
            elif key == "task_type" and old_value != value:
                await self._log_activity(
                    task_id,
                    user_id,
                    "type_changed",
                    field_id="field_type",
                    previous_value=str(old_value),
                    new_value=str(value),
                )
            elif key == "sprint_id" and old_value != value:
                await self._log_activity(
                    task_id,
                    user_id,
                    "sprint_changed",
                    previous_value=str(old_value) if old_value else None,
                    new_value=str(value) if value else None,
                )
            elif key == "assignee_ids" and old_value != value:
                await self._log_activity(
                    task_id,
                    user_id,
                    "assigned",
                    field_id="field_assignee",
                    previous_value=",".join(old_value) if old_value else None,
                    new_value=",".join(value) if value else None,
                )

        if "description" in kwargs:
            task.outgoing_references = queries.extract_urns_from_content(task.description) or None

        task.version += 1
        task.updated_at = datetime.now(UTC)

        if parent_changed:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.TASK_MOVED,
                resource_type=ContentType.TASK.value,
                resource_id=task_id,
                details={
                    "previous_parent_id": (
                        str(previous_parent_id) if previous_parent_id else None
                    ),
                    "new_parent_id": str(task.parent_id) if task.parent_id else None,
                },
            )

        if "assignee_ids" in kwargs:
            newly_assigned = set(task.assignee_ids or []) - set(old_assignee_ids or [])
            if newly_assigned:
                member_ids = await self._expand_assignees_to_users(
                    [UUID(uid) for uid in newly_assigned]
                )
                if member_ids:
                    await WatcherOperations(self.session).ensure_watching(
                        member_ids, organization_id, task.id
                    )

        await self.session.commit()
        await self.session.refresh(task)

        await self._sync_task_tags(actor_id=user_id, task=task, tag_ids=tag_ids)

        await self._index_for_search(task)

        await self._emit_assignment_notifications(task, user_id, old_assignee_ids, task.assignee_ids)
        await self._emit_mention_notifications(
            task, user_id, old_references, task.outgoing_references
        )

        changes: list[str] = []
        if "status" in kwargs and kwargs["status"] != old_status:
            label = task.status.replace("status_", "").replace("_", " ").title()
            changes.append(f'Status changed to "{label}"')
        if "priority" in kwargs:
            label = task.priority.replace("priority_", "").replace("_", " ").title()
            changes.append(f'Priority changed to "{label}"')
        if "assignee_ids" in kwargs:
            changes.append("Assignees updated")
        if title_changed:
            changes.append("Title updated")
        if "due_date" in kwargs and task.due_date != old_due_date:
            changes.append("Due date updated")
        if changes:
            await self._emit_watcher_notifications(task, user_id, "; ".join(changes))

        if title_changed:
            try:
                task_urn = build_content_urn(ContentType.TASK, task.id)
                await propagate_rename(
                    session=self.session,
                    organization_id=organization_id,
                    target_urn=task_urn,
                    new_label=task.title,
                )
                await self.session.commit()
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to propagate task rename to mentions",
                    task_id=str(task_id)
                )

        mention_changes: dict[str, str] = {}
        if task.status != old_status:
            mention_changes["status"] = task.status
        if task.title != old_title:
            mention_changes["title"] = task.title
        if task.due_date != old_due_date:
            mention_changes["due_date"] = task.due_date or ""
        if task.priority != old_priority:
            mention_changes["priority"] = task.priority
        current_assignee_ids = list(task.assignee_ids) if task.assignee_ids else []
        if current_assignee_ids != old_assignee_ids:
            mention_changes["assignee_ids"] = ",".join(current_assignee_ids)

        if mention_changes:
            try:
                resolved = await self._resolve_field_option_labels(
                    task.project_id,
                    task.status,
                    task.priority,
                )
                mention_changes.update(resolved)
                await publish_mention_state(
                    organization_id=organization_id,
                    urn=task.urn,
                    changes=mention_changes,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to publish task mention state change",
                    task_id=str(task_id)
                )

        if task.parent_id and task.status == "status_done" and old_status != "status_done":
            parent_counts = await queries.get_subtask_counts(self.session, [task.parent_id])
            p_total, p_done = parent_counts.get(task.parent_id, (0, 0))
            if p_total > 0 and p_total == p_done:
                parent = await self.session.get(Task, task.parent_id)
                if parent and parent.status != "status_done" and not parent.is_deleted:
                    old_parent_status = parent.status
                    parent.status = "status_done"
                    parent.completed_at = datetime.now(UTC)
                    parent.version += 1
                    parent.updated_at = datetime.now(UTC)
                    await self.session.commit()
                    await self.session.refresh(parent)

                    await self._log_activity(
                        parent.id,
                        user_id,
                        "status_changed",
                        field_id="field_status",
                        previous_value=old_parent_status,
                        new_value="status_done",
                    )
        elif task.parent_id and old_status == "status_done" and task.status != "status_done":
            parent = await self.session.get(Task, task.parent_id)
            if parent and parent.status == "status_done" and not parent.is_deleted:
                parent.status = "status_in_progress"
                parent.completed_at = None
                parent.version += 1
                parent.updated_at = datetime.now(UTC)
                await self.session.commit()
                await self.session.refresh(parent)

                await self._log_activity(
                    parent.id,
                    user_id,
                    "status_changed",
                    field_id="field_status",
                    previous_value="status_done",
                    new_value="status_in_progress",
                )

        spawned_task: Task | None = None
        if task.recurrence_rule and task.status == "status_done" and old_status != "status_done":
            spawned_task = await self._spawn_next_recurring_instance(task, organization_id)

        return task, spawned_task

    async def _spawn_next_recurring_instance(
        self,
        completed_task: Task,
        organization_id: UUID,
    ) -> Task | None:
        config = parse_recurrence_config(completed_task.recurrence_rule)
        if not config:
            return None

        project = await self.session.get(Project, completed_task.project_id)
        if not project or project.is_deleted:
            return None

        today_str = datetime.now(UTC).strftime("%Y-%m-%d")
        base_date = completed_task.due_date or today_str
        next_date = compute_next_occurrence(base_date, config)
        if not next_date:
            return None

        config["occurrences_created"] = config.get("occurrences_created", 1) + 1
        next_rule = serialize_recurrence_config(config)

        counter_result = await self.session.execute(
            text(
                "UPDATE projects_projects "
                "SET task_counter = task_counter + 1 "
                "WHERE id = :project_id "
                "RETURNING task_counter"
            ),
            {"project_id": str(completed_task.project_id)},
        )
        task_number = counter_result.scalar_one()

        next_task = Task(
            project_id=completed_task.project_id,
            organization_id=completed_task.organization_id,
            owner_id=completed_task.owner_id,
            title=completed_task.title,
            description=completed_task.description or "",
            status="status_todo",
            priority=completed_task.priority,
            assignee_ids=(
                list(completed_task.assignee_ids) if completed_task.assignee_ids else None
            ),
            due_date=next_date,
            task_type=completed_task.task_type,
            recurrence_rule=next_rule,
            number=task_number,
            sort_order=completed_task.sort_order,
        )

        self.session.add(next_task)
        await self.session.flush()
        await self.session.refresh(next_task)

        await self._log_activity(next_task.id, completed_task.owner_id, "created")

        await self.session.commit()
        await self.session.refresh(next_task)

        await self._index_for_search(next_task)

        logger.info(
            "Spawned next recurring task instance",
            completed_task_id=str(completed_task.id),
            new_task_id=str(next_task.id),
            next_due_date=next_date,
        )

        return next_task

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        status: str,
        sort_order: int,
    ) -> tuple[Task, Task | None]:
        return await self.update(
            user_id,
            organization_id,
            task_id,
            status=status,
            sort_order=sort_order,
        )

    async def bulk_update(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_ids: list[str],
        **changes,
    ) -> list[Task]:
        updated: list[Task] = []
        for task_id in task_ids:
            task, _ = await self.update(user_id, organization_id, UUID(task_id), **changes)
            updated.append(task)
        return updated

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        permanent: bool = False,
    ) -> bool:
        task = await self.get_by_id(user_id, organization_id, task_id)
        await self._require_delete(user_id, organization_id, task)

        if permanent:
            tag_ops = TagOperations(self.session)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content_type, task_id),
            )
            await self.session.execute(delete(TaskActivity).where(TaskActivity.task_id == task_id))
            await self.session.delete(task)
        else:
            task.is_deleted = True
            task.deleted_at = datetime.now(UTC)

        await write_audit_event(
            self.session,
            organization_id=organization_id,
            actor_user_id=user_id,
            action=(
                Action.TASK_PERMANENTLY_DELETED if permanent else Action.TASK_DELETED
            ),
            resource_type=ContentType.TASK.value,
            resource_id=task_id,
            details={"title": task.title, "project_id": str(task.project_id)},
        )

        await self.session.commit()
        await self.search_indexer.remove(
            build_content_urn(self.content_type, task_id), organization_id
        )
        return True

    async def list_tasks(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        include_deleted: bool = False,
        parent_id: UUID | None = None,
        sprint_id: UUID | None = None,
        backlog_only: bool = False,
        tag_ids: list[UUID] | None = None,
        tag_filter_mode: str = "all",
        in_epic_id: UUID | None = None,
        root_only: bool = False,
        has_subtasks: bool | None = None,
        min_depth: int | None = None,
        max_depth: int | None = None,
        page: int = 1,
        page_size: int = 500,
    ) -> tuple[list[Task], int]:
        """``tag_filter_mode`` is ``all``/``any``/``none``; epic/depth
        filters use a recursive ancestry CTE.
        """
        project_ops = ProjectOperations(self.session)
        await project_ops.get_by_id(user_id, organization_id, project_id)

        query = select(Task).where(
            and_(
                Task.project_id == project_id,
                Task.organization_id == organization_id,
            )
        )

        if not include_deleted:
            query = query.where(Task.is_deleted == False)  # noqa: E712

        if root_only:
            query = query.where(Task.parent_id.is_(None))
        elif parent_id is not None:
            query = query.where(Task.parent_id == parent_id)

        if sprint_id is not None:
            query = query.where(Task.sprint_id == sprint_id)
        elif backlog_only:
            query = query.where(Task.sprint_id.is_(None))

        if tag_ids:
            mode = (tag_filter_mode or "all").lower()
            if mode == "any":
                query = query.where(Task.id.in_(self._tag_any_subquery(tag_ids)))
            elif mode == "none":
                query = query.where(not_(Task.id.in_(self._tag_any_subquery(tag_ids))))
            else:
                query = query.where(Task.id.in_(self._tag_filter_subquery(tag_ids)))

        if has_subtasks is not None:
            child_exists = (
                select(Task.id)
                .where(
                    and_(
                        Task.parent_id.is_not(None),
                        Task.organization_id == organization_id,
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
                .distinct()
            )
            if has_subtasks:
                query = query.where(Task.id.in_(child_exists.with_only_columns(Task.parent_id)))
            else:
                query = query.where(
                    not_(Task.id.in_(child_exists.with_only_columns(Task.parent_id)))
                )

        needs_ancestry = (
            in_epic_id is not None or min_depth is not None or max_depth is not None
        )
        if needs_ancestry:
            ancestry = self._build_ancestry_cte(project_id, organization_id)
            ancestry_filter = select(ancestry.c.task_id)
            if in_epic_id is not None:
                ancestry_filter = ancestry_filter.where(
                    ancestry.c.ancestor_id == in_epic_id
                )
            if min_depth is not None or max_depth is not None:
                depth_per_task = (
                    select(ancestry.c.task_id)
                    .group_by(ancestry.c.task_id)
                )
                conditions = []
                if min_depth is not None:
                    conditions.append(func.max(ancestry.c.depth) >= min_depth)
                if max_depth is not None:
                    conditions.append(func.max(ancestry.c.depth) <= max_depth)
                depth_per_task = depth_per_task.having(and_(*conditions))
                query = query.where(Task.id.in_(depth_per_task))
            if in_epic_id is not None:
                query = query.where(Task.id.in_(ancestry_filter))

        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        query = query.order_by(Task.sort_order.asc(), Task.created_at.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

    def _build_ancestry_cte(self, project_id: UUID, organization_id: UUID):
        """Emits ``(task_id, ancestor_id, depth)`` per ancestor, with depth
        0 marking the task itself.
        """
        task_alias = Task.__table__.alias("t_anchor")
        base = (
            select(
                task_alias.c.id.label("task_id"),
                task_alias.c.id.label("ancestor_id"),
                task_alias.c.parent_id.label("next_parent_id"),
                literal(0).label("depth"),
            )
            .where(
                and_(
                    task_alias.c.project_id == project_id,
                    task_alias.c.organization_id == organization_id,
                    task_alias.c.is_deleted == False,  # noqa: E712
                )
            )
        )
        ancestry = base.cte(name="task_ancestry", recursive=True)

        parent_alias = Task.__table__.alias("t_parent")
        recursive = (
            select(
                ancestry.c.task_id,
                parent_alias.c.id.label("ancestor_id"),
                parent_alias.c.parent_id.label("next_parent_id"),
                (ancestry.c.depth + 1).label("depth"),
            )
            .select_from(
                ancestry.join(parent_alias, parent_alias.c.id == ancestry.c.next_parent_id)
            )
            .where(
                and_(
                    parent_alias.c.organization_id == organization_id,
                    parent_alias.c.is_deleted == False,  # noqa: E712
                )
            )
        )
        return ancestry.union_all(recursive)

    async def _check_blockers_resolved(
        self,
        task: Task,
        new_status: str,
    ) -> list[dict[str, str]]:
        if new_status != "status_done":
            return []

        if not task.blocked_by_task_ids:
            return []

        blocker_ids = [UUID(bid) for bid in task.blocked_by_task_ids]
        result = await self.session.execute(
            select(Task.id, Task.title, Task.status, Task.number).where(
                and_(
                    Task.id.in_(blocker_ids),
                    Task.is_deleted == False,  # noqa: E712
                    Task.status != "status_done",
                )
            )
        )
        unresolved = result.all()
        return [
            {
                "id": str(row.id),
                "title": row.title,
                "status": row.status,
                "number": str(row.number),
            }
            for row in unresolved
        ]

    async def _validate_no_circular_dependency(
        self,
        task_id: UUID,
        blocked_by_task_ids: list[str],
    ) -> None:
        task_id_str = str(task_id)
        if task_id_str in blocked_by_task_ids:
            raise ValidationError("blocked_by", "A task cannot be blocked by itself")

        visited: set[str] = set()
        queue = list(blocked_by_task_ids)
        depth = 0
        max_depth = 20

        while queue and depth < max_depth:
            depth += 1
            current_ids = [UUID(tid) for tid in queue if tid not in visited]
            if not current_ids:
                break

            for tid_str in queue:
                visited.add(tid_str)

            result = await self.session.execute(
                select(Task.id, Task.blocked_by_task_ids).where(
                    and_(
                        Task.id.in_(current_ids),
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
            )
            rows = result.all()

            queue = []
            for row in rows:
                if row.blocked_by_task_ids:
                    for upstream_id in row.blocked_by_task_ids:
                        if upstream_id == task_id_str:
                            raise ValidationError(
                                "blocked_by",
                                "These tasks already depend on each other. "
                                "Adding this link would create a loop",
                            )
                        if upstream_id not in visited:
                            queue.append(upstream_id)

    async def _validate_no_circular_parent(
        self,
        task_id: UUID | None,
        proposed_parent_id: UUID,
    ) -> None:
        """Reject self-parent, parent cycles, and chains deeper than 5."""
        if task_id is not None and task_id == proposed_parent_id:
            raise ValidationError("parent_id", "A task cannot be its own parent")

        max_depth = 5
        depth = 1
        current: UUID | None = proposed_parent_id
        visited: set[UUID] = set()

        while current is not None:
            if current in visited:
                raise ValidationError(
                    "parent_id", "Parent chain already contains a cycle"
                )
            visited.add(current)

            if depth > max_depth:
                raise ValidationError(
                    "parent_id", f"Maximum nesting depth is {max_depth}"
                )

            result = await self.session.execute(
                select(Task.parent_id).where(
                    and_(
                        Task.id == current,
                        Task.is_deleted == False,  # noqa: E712
                    )
                )
            )
            next_parent = result.scalar_one_or_none()
            if next_parent is None:
                return

            if task_id is not None and next_parent == task_id:
                raise ValidationError(
                    "parent_id",
                    "These tasks already depend on each other. "
                    "Adding this parent would create a loop",
                )

            current = next_parent
            depth += 1

    async def _validate_field_values(
        self,
        project_id: UUID,
        field_values: dict | None,
        task_type: str | None = None,
    ) -> None:
        field_defs = await queries.get_fields_for_project(self.session, project_id)

        type_field_schemas = None
        if task_type:
            result = await self.session.get(Project, project_id)
            if result:
                type_field_schemas = result.type_field_schemas

        errors = validate_field_values(
            field_values or {},
            field_defs,
            task_type=task_type,
            type_field_schemas=type_field_schemas,
        )
        if errors:
            raise ValidationError("field_values", "; ".join(errors))

    async def _resolve_field_option_labels(
        self,
        project_id: UUID,
        status_id: str,
        priority_id: str,
    ) -> dict[str, str]:
        from uniffy.core.models.projects.field_definition import FieldDefinition

        stmt = select(FieldDefinition.id, FieldDefinition.config).where(
            FieldDefinition.project_id == project_id,
            FieldDefinition.id.in_(["field_status", "field_priority"]),
        )
        result = await self.session.execute(stmt)
        resolved: dict[str, str] = {}
        for row in result.all():
            options = (row.config or {}).get("options", [])
            target_id = status_id if row.id == "field_status" else priority_id
            prefix = "status" if row.id == "field_status" else "priority"
            for opt in options:
                if opt.get("id") == target_id:
                    resolved[f"{prefix}_label"] = opt.get("label", "")
                    resolved[f"{prefix}_color"] = opt.get("color", "")
                    break
        return resolved

    async def _expand_assignees_to_users(self, assignee_ids: list[UUID]) -> list[UUID]:
        """Expand any group ids among assignees into active member user ids.

        Assignees can be users or groups (the picker allows both), but only
        users can hold a watcher row or receive a notification.
        """
        if not assignee_ids:
            return []

        group_rows = await self.session.execute(
            select(Group.id).where(Group.id.in_(assignee_ids))
        )
        group_ids = {row[0] for row in group_rows.all()}

        resolved: set[UUID] = {uid for uid in assignee_ids if uid not in group_ids}

        if group_ids:
            member_rows = await self.session.execute(
                select(GroupMember.user_id).where(
                    and_(
                        GroupMember.group_id.in_(group_ids),
                        GroupMember.is_active.is_(True),
                    )
                )
            )
            resolved.update(row[0] for row in member_rows.all())

        return list(resolved)

    async def _emit_assignment_notifications(
        self,
        task: Task,
        actor_id: UUID,
        old_assignee_ids: list[str] | None,
        new_assignee_ids: list[str] | None,
    ) -> None:
        old_set = set(old_assignee_ids or [])
        new_set = set(new_assignee_ids or [])
        added = new_set - old_set

        if not added:
            return

        recipient_ids = await self._expand_assignees_to_users([UUID(uid) for uid in added])
        recipient_ids = [uid for uid in recipient_ids if uid != actor_id]

        if not recipient_ids:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TASK_ASSIGNED,
                organization_id=task.organization_id,
                actor_id=actor_id,
                title=f"Assigned you to: {task.title}",
                source_urn=build_content_urn(ContentType.TASK, task.id),
                target_user_ids=recipient_ids,
            )
        )

    async def _emit_mention_notifications(
        self,
        task: Task,
        actor_id: UUID,
        old_references: list[str] | None,
        new_references: list[str] | None,
    ) -> None:
        old_mentioned = extract_mentioned_user_ids(old_references)
        new_mentioned = extract_mentioned_user_ids(new_references)
        newly_mentioned = new_mentioned - old_mentioned
        newly_mentioned.discard(actor_id)

        source_urn = build_content_urn(ContentType.TASK, task.id)

        if newly_mentioned:
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=task.organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned you in: {task.title}",
                    source_urn=source_urn,
                    target_user_ids=list(newly_mentioned),
                )
            )

        already_mentioned_teams = set(extract_mentioned_team_ids(old_references))
        newly_mentioned_teams = [
            tid
            for tid in extract_mentioned_team_ids(new_references)
            if tid not in already_mentioned_teams
        ]
        if not newly_mentioned_teams:
            return

        notified = {actor_id} | newly_mentioned
        expansions = await expand_team_mentions(
            self.session, task.organization_id, newly_mentioned_teams
        )
        for expansion in expansions:
            targets = [uid for uid in expansion.member_ids if uid not in notified]
            if not targets:
                continue
            await emit_notification(
                NotificationEvent(
                    notification_type=NotificationType.CONTENT_MENTIONED,
                    organization_id=task.organization_id,
                    actor_id=actor_id,
                    title=f"Mentioned {expansion.name} in: {task.title}",
                    source_urn=source_urn,
                    target_user_ids=targets,
                    metadata={
                        "team_id": str(expansion.team_id),
                        "team_name": expansion.name,
                    },
                )
            )
            notified.update(targets)

    async def _emit_watcher_notifications(
        self,
        task: Task,
        actor_id: UUID,
        change_description: str,
    ) -> None:
        watcher_ops = WatcherOperations(self.session)
        watcher_ids = await watcher_ops.get_watcher_user_ids(task.id)
        watcher_ids = [w for w in watcher_ids if w != actor_id]

        if not watcher_ids:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CONTENT_EDITED,
                organization_id=task.organization_id,
                actor_id=actor_id,
                title=f"Task updated: {task.title}",
                body=change_description,
                source_urn=build_content_urn(ContentType.TASK, task.id),
                target_user_ids=watcher_ids,
            )
        )

    async def _log_activity(
        self,
        task_id: UUID,
        actor_id: UUID,
        action: str,
        field_id: str | None = None,
        previous_value: str | None = None,
        new_value: str | None = None,
    ) -> TaskActivity:
        activity = TaskActivity(
            task_id=task_id,
            actor_id=actor_id,
            action=action,
            field_id=field_id,
            previous_value=previous_value,
            new_value=new_value,
        )
        self.session.add(activity)
        await self.session.flush()
        return activity


class SprintOperations:
    """Project-scoped iteration containers; access delegates to the parent project."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _verify_project_manage(
        self, user_id: UUID, organization_id: UUID, project_id: UUID
    ) -> None:
        project_ops = ProjectOperations(self.session)
        project = await project_ops.get_by_id(user_id, organization_id, project_id)
        await project_ops._require_manage(user_id, organization_id, project)

    async def _get_sprint(self, sprint_id: UUID, organization_id: UUID) -> Sprint:
        result = await self.session.execute(
            select(Sprint).where(
                Sprint.id == sprint_id,
                Sprint.organization_id == organization_id,
            )
        )
        sprint = result.scalar_one_or_none()
        if not sprint:
            raise NotFoundError("Sprint", str(sprint_id))
        return sprint

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        name: str,
        goal: str = "",
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Sprint:
        await self._verify_project_manage(user_id, organization_id, project_id)

        max_result = await self.session.execute(
            select(func.max(Sprint.sort_order)).where(
                Sprint.project_id == project_id,
                Sprint.organization_id == organization_id,
            )
        )
        current_max = max_result.scalar() or 0
        new_sort_order = current_max + 1

        sprint = Sprint(
            project_id=project_id,
            organization_id=organization_id,
            name=name,
            goal=goal,
            status="planned",
            start_date=start_date,
            end_date=end_date,
            sort_order=new_sort_order,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        self.session.add(sprint)
        await self.session.commit()
        await self.session.refresh(sprint)
        return sprint

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
        name: str | None = None,
        goal: str | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Sprint:
        """Requires manage on the parent project."""
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        if name is not None:
            sprint.name = name
        if goal is not None:
            sprint.goal = goal
        if start_date is not None:
            sprint.start_date = start_date
        if end_date is not None:
            sprint.end_date = end_date

        sprint.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(sprint)
        return sprint

    async def start(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Sprint:
        """Only one active sprint per project is allowed."""
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        if sprint.status == "active":
            return sprint

        sprint.status = "active"
        if start_date is not None:
            sprint.start_date = start_date
        if end_date is not None:
            sprint.end_date = end_date
        sprint.updated_at = datetime.now(UTC)

        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            raise ValidationError("sprint", "A sprint is already active in this project")

        await self.session.refresh(sprint)
        return sprint

    async def complete(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
    ) -> Sprint:
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        sprint.status = "closed"
        sprint.updated_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(sprint)
        return sprint

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        sprint_id: UUID,
    ) -> bool:
        """Moves tasks back to the backlog."""
        from sqlalchemy import update as sa_update

        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_manage(user_id, organization_id, sprint.project_id)

        await self.session.execute(
            sa_update(Task)
            .where(Task.sprint_id == sprint_id)
            .values(sprint_id=None, updated_at=datetime.now(UTC))
        )

        await self.session.delete(sprint)
        await self.session.commit()
        return True

    async def list_sprints(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        include_closed: bool = False,
    ) -> list[Sprint]:
        project_ops = ProjectOperations(self.session)
        await project_ops.get_by_id(user_id, organization_id, project_id)

        query = select(Sprint).where(
            Sprint.project_id == project_id,
            Sprint.organization_id == organization_id,
        )

        if not include_closed:
            query = query.where(Sprint.status != "closed")

        query = query.order_by(Sprint.sort_order.asc(), Sprint.created_at.asc())

        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_task_counts(self, sprint_ids: list[UUID]) -> dict[str, tuple[int, int]]:
        if not sprint_ids:
            return {}

        result = await self.session.execute(
            select(
                Task.sprint_id,
                func.count(Task.id).label("total"),
                func.count(Task.completed_at).label("completed"),
            )
            .where(
                Task.sprint_id.in_(sprint_ids),
                Task.is_deleted == False,  # noqa: E712
            )
            .group_by(Task.sprint_id)
        )

        counts: dict[str, tuple[int, int]] = {}
        for row in result:
            counts[str(row.sprint_id)] = (row.total, row.completed)
        return counts


class WatcherOperations:
    """Subscribe/unsubscribe to task updates."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def toggle(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
    ) -> tuple[bool, TaskWatcher | None]:
        existing = await self._get_watcher(user_id, task_id)
        if existing:
            await self.session.delete(existing)
            await self.session.commit()
            return False, None

        watcher = TaskWatcher(
            user_id=user_id,
            organization_id=organization_id,
            task_id=task_id,
        )
        self.session.add(watcher)
        await self.session.commit()
        await self.session.refresh(watcher)
        return True, watcher

    async def ensure_watching(
        self,
        user_ids: list[UUID],
        organization_id: UUID,
        task_id: UUID,
    ) -> None:
        """Idempotently subscribe users to a task without committing.

        Used to auto-watch the creator and assignees so they receive
        task-change notifications without having to opt in manually.
        """
        wanted = {uid for uid in user_ids}
        if not wanted:
            return
        # Assignees may include group ids; only real users can watch (FK to login_users).
        valid_rows = await self.session.execute(select(User.id).where(User.id.in_(wanted)))
        valid_ids = {row[0] for row in valid_rows.all()}
        if not valid_ids:
            return
        now = datetime.now(UTC)
        await self.session.execute(
            pg_insert(TaskWatcher)
            .values(
                [
                    {
                        "id": generate_id(),
                        "user_id": uid,
                        "organization_id": organization_id,
                        "task_id": task_id,
                        "created_at": now,
                    }
                    for uid in valid_ids
                ]
            )
            .on_conflict_do_nothing(constraint="uq_task_watchers_user_task")
        )

    async def is_watching(self, user_id: UUID, task_id: UUID) -> bool:
        watcher = await self._get_watcher(user_id, task_id)
        return watcher is not None

    async def get_watcher_user_ids(self, task_id: UUID) -> list[UUID]:
        result = await self.session.execute(
            select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)
        )
        return [row[0] for row in result.all()]

    async def get_watcher_count(self, task_id: UUID) -> int:
        result = await self.session.execute(
            select(func.count()).where(TaskWatcher.task_id == task_id)
        )
        return result.scalar_one()

    async def bulk_check(self, user_id: UUID, task_ids: list[str]) -> dict[str, bool]:
        if not task_ids:
            return {}

        uuids = [UUID(tid) for tid in task_ids]
        result = await self.session.execute(
            select(TaskWatcher.task_id).where(
                and_(
                    TaskWatcher.user_id == user_id,
                    TaskWatcher.task_id.in_(uuids),
                )
            )
        )
        watched = {str(row[0]) for row in result.all()}
        return {tid: tid in watched for tid in task_ids}

    async def _get_watcher(self, user_id: UUID, task_id: UUID) -> TaskWatcher | None:
        result = await self.session.execute(
            select(TaskWatcher).where(
                and_(
                    TaskWatcher.user_id == user_id,
                    TaskWatcher.task_id == task_id,
                )
            )
        )
        return result.scalar_one_or_none()


async def _load_project(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Project | None:
    result = await session.execute(
        select(Project).where(
            Project.id == content_id,
            Project.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def _load_task(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Task | None:
    result = await session.execute(
        select(Task).where(
            Task.id == content_id,
            Task.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.PROJECT, _load_project)
register_content_loader(ContentType.TASK, _load_task)


async def _project_attachment_cascade(
    session: AsyncSession,
    organization_id: UUID,
    project_id: UUID,
) -> list[tuple[ContentType, UUID]]:
    rows = (
        await session.execute(
            select(Task.id).where(
                Task.project_id == project_id,
                Task.organization_id == organization_id,
                Task.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    return [(ContentType.TASK, task_id) for task_id in rows]


register_attachment_cascade_loader(ContentType.PROJECT, _project_attachment_cascade)
