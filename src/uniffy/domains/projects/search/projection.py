"""Refresh task search and mention projections."""

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.content.mentions import publish_mention_state
from uniffy.core.models.projects.task import Task
from uniffy.core.search.indexer import SearchIndexer
from uniffy.domains.projects.tasks.notifications import TaskNotifications
from uniffy.domains.projects.tasks.reader import TaskReader


async def refresh_task_search_projection(
    session: AsyncSession,
    task: Task,
    search_indexer: SearchIndexer,
) -> None:
    operations = TaskReader(session, search_indexer=search_indexer)
    await operations._index_for_search(task)
    labels = await TaskNotifications(session).resolve_field_option_labels(
        task.project_id,
        task.status,
        task.priority,
    )
    await publish_mention_state(
        organization_id=task.organization_id,
        urn=task.urn,
        changes={
            "title": task.title,
            "description": operations._get_search_description(task) or "",
            "status": task.status,
            "priority": task.priority,
            "due_date": task.due_date.isoformat() if task.due_date else "",
            "assignee_ids": ",".join(str(user_id) for user_id in task.assignee_ids),
            **labels,
            **(operations._get_search_metadata(task) or {}),
        },
    )
