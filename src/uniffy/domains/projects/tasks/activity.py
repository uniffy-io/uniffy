"""Which task changes the activity history records, and in what shape."""

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.projects.activity import TaskActivityAction as Act
from uniffy.core.models.projects.field_definition import SystemProjectFieldId
from uniffy.core.models.projects.task import Task
from uniffy.domains.projects.tasks.notifications import TaskNotifications

# Update arguments recorded as a single from -> to entry.
FIELD_ACTIONS: dict[str, tuple[Act, str | None]] = {
    "title": (Act.TITLE_CHANGED, SystemProjectFieldId.TITLE),
    "status": (Act.STATUS_CHANGED, SystemProjectFieldId.STATUS),
    "priority": (Act.PRIORITY_CHANGED, SystemProjectFieldId.PRIORITY),
    "task_type": (Act.TYPE_CHANGED, SystemProjectFieldId.TYPE),
    "assignee_ids": (Act.ASSIGNED, SystemProjectFieldId.ASSIGNEE),
    "start_date": (Act.START_DATE_CHANGED, SystemProjectFieldId.START_DATE),
    "due_date": (Act.DUE_DATE_CHANGED, SystemProjectFieldId.DUE_DATE),
    "sprint_id": (Act.SPRINT_CHANGED, None),
    "estimated_minutes": (Act.ESTIMATE_CHANGED, None),
    "parent_id": (Act.PARENT_CHANGED, None),
    "recurrence_rule": (Act.RECURRENCE_CHANGED, None),
    "is_milestone": (Act.MILESTONE_CHANGED, None),
}

# Update arguments with their own recording: one entry per custom field, per blocker, per tag set,
# and per description editing session.
SEPARATELY_LOGGED = frozenset({"field_values", "blocked_by_task_ids", "tag_ids", "description"})

# Update arguments that change no user-visible fact.
NOT_LOGGED = frozenset({"sort_order", "base_description"})


def activity_text(value: Any) -> str | None:
    if value is None or value == "" or value == []:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(str(item) for item in value)
    return str(value)


def _field_value_text(value: Any) -> str | None:
    if value is None or value == "" or value == []:
        return None
    if isinstance(value, str):
        return value
    return dumps_str(value)


class TaskActivityRecorder:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.writer = TaskNotifications(session)

    async def field_change(
        self, task_id: UUID, actor_id: UUID, key: str, old: Any, new: Any
    ) -> None:
        action, field_id = FIELD_ACTIONS[key]
        await self.writer.log_activity(
            task_id,
            actor_id,
            action,
            field_id=field_id,
            previous_value=activity_text(old),
            new_value=activity_text(new),
        )

    async def custom_fields(
        self,
        task_id: UUID,
        actor_id: UUID,
        old: dict[str, Any] | None,
        incoming: dict[str, Any],
    ) -> None:
        previous = old or {}
        for field_id, value in incoming.items():
            before = previous.get(field_id)
            if _field_value_text(before) == _field_value_text(value):
                continue
            await self.writer.log_activity(
                task_id,
                actor_id,
                Act.FIELD_UPDATED,
                field_id=field_id,
                previous_value=_field_value_text(before),
                new_value=_field_value_text(value),
            )

    async def blockers(
        self,
        task_id: UUID,
        actor_id: UUID,
        old: list[str] | None,
        new: list[str] | None,
    ) -> None:
        """Both ends get an entry: "blocked by X" here, "now blocks Y" on X."""
        before, after = set(old or []), set(new or [])
        added = [tid for tid in (new or []) if tid not in before]
        removed = [tid for tid in (old or []) if tid not in after]
        if not added and not removed:
            return
        linked = {str(tid) for tid in await self._existing_tasks(added + removed)}
        for blocker_id in added:
            await self.writer.log_activity(
                task_id, actor_id, Act.BLOCKED_BY_ADDED, new_value=blocker_id
            )
            if blocker_id in linked:
                await self.writer.log_activity(
                    UUID(blocker_id), actor_id, Act.BLOCKING_ADDED, new_value=str(task_id)
                )
        for blocker_id in removed:
            await self.writer.log_activity(
                task_id, actor_id, Act.BLOCKED_BY_REMOVED, previous_value=blocker_id
            )
            if blocker_id in linked:
                await self.writer.log_activity(
                    UUID(blocker_id), actor_id, Act.BLOCKING_REMOVED, previous_value=str(task_id)
                )

    async def tags(
        self, task_id: UUID, actor_id: UUID, added: list[str], removed: list[str]
    ) -> None:
        if not added and not removed:
            return
        await self.writer.log_activity(
            task_id,
            actor_id,
            Act.TAGS_CHANGED,
            previous_value=dumps_str(removed) if removed else None,
            new_value=dumps_str(added) if added else None,
        )

    async def _existing_tasks(self, ids: list[str]) -> list[UUID]:
        wanted = []
        for raw in ids:
            try:
                wanted.append(UUID(raw))
            except ValueError:
                continue
        if not wanted:
            return []
        result = await self.session.execute(select(Task.id).where(Task.id.in_(wanted)))
        return list(result.scalars().all())
