"""Task update and deletion workflows."""

from datetime import UTC, datetime
from uuid import UUID

from loguru import logger
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.errors import ValidationError
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import (
    SystemProjectFieldId,
    TaskStatusSemantic,
)
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import (
    ContentType,
)
from uniffy.domains.files.attachments.purge import purge_attachments_for_content
from uniffy.domains.projects import queries
from uniffy.domains.projects.statuses import (
    load_task_status_semantics,
)
from uniffy.domains.projects.tasks.content import TaskContentOperations
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.projects.tasks.recurrence import spawn_next_recurring_instance
from uniffy.domains.projects.tasks.validation import TaskValidator
from uniffy.domains.projects.watchers import WatcherOperations
from uniffy.domains.search.rename import propagate_rename
from uniffy.domains.tags.operations import TagOperations

logger = logger.bind(component="projects.tasks.mutations")


class TaskMutationOperations:
    def __init__(self, session: AsyncSession, content: TaskContentOperations) -> None:
        self.session = session
        self.content = content

    async def update(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        **kwargs,
    ) -> tuple[Task, Task | None]:
        task = await self.content.get_by_id(user_id, organization_id, task_id)
        await self.content._require_edit(user_id, organization_id, task)

        tag_ids = kwargs.pop("tag_ids", None)
        status_semantics = await load_task_status_semantics(self.session, task.project_id)
        old_status_completed = status_semantics.is_completed(task.status)
        proposed_status = kwargs.get("status", task.status)
        new_status_completed = status_semantics.is_completed(proposed_status)

        if "status" in kwargs and kwargs["status"] != task.status:  # noqa: PLR2004
            unresolved = await TaskValidator(self.session).blockers_resolved(
                task, new_status_completed
            )
            if unresolved:
                blocker_names = [f"#{b['number']} {b['title']}" for b in unresolved[:5]]
                suffix = f" and {len(unresolved) - 5} more" if len(unresolved) > 5 else ""
                raise ValidationError(
                    "status",
                    "Cannot complete task: blocked by unresolved tasks: "
                    f"{', '.join(blocker_names)}{suffix}",
                )

        if "blocked_by_task_ids" in kwargs and kwargs["blocked_by_task_ids"]:  # noqa: PLR2004
            await TaskValidator(self.session).validate_no_circular_dependency(
                task_id, kwargs["blocked_by_task_ids"]
            )

        if "parent_id" in kwargs and kwargs["parent_id"] is not None:  # noqa: PLR2004
            proposed_parent = kwargs["parent_id"]
            if isinstance(proposed_parent, str):
                proposed_parent = UUID(proposed_parent)
            if proposed_parent != task.parent_id:
                await TaskValidator(self.session).validate_no_circular_parent(
                    task_id, proposed_parent
                )
                kwargs["parent_id"] = proposed_parent

        if kwargs.get("field_values") or kwargs.get("task_type"):
            effective_type = kwargs.get("task_type", task.task_type)
            merged_values = dict(task.field_values or {})
            if kwargs.get("field_values"):
                merged_values.update(kwargs["field_values"])
            await TaskValidator(self.session).validate_field_values(
                task.project_id,
                merged_values,
                task_type=effective_type,
            )

        old_references = list(task.outgoing_references) if task.outgoing_references else None

        title_changed = "title" in kwargs and kwargs["title"] != task.title  # noqa: PLR2004
        old_status = task.status
        old_due_date = task.due_date
        old_priority = task.priority
        old_assignee_ids = list(task.assignee_ids) if task.assignee_ids else []
        old_title = task.title
        previous_parent_id = task.parent_id
        parent_changed = "parent_id" in kwargs and kwargs.get("parent_id") != task.parent_id  # noqa: PLR2004

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

            if key == "field_values" and isinstance(value, dict):  # noqa: PLR2004
                merged = dict(task.field_values or {})
                merged.update(value)
                setattr(task, key, merged)
            else:
                setattr(task, key, value)

            if key == "status" and old_value != value:  # noqa: PLR2004
                if new_status_completed and not old_status_completed:
                    task.completed_at = datetime.now(UTC)
                elif old_status_completed and not new_status_completed:
                    task.completed_at = None

                await TaskNotifications(self.session).log_activity(
                    task_id,
                    user_id,
                    "status_changed",
                    field_id=SystemProjectFieldId.STATUS,
                    previous_value=str(old_value),
                    new_value=str(value),
                )
            elif key == "priority" and old_value != value:  # noqa: PLR2004
                await TaskNotifications(self.session).log_activity(
                    task_id,
                    user_id,
                    "priority_changed",
                    field_id=SystemProjectFieldId.PRIORITY,
                    previous_value=str(old_value),
                    new_value=str(value),
                )
            elif key == "task_type" and old_value != value:  # noqa: PLR2004
                await TaskNotifications(self.session).log_activity(
                    task_id,
                    user_id,
                    "type_changed",
                    field_id=SystemProjectFieldId.TYPE,
                    previous_value=str(old_value),
                    new_value=str(value),
                )
            elif key == "sprint_id" and old_value != value:  # noqa: PLR2004
                await TaskNotifications(self.session).log_activity(
                    task_id,
                    user_id,
                    "sprint_changed",
                    previous_value=str(old_value) if old_value else None,
                    new_value=str(value) if value else None,
                )
            elif key == "assignee_ids" and old_value != value:  # noqa: PLR2004
                await TaskNotifications(self.session).log_activity(
                    task_id,
                    user_id,
                    "assigned",
                    field_id=SystemProjectFieldId.ASSIGNEE,
                    previous_value=",".join(old_value) if old_value else None,
                    new_value=",".join(value) if value else None,
                )

        if "description" in kwargs:  # noqa: PLR2004
            task.outgoing_references = queries.extract_urns_from_content(task.description) or None

        task.version += 1
        task.updated_at = datetime.now(UTC)

        if parent_changed:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.TASK_MOVED,
                resource_type=AuditResourceType.TASK,
                resource_id=task_id,
                details={
                    "previous_parent_id": (str(previous_parent_id) if previous_parent_id else None),
                    "new_parent_id": str(task.parent_id) if task.parent_id else None,
                },
            )

        if "assignee_ids" in kwargs:  # noqa: PLR2004
            newly_assigned = set(task.assignee_ids or []) - set(old_assignee_ids or [])
            if newly_assigned:
                member_ids = await TaskNotifications(self.session).expand_assignees_to_users([
                    UUID(uid) for uid in newly_assigned
                ])
                if member_ids:
                    await WatcherOperations(self.session).ensure_watching(
                        member_ids, organization_id, task.id
                    )

        await self.session.commit()
        await self.session.refresh(task)

        await self.content._sync_task_tags(actor_id=user_id, task=task, tag_ids=tag_ids)

        await self.content._index_for_search(task)

        await TaskNotifications(self.session).emit_assignment_notifications(
            task, user_id, old_assignee_ids, task.assignee_ids
        )
        await TaskNotifications(self.session).emit_mention_notifications(
            task, user_id, old_references, task.outgoing_references
        )

        changes: list[str] = []
        if "status" in kwargs and kwargs["status"] != old_status:  # noqa: PLR2004
            label = task.status.replace("status_", "").replace("_", " ").title()
            changes.append(f'Status changed to "{label}"')
        if "priority" in kwargs:  # noqa: PLR2004
            label = task.priority.replace("priority_", "").replace("_", " ").title()
            changes.append(f'Priority changed to "{label}"')
        if "assignee_ids" in kwargs:  # noqa: PLR2004
            changes.append("Assignees updated")
        if title_changed:
            changes.append("Title updated")
        if "due_date" in kwargs and task.due_date != old_due_date:  # noqa: PLR2004
            changes.append("Due date updated")
        if changes:
            await TaskNotifications(self.session).emit_watcher_notifications(
                task, user_id, "; ".join(changes)
            )

        if title_changed:
            try:
                task_urn = build_content_urn(ContentType.TASK, task.id)
                await propagate_rename(
                    session=self.session,
                    organization_id=organization_id,
                    target_urn=task_urn,
                    new_label=task.title,
                )
            except Exception:
                logger.opt(exception=True).warning(
                    "Failed to propagate task rename to mentions", task_id=str(task_id)
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
                resolved = await TaskNotifications(self.session).resolve_field_option_labels(
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
                    "Failed to publish task mention state change", task_id=str(task_id)
                )

        became_completed = new_status_completed and not old_status_completed
        became_incomplete = old_status_completed and not new_status_completed

        if task.parent_id and became_completed:
            parent_counts = await queries.get_subtask_counts(self.session, [task.parent_id])
            p_total, p_done = parent_counts.get(task.parent_id, (0, 0))
            if p_total > 0 and p_total == p_done:
                parent = await self.session.get(Task, task.parent_id)
                if parent and parent.completed_at is None and not parent.is_deleted:
                    old_parent_status = parent.status
                    parent.status = status_semantics.id_for(TaskStatusSemantic.COMPLETED)
                    parent.completed_at = datetime.now(UTC)
                    parent.version += 1
                    parent.updated_at = datetime.now(UTC)
                    await self.session.commit()
                    await self.session.refresh(parent)

                    await TaskNotifications(self.session).log_activity(
                        parent.id,
                        user_id,
                        "status_changed",
                        field_id=SystemProjectFieldId.STATUS,
                        previous_value=old_parent_status,
                        new_value=parent.status,
                    )
        elif task.parent_id and became_incomplete:
            parent = await self.session.get(Task, task.parent_id)
            if parent and parent.completed_at is not None and not parent.is_deleted:
                old_parent_status = parent.status
                parent.status = status_semantics.id_for(TaskStatusSemantic.IN_PROGRESS)
                parent.completed_at = None
                parent.version += 1
                parent.updated_at = datetime.now(UTC)
                await self.session.commit()
                await self.session.refresh(parent)

                await TaskNotifications(self.session).log_activity(
                    parent.id,
                    user_id,
                    "status_changed",
                    field_id=SystemProjectFieldId.STATUS,
                    previous_value=old_parent_status,
                    new_value=parent.status,
                )

        spawned_task: Task | None = None
        if task.recurrence_rule and became_completed:
            spawned_task = await spawn_next_recurring_instance(
                self.session,
                self.content._index_for_search,
                task,
                organization_id,
                status_semantics,
            )

        return task, spawned_task

    async def delete(
        self,
        user_id: UUID,
        organization_id: UUID,
        task_id: UUID,
        permanent: bool = False,
    ) -> bool:
        task = await self.content.get_by_id(user_id, organization_id, task_id)
        await self.content._require_delete(user_id, organization_id, task)

        if permanent:
            tag_ops = TagOperations(self.session, self.content.search_indexer)
            await tag_ops.unassign_all_for_urn(
                actor_id=user_id,
                organization_id=organization_id,
                content_urn=build_content_urn(self.content.content_type, task_id),
            )

            await purge_attachments_for_content(
                self.session,
                self.content.storage,
                self.content.search_indexer,
                organization_id=organization_id,
                content_type=self.content.content_type,
                content_ids=[task_id],
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
            action=(Action.TASK_PERMANENTLY_DELETED if permanent else Action.TASK_DELETED),
            resource_type=AuditResourceType.TASK,
            resource_id=task_id,
            details={"title": task.title, "project_id": str(task.project_id)},
        )

        await self.session.commit()
        await self.content.search_indexer.remove(
            build_content_urn(self.content.content_type, task_id), organization_id
        )
        return True
