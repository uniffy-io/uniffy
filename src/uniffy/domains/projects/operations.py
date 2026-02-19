"""
Projects operations extending BaseContentOperations.

Provides CRUD operations for projects and tasks with automatic permission
checking and search indexing.
"""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.cascade import propagate_rename
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import FieldDefinition
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.view_config import ViewConfig
from uniffy.core.models.shared import ContentType, VisibilityScope
from uniffy.core.search.indexer import build_content_urn
from uniffy.domains.projects import queries


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

        Returns
        -------
        Project
            Created project with default fields and views.

        """
        project = Project(
            organization_id=organization_id,
            owner_id=user_id,
            name=name,
            description=description,
            icon=icon,
            color=color,
            visibility=visibility,
            member_ids=[str(user_id)],
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

        return project

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
        return f"/projects/{model.project_id}?task={model.id}"

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

        title_changed = "title" in kwargs and kwargs["title"] != task.title

        # Fields that can be explicitly set to None (cleared)
        nullable_fields = {"start_date", "due_date", "description", "parent_id", "recurrence_rule"}

        # Track changes for activity log
        for key, value in kwargs.items():
            if not hasattr(task, key):
                continue
            if value is None and key not in nullable_fields:
                continue
            old_value = getattr(task, key)
            setattr(task, key, value)

            # Log specific changes
            if key == "status" and old_value != value:
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

        count_result = await self.session.execute(select(func.count()).select_from(query.subquery()))
        total = count_result.scalar_one()

        query = query.order_by(Task.sort_order.asc(), Task.created_at.asc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        tasks = list(result.scalars().all())

        return tasks, total

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
