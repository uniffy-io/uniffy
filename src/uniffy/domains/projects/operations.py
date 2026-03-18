"""
Projects operations extending BaseContentOperations.

Provides CRUD operations for projects and tasks with automatic permission
checking and search indexing.
"""

import re
import secrets
from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, func, select, text
from sqlalchemy import update as sql_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.events import NotificationEvent, emit_notification, extract_mentioned_user_ids
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.shared import ContentType, NotificationType, VisibilityScope
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.domains.projects import queries
from uniffy.domains.projects.validation import validate_field_values


class ProjectOperations(BaseContentOperations[Project]):
    """
    Project CRUD operations with permissions and search.

    Extends BaseContentOperations to provide project-specific functionality
    including default field/view creation and member management.
    """

    content_type = ContentType.PROJECT
    model_class = Project

    def __init__(self, session: AsyncSession) -> None:
        """Initialize project operations."""
        super().__init__(session)

    # Required abstract method implementations

    def _build_search_keywords(self, model: Project) -> str:
        """Build search keywords from project name and description."""
        parts = [model.name]
        if model.description:
            parts.append(model.description)
        return " ".join(parts)

    def _get_search_title(self, model: Project) -> str:
        """Get project name for search."""
        return model.name

    def _get_url_path(self, model: Project) -> str:
        """Get URL path for project."""
        return f"/projects/{model.id}"

    def _get_search_description(self, model: Project) -> str | None:
        """Get search description from project description."""
        if model.description:
            return model.description[:200]
        return None

    # Core CRUD operations

    def _generate_slug_candidate(self, name: str) -> str:
        """
        Generate an uppercase slug candidate from a project name.

        Uses word initials for multi-word names, or first 3 chars
        of cleaned name for single-word names. Ensures at least 2 chars.

        Parameters
        ----------
        name : str
            Project name to derive slug from.

        Returns
        -------
        str
            Uppercase slug candidate (2-5 chars).

        """
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
        """
        Resolve a unique slug for a project within an organization.

        If a slug is requested and valid, uses it (or appends a digit
        suffix on collision). Otherwise, auto-generates from name.

        Parameters
        ----------
        organization_id : UUID
            Organization ID (slugs are unique per org).
        name : str
            Project name (used if no slug is requested).
        requested_slug : str | None
            Explicitly requested slug (optional).

        Returns
        -------
        str
            Unique uppercase slug.

        Raises
        ------
        ValidationError
            If the requested slug fails pattern validation.

        """
        SLUG_PATTERN = re.compile(r"^[A-Z][A-Z0-9]{1,4}$")
        candidate = requested_slug.upper() if requested_slug else self._generate_slug_candidate(name)
        if not SLUG_PATTERN.match(candidate):
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
        # Last resort: append random hex
        return candidate[:4] + secrets.token_hex(1).upper()

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        description: str = "",
        icon: str = "folder",
        color: str = "#3b82f6",
        visibility: VisibilityScope = VisibilityScope.PRIVATE,
        group_ids: list[UUID] | None = None,
        slug: str | None = None,
    ) -> Project:
        """
        Create a project with default fields, views, and the owner as member.

        Parameters
        ----------
        user_id : UUID
            Owner user ID.
        organization_id : UUID
            Organization ID.
        name : str
            Project name.
        description : str
            Project description.
        icon : str
            Icon identifier.
        color : str
            Hex color code.
        visibility : VisibilityScope
            Access scope.
        group_ids : list[UUID] | None
            Groups to share with (for GROUP visibility).
        slug : str | None
            Optional explicit slug. Auto-generated from name if not provided.

        Returns
        -------
        Project
            Created project with default fields and views.

        """
        resolved_slug = await self._resolve_slug(organization_id, name, slug)
        project = Project(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            description=description,
            icon=icon,
            color=color,
            visibility=visibility,
            member_ids=[str(user_id)],
            slug=resolved_slug,
            task_counter=0,
        )
        self.session.add(project)
        await self.session.flush()
        await self.session.refresh(project)

        # Create default field definitions
        await self._create_default_fields(project.id)

        # Create default views
        default_view_id = await self._create_default_views(project.id)
        project.default_view_id = default_view_id

        # Handle group visibility
        if visibility == VisibilityScope.GROUP and group_ids:
            await self._create_group_links(project.id, group_ids, user_id, organization_id)

        await self.session.commit()
        await self.session.refresh(project)

        # Index for search
        await self._index_for_search(project, group_ids)

        return project

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        **kwargs,
    ) -> Project:
        """
        Update project fields. Requires EDIT permission.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Project to update.
        **kwargs
            Fields to update (name, description, icon, color,
            visibility, member_ids, default_view_id).

        Returns
        -------
        Project
            Updated project.

        """
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_edit(user_id, organization_id, project)

        old_visibility = project.visibility

        for key, value in kwargs.items():
            if value is not None and hasattr(project, key):
                setattr(project, key, value)

        project.version += 1
        project.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(project)

        # Re-index
        group_ids = await self._get_content_group_ids(project.id)
        await self._index_for_search(project, group_ids)

        # Propagate visibility change to all tasks in the project
        if "visibility" in kwargs and kwargs["visibility"] != old_visibility:
            await self._propagate_visibility_to_tasks(
                project_id, organization_id, kwargs["visibility"], group_ids
            )

        return project

    async def _propagate_visibility_to_tasks(
        self,
        project_id: UUID,
        organization_id: UUID,
        new_visibility: VisibilityScope,
        group_ids: list[UUID] | None,
    ) -> None:
        """
        Propagate visibility changes from a project to all its tasks.

        Updates visibility on all non-deleted tasks and re-indexes them for search.

        Parameters
        ----------
        project_id : UUID
            Project whose tasks to update.
        organization_id : UUID
            Organization ID.
        new_visibility : VisibilityScope
            New visibility to set on tasks.
        group_ids : list[UUID] | None
            Group IDs for search indexing.

        """
        await self.session.execute(
            sql_update(Task)
            .where(Task.project_id == project_id)
            .where(Task.organization_id == organization_id)
            .values(visibility=new_visibility)
        )
        await self.session.commit()

        # Re-index all non-deleted tasks
        result = await self.session.execute(
            select(Task).where(
                and_(
                    Task.project_id == project_id,
                    Task.organization_id == organization_id,
                    Task.is_deleted == False,  # noqa: E712
                )
            )
        )
        task_ops = TaskOperations(self.session)
        for task in result.scalars().all():
            await task_ops._index_for_search(task, group_ids)

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """
        Soft or permanent delete. Also deletes all tasks, fields, views, activities.

        Parameters
        ----------
        user_id : UUID
            User performing delete.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Project to delete.
        permanent : bool
            If True, permanently delete. Otherwise soft delete.

        Returns
        -------
        bool
            True if deleted successfully.

        """
        project = await self.get_by_id(user_id, organization_id, project_id)
        await self._require_delete(user_id, organization_id, project)

        if permanent:
            # Delete all related records
            await queries.delete_project_cascade(self.session, project_id)
            await self.session.delete(project)
        else:
            project.is_deleted = True
            project.deleted_at = datetime.now(UTC)

        await self.session.commit()
        await self.search_indexer.remove(project.urn, organization_id)
        return True

    async def list_projects(
        self,
        user_id: UUID,
        organization_id: UUID,
        visibility: VisibilityScope | None = None,
        include_deleted: bool = False,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Project], int]:
        """
        List projects accessible to the user.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        visibility : VisibilityScope | None
            Filter by visibility.
        include_deleted : bool
            Include soft-deleted projects.
        page : int
            Page number.
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[Project], int]
            List of projects and total count.

        """
        # Build base query with access filter
        query = select(Project).where(Project.organization_id == organization_id)

        # Apply access filter using ContentAccessQuery
        access_filter = self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Project.id,
            owner_id_column=Project.owner_id,
            visibility_column=Project.visibility,
        )
        query = query.where(access_filter)

        if visibility:
            query = query.where(Project.visibility == visibility)

        if not include_deleted:
            query = query.where(Project.is_deleted == False)  # noqa: E712

        # Count
        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        # Paginate and sort
        query = query.order_by(Project.updated_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        projects = list(result.scalars().all())

        return projects, total

    # Helper methods for default data creation

    async def _create_default_fields(self, project_id: UUID) -> None:
        """
        Create default system fields for a new project.

        Creates: title, status, priority, assignee, start_date, due_date.
        """
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
        """
        Create default views for a new project.

        Creates: table (default), board, roadmap.

        Returns
        -------
        str
            ID of the default view ("view_table").

        """
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
    """
    Task CRUD operations with permissions and search.

    Tasks inherit permissions from their parent project.
    """

    content_type = ContentType.TASK
    model_class = Task

    def __init__(self, session: AsyncSession) -> None:
        """Initialize task operations."""
        super().__init__(session)

    # Required abstract method implementations

    def _build_search_keywords(self, model: Task) -> str:
        """Build search keywords from task title and description."""
        parts = [model.title]
        if model.description:
            parts.append(model.description)
        return " ".join(parts)

    def _get_search_title(self, model: Task) -> str:
        """Get task title for search."""
        return model.title

    def _get_url_path(self, model: Task) -> str:
        """Get URL path for task."""
        return f"/projects/{model.project_id}/tasks/{model.id}"

    def _get_search_description(self, model: Task) -> str | None:
        """Get search description from task description."""
        if model.description:
            return model.description[:200]
        return None

    # Core CRUD operations

    async def create(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        title: str,
        task_type: str = "task",
        **kwargs,
    ) -> Task:
        """
        Create a task. Requires EDIT permission on the project.

        Parameters
        ----------
        user_id : UUID
            User creating task.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Parent project ID.
        title : str
            Task title.
        task_type : str
            Issue type (task, bug, feature, story, epic).
        **kwargs
            Optional fields (description, status, priority, assignee_ids,
            dates, parent_id, field_values, etc.).

        Returns
        -------
        Task
            Created task.

        """
        # Verify project access
        project_ops = ProjectOperations(self.session)
        project = await project_ops.get_by_id(user_id, organization_id, project_id)
        await project_ops._require_edit(user_id, organization_id, project)

        # Atomically increment task_counter and get the new number
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

        # Validate custom field values
        if kwargs.get("field_values"):
            await self._validate_field_values(project_id, kwargs["field_values"])

        # Validate blocked_by for circular dependencies
        if kwargs.get("blocked_by_task_ids"):
            # No circular check needed on create since the task doesn't exist yet

            pass

        # Extract references from description
        description = kwargs.get("description", "")
        outgoing_references = queries.extract_urns_from_content(description) if description else []

        # Calculate sort order (append to end)
        from sqlalchemy import func

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
        new_sort_order = current_max + 65536  # Large gap for future insertions

        task = Task(
            project_id=project_id,
            organization_id=organization_id,
            owner_id=user_id,
            visibility=project.visibility,
            title=title,
            description=description,
            status=kwargs.get("status", "status_todo"),
            priority=kwargs.get("priority", "priority_medium"),
            assignee_ids=kwargs.get("assignee_ids"),
            start_date=kwargs.get("start_date"),
            due_date=kwargs.get("due_date"),
            parent_id=kwargs.get("parent_id"),
            blocked_by_task_ids=kwargs.get("blocked_by_task_ids"),
            is_milestone=kwargs.get("is_milestone", False),
            recurrence_rule=kwargs.get("recurrence_rule"),
            sort_order=kwargs.get("sort_order", new_sort_order),
            field_values=kwargs.get("field_values"),
            outgoing_references=outgoing_references or None,
            created_at=datetime.now(UTC),  # Ensure created_at is consistent
            number=task_number,
            task_type=task_type,
            sprint_id=kwargs.get("sprint_id"),
        )
        self.session.add(task)
        await self.session.flush()
        await self.session.refresh(task)

        # Log activity
        await self._log_activity(task.id, user_id, "created")

        await self.session.commit()
        await self.session.refresh(task)

        # Index for search
        group_ids = await project_ops._get_content_group_ids(project_id)
        await self._index_for_search(task, group_ids)

        # Emit notifications for assignments
        await self._emit_assignment_notifications(task, user_id, None, task.assignee_ids)

        # Emit notifications for @mentions in description
        await self._emit_mention_notifications(task, user_id, None, task.outgoing_references)

        return task

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        **kwargs,
    ) -> Task:
        """
        Update task fields. Logs relevant activities.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        task_id : UUID
            Task to update.
        **kwargs
            Fields to update.

        Returns
        -------
        Task
            Updated task.

        """
        task = await self.get_by_id(user_id, organization_id, task_id)
        await self._require_edit(user_id, organization_id, task)

        # Dependency enforcement: cannot complete task with unresolved blockers
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

        # Circular dependency validation
        if "blocked_by_task_ids" in kwargs and kwargs["blocked_by_task_ids"]:
            await self._validate_no_circular_dependency(task_id, kwargs["blocked_by_task_ids"])

        # Custom field validation
        if kwargs.get("field_values"):
            await self._validate_field_values(task.project_id, kwargs["field_values"])

        # Snapshot for notification comparison
        old_assignee_ids = list(task.assignee_ids) if task.assignee_ids else None
        old_references = list(task.outgoing_references) if task.outgoing_references else None

        title_changed = "title" in kwargs and kwargs["title"] != task.title

        # Snapshot fields that trigger mention state publishing
        old_status = task.status
        old_due_date = task.due_date
        old_assignee_ids = list(task.assignee_ids) if task.assignee_ids else []
        old_title = task.title

        # Fields that can be explicitly set to None (cleared)
        nullable_fields = {
            "start_date",
            "due_date",
            "description",
            "parent_id",
            "recurrence_rule",
            "sprint_id",
        }

        # Track changes for activity log
        for key, value in kwargs.items():
            if not hasattr(task, key):
                continue
            if value is None and key not in nullable_fields:
                continue
            old_value = getattr(task, key)

            # Merge field_values instead of replacing
            if key == "field_values" and isinstance(value, dict):
                merged = dict(task.field_values or {})
                merged.update(value)
                setattr(task, key, merged)
            else:
                setattr(task, key, value)

            # Log specific changes
            if key == "status" and old_value != value:
                # Auto-set completed_at when moving to done status
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

        # Re-extract references if description changed
        if "description" in kwargs:
            task.outgoing_references = queries.extract_urns_from_content(task.description) or None

        task.version += 1
        task.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(task)

        # Re-index
        project_ops = ProjectOperations(self.session)
        group_ids = await project_ops._get_content_group_ids(task.project_id)
        await self._index_for_search(task, group_ids)

        # Emit notifications for assignment changes
        await self._emit_assignment_notifications(
            task, user_id, old_assignee_ids, task.assignee_ids
        )

        # Emit notifications for new @mentions
        await self._emit_mention_notifications(
            task, user_id, old_references, task.outgoing_references
        )

        # Propagate title change to mention labels in referencing content
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
                logger.warning(
                    "Failed to propagate task rename to mentions",
                    task_id=str(task_id),
                    exc_info=True,
                )

        # Publish mention state changes for real-time mention updates
        mention_changes: dict[str, str] = {}
        if task.status != old_status:
            mention_changes["status"] = task.status
        if task.title != old_title:
            mention_changes["title"] = task.title
        if task.due_date != old_due_date:
            mention_changes["due_date"] = task.due_date or ""
        current_assignee_ids = list(task.assignee_ids) if task.assignee_ids else []
        if current_assignee_ids != old_assignee_ids:
            mention_changes["assignee_ids"] = ",".join(current_assignee_ids)

        if mention_changes:
            try:
                await publish_mention_state(
                    organization_id=organization_id,
                    urn=task.urn,
                    changes=mention_changes,
                )
            except Exception:
                logger.warning(
                    "Failed to publish task mention state change",
                    task_id=str(task_id),
                    exc_info=True,
                )

        return task

    async def move(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        status: str,
        sort_order: int,
    ) -> Task:
        """
        Move task to new status/position (board drag-and-drop).

        Parameters
        ----------
        user_id : UUID
            User performing move.
        organization_id : UUID
            Organization ID.
        task_id : UUID
            Task to move.
        status : str
            New status.
        sort_order : int
            New sort order.

        Returns
        -------
        Task
            Updated task.

        """
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
        """
        Update multiple tasks at once.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        task_ids : list[str]
            Task IDs to update.
        **changes
            Fields to update on all tasks.

        Returns
        -------
        list[Task]
            Updated tasks.

        """
        updated = []
        for task_id in task_ids:
            task = await self.update(user_id, organization_id, UUID(task_id), **changes)
            updated.append(task)
        return updated

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        permanent: bool = False,
    ) -> bool:
        """
        Soft or permanent delete a task.

        Parameters
        ----------
        user_id : UUID
            User performing delete.
        organization_id : UUID
            Organization ID.
        task_id : UUID
            Task to delete.
        permanent : bool
            If True, permanently delete. Otherwise soft delete.

        Returns
        -------
        bool
            True if deleted successfully.

        """
        task = await self.get_by_id(user_id, organization_id, task_id)
        await self._require_delete(user_id, organization_id, task)

        if permanent:
            # Delete activities
            await self.session.execute(delete(TaskActivity).where(TaskActivity.task_id == task_id))
            await self.session.delete(task)
        else:
            task.is_deleted = True
            task.deleted_at = datetime.now(UTC)

        await self.session.commit()
        await self.search_indexer.remove(task.urn, organization_id)
        return True

    async def list_tasks(
        self,
        user_id: UUID,
        organization_id: UUID,
        project_id: UUID,
        include_deleted: bool = False,
        parent_id: UUID | str | None = None,
        sprint_id: UUID | None = None,
        backlog_only: bool = False,
        page: int = 1,
        page_size: int = 500,
    ) -> tuple[list[Task], int]:
        """
        List tasks for a project.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Project ID.
        include_deleted : bool
            Include soft-deleted tasks.
        parent_id : UUID | str | None
            Parent filter (None=all, "root"=top level, UUID=specific parent).
        sprint_id : UUID | None
            Filter by sprint ID.
        backlog_only : bool
            If True, only return tasks with no sprint assigned.
        page : int
            Page number.
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[Task], int]
            List of tasks and total count.

        """
        # Verify user has access to the project
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

        if parent_id == "root":
            query = query.where(Task.parent_id.is_(None))
        elif parent_id:
            query = query.where(Task.parent_id == parent_id)

        if sprint_id is not None:
            query = query.where(Task.sprint_id == sprint_id)
        elif backlog_only:
            query = query.where(Task.sprint_id.is_(None))

        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        query = query.order_by(Task.sort_order.asc(), Task.created_at.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

    async def _check_blockers_resolved(
        self,
        task: Task,
        new_status: str,
    ) -> list[dict[str, str]]:
        """
        Check if all blocking tasks are completed.

        Only enforced when moving to a completion status ('status_done').

        Parameters
        ----------
        task : Task
            Task being updated.
        new_status : str
            Target status.

        Returns
        -------
        list[dict[str, str]]
            Unresolved blockers with id, title, and status. Empty if all resolved.

        """
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
            {"id": str(row.id), "title": row.title, "status": row.status, "number": str(row.number)}
            for row in unresolved
        ]

    async def _validate_no_circular_dependency(
        self,
        task_id: UUID,
        blocked_by_task_ids: list[str],
    ) -> None:
        """
        Validate that adding dependencies does not create a cycle.

        Uses BFS traversal through blocked_by chains (max depth 20).

        Parameters
        ----------
        task_id : UUID
            The task being updated.
        blocked_by_task_ids : list[str]
            Proposed blocker task IDs.

        Raises
        ------
        ValidationError
            If a circular dependency would be created.

        """
        task_id_str = str(task_id)
        if task_id_str in blocked_by_task_ids:
            raise ValidationError("blocked_by", "A task cannot be blocked by itself")

        # BFS: check if any blocker eventually depends on this task
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

    async def _validate_field_values(
        self,
        project_id: UUID,
        field_values: dict,
    ) -> None:
        """
        Validate custom field values against project field definitions.

        Parameters
        ----------
        project_id : UUID
            Project ID.
        field_values : dict
            Field values to validate.

        Raises
        ------
        ValidationError
            If any field values are invalid.

        """
        if not field_values:
            return

        field_defs = await queries.get_fields_for_project(self.session, project_id)
        errors = validate_field_values(field_values, field_defs)
        if errors:
            raise ValidationError("field_values", "; ".join(errors))

    async def _emit_assignment_notifications(
        self,
        task: Task,
        actor_id: UUID,
        old_assignee_ids: list[str] | None,
        new_assignee_ids: list[str] | None,
    ) -> None:
        """
        Emit TASK_ASSIGNED notifications for newly added assignees.

        Parameters
        ----------
        task : Task
            The task being updated.
        actor_id : UUID
            User who made the change.
        old_assignee_ids : list[str] | None
            Previous assignee IDs.
        new_assignee_ids : list[str] | None
            New assignee IDs.

        """
        old_set = set(old_assignee_ids or [])
        new_set = set(new_assignee_ids or [])
        added = new_set - old_set
        # Don't notify the actor
        added.discard(str(actor_id))

        if not added:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.TASK_ASSIGNED,
                organization_id=task.organization_id,
                actor_id=actor_id,
                title=f"Assigned you to: {task.title}",
                source_urn=build_content_urn(ContentType.TASK, task.id),
                target_user_ids=[UUID(uid) for uid in added],
            )
        )

    async def _emit_mention_notifications(
        self,
        task: Task,
        actor_id: UUID,
        old_references: list[str] | None,
        new_references: list[str] | None,
    ) -> None:
        """
        Emit CONTENT_MENTIONED notifications for newly mentioned users.

        Parameters
        ----------
        task : Task
            The task.
        actor_id : UUID
            User who made the change.
        old_references : list[str] | None
            Previous outgoing URN references.
        new_references : list[str] | None
            New outgoing URN references.

        """
        old_mentioned = extract_mentioned_user_ids(old_references)
        new_mentioned = extract_mentioned_user_ids(new_references)
        newly_mentioned = new_mentioned - old_mentioned
        newly_mentioned.discard(actor_id)

        if not newly_mentioned:
            return

        await emit_notification(
            NotificationEvent(
                notification_type=NotificationType.CONTENT_MENTIONED,
                organization_id=task.organization_id,
                actor_id=actor_id,
                title=f"Mentioned you in: {task.title}",
                source_urn=build_content_urn(ContentType.TASK, task.id),
                target_user_ids=list(newly_mentioned),
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
        """
        Record a task activity entry.

        Parameters
        ----------
        task_id : UUID
            Task ID.
        actor_id : UUID
            User who performed the action.
        action : str
            Action type.
        field_id : str | None
            Field that was changed (optional).
        previous_value : str | None
            Previous value (optional).
        new_value : str | None
            New value (optional).

        Returns
        -------
        TaskActivity
            Created activity entry.

        """
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
    """
    Sprint CRUD operations for project sprints.

    Sprints are project-scoped iteration containers, not full content items,
    so they do not extend BaseContentOperations.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize sprint operations."""
        self.session = session

    async def _verify_project_edit(
        self, user_id: UUID, organization_id: UUID, project_id: UUID
    ) -> None:
        """
        Verify user has EDIT permission on the project.

        Parameters
        ----------
        user_id : UUID
            User requesting access.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Project to check access on.

        Raises
        ------
        NotFoundError
            If the project does not exist.
        PermissionDeniedError
            If the user lacks EDIT permission.

        """
        project_ops = ProjectOperations(self.session)
        project = await project_ops.get_by_id(user_id, organization_id, project_id)
        await project_ops._require_edit(user_id, organization_id, project)

    async def _get_sprint(self, sprint_id: UUID, organization_id: UUID) -> Sprint:
        """
        Fetch a sprint by ID within an organization.

        Parameters
        ----------
        sprint_id : UUID
            Sprint ID.
        organization_id : UUID
            Organization ID.

        Returns
        -------
        Sprint
            The sprint model.

        Raises
        ------
        NotFoundError
            If the sprint does not exist.

        """
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
        """
        Create a new sprint in the project.

        Parameters
        ----------
        user_id : UUID
            User creating the sprint.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Project ID.
        name : str
            Sprint name.
        goal : str
            Sprint goal description.
        start_date : str | None
            Optional ISO date string for sprint start.
        end_date : str | None
            Optional ISO date string for sprint end.

        Returns
        -------
        Sprint
            Created sprint.

        """
        await self._verify_project_edit(user_id, organization_id, project_id)

        # Get next sort_order
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
        """
        Update sprint fields. Requires EDIT on project.

        Parameters
        ----------
        user_id : UUID
            User performing update.
        organization_id : UUID
            Organization ID.
        sprint_id : UUID
            Sprint to update.
        name : str | None
            New sprint name.
        goal : str | None
            New sprint goal.
        start_date : str | None
            New start date ISO string.
        end_date : str | None
            New end date ISO string.

        Returns
        -------
        Sprint
            Updated sprint.

        """
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_edit(user_id, organization_id, sprint.project_id)

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
        """
        Activate a sprint. Only one active sprint per project is allowed.

        Parameters
        ----------
        user_id : UUID
            User performing the action.
        organization_id : UUID
            Organization ID.
        sprint_id : UUID
            Sprint to start.
        start_date : str | None
            Optional override for start date.
        end_date : str | None
            Optional override for end date.

        Returns
        -------
        Sprint
            Activated sprint.

        Raises
        ------
        ValidationError
            If another sprint is already active in the project.

        """
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_edit(user_id, organization_id, sprint.project_id)

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
        """
        Mark a sprint as closed.

        Parameters
        ----------
        user_id : UUID
            User performing the action.
        organization_id : UUID
            Organization ID.
        sprint_id : UUID
            Sprint to complete.

        Returns
        -------
        Sprint
            Closed sprint.

        """
        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_edit(user_id, organization_id, sprint.project_id)

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
        """
        Delete a sprint, moving its tasks to backlog (sprint_id = NULL).

        Parameters
        ----------
        user_id : UUID
            User performing the action.
        organization_id : UUID
            Organization ID.
        sprint_id : UUID
            Sprint to delete.

        Returns
        -------
        bool
            True if deleted successfully.

        """
        from sqlalchemy import update as sa_update

        sprint = await self._get_sprint(sprint_id, organization_id)
        await self._verify_project_edit(user_id, organization_id, sprint.project_id)

        # Move sprint tasks to backlog
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
        """
        List sprints for a project.

        Parameters
        ----------
        user_id : UUID
            User requesting list.
        organization_id : UUID
            Organization ID.
        project_id : UUID
            Project ID.
        include_closed : bool
            Whether to include closed sprints.

        Returns
        -------
        list[Sprint]
            List of sprints ordered by sort_order.

        """
        # Verify project access
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
        """
        Get total and completed task counts for a list of sprints.

        Parameters
        ----------
        sprint_ids : list[UUID]
            Sprint IDs to query.

        Returns
        -------
        dict[str, tuple[int, int]]
            Mapping of sprint_id string to (total, completed) counts.

        """
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
