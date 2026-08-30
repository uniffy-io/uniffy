"""Task creation workflow."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import and_, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.defaults import (
    resolve_content_defaults,
    resolve_effective_policy,
)
from uniffy.core.converters.common_proto import content_type_to_proto
from uniffy.core.models.projects.field_definition import (
    TaskStatusSemantic,
)
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import (
    AccessMode,
    ContentType,
)
from uniffy.core.valkey import ContentAccessAction, publish_content_access_changed
from uniffy.domains.permissions.access import ResourceAudienceResolver
from uniffy.domains.projects import queries
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.statuses import (
    load_task_status_semantics,
)
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.projects.tasks.validation import TaskValidator
from uniffy.domains.projects.watchers import WatcherOperations

logger = logger.bind(component="projects.tasks.creation")


class TaskCreateOperations:
    def __init__(self, session: AsyncSession, content: TaskContentOperations) -> None:
        self.session = session
        self.content = content

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
        project_ops = ProjectOperations(
            self.session,
            search_indexer=self.content.search_indexer,
        )
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

        await TaskValidator(self.session).validate_field_values(
            project_id, kwargs.get("field_values"), task_type=task_type
        )

        parent_id = kwargs.get("parent_id")
        if parent_id is not None:
            if isinstance(parent_id, str):
                parent_id = UUID(parent_id)
            await TaskValidator(self.session).validate_no_circular_parent(None, parent_id)

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

        status_semantics = await load_task_status_semantics(self.session, project_id)
        initial_status = kwargs.get("status") or status_semantics.id_for(TaskStatusSemantic.TODO)

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
            estimated_minutes=kwargs.get("estimated_minutes"),
            time_spent_minutes=kwargs.get("time_spent_minutes"),
            completed_at=(
                datetime.now(UTC) if status_semantics.is_completed(initial_status) else None
            ),
        )
        self.session.add(task)
        await self.session.flush()
        await self.session.refresh(task)

        await TaskNotifications(self.session).log_activity(task.id, user_id, "created")

        watcher_user_ids = [user_id]
        if task.assignee_ids:
            watcher_user_ids += await TaskNotifications(self.session).expand_assignees_to_users([
                UUID(uid) for uid in task.assignee_ids
            ])
        await WatcherOperations(self.session).ensure_watching(
            watcher_user_ids, organization_id, task.id
        )

        await self.session.commit()
        await self.session.refresh(task)

        await self.content._sync_task_tags(actor_id=user_id, task=task, tag_ids=tag_ids)

        await self.content._index_for_search(task)

        await TaskNotifications(self.session).emit_assignment_notifications(
            task, user_id, None, task.assignee_ids
        )
        await TaskNotifications(self.session).emit_mention_notifications(
            task, user_id, None, task.outgoing_references
        )

        audience = await self._resolve_project_audience(organization_id, project)
        await publish_content_access_changed(
            content_type=content_type_to_proto(ContentType.PROJECT),
            content_id=project_id,
            action=ContentAccessAction.CHILD_ADDED,
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
            self.session,
            organization_id,
            ContentType.PROJECT,
        )
        effective_mode, _ = resolve_effective_policy(
            project.access_mode,
            project.baseline_role,
            default_mode,
            default_baseline,
        )
        if effective_mode == AccessMode.OPEN_TO_ORG:
            return None

        return await ResourceAudienceResolver(self.session).standard_audience(
            organization_id=organization_id,
            content_type=ContentType.PROJECT,
            content_id=project.id,
            owner_id=project.owner_id,
            access_mode=project.access_mode,
            baseline_role=project.baseline_role,
        )
