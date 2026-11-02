from collections.abc import Collection
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import Uuid, column, select, true, values
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.projects.activity import TaskActivity, TaskActivityAction

DESCRIPTION_SESSION_IDLE = timedelta(minutes=5)


async def stage_description_edits(
    session: AsyncSession,
    task_id: UUID,
    edits: Collection[tuple[UUID, datetime]],
    *,
    agent_id: UUID | None,
) -> list[TaskActivity]:
    """The caller holds the document lock so each editor extends only their own session."""
    if not edits:
        return []
    editors = values(column("actor_id", Uuid), name="editors").data([
        (actor,) for actor in {actor for actor, _ in edits}
    ])
    latest = (
        select(TaskActivity.id)
        .where(
            TaskActivity.task_id == task_id,
            TaskActivity.actor_id == editors.c.actor_id,
            TaskActivity.agent_id == agent_id,
            TaskActivity.action == TaskActivityAction.DESCRIPTION_EDITED,
        )
        .order_by(TaskActivity.timestamp.desc(), TaskActivity.id.desc())
        .limit(1)
        .correlate(editors)
        .lateral()
    )
    rows = (
        await session.scalars(
            select(TaskActivity)
            .select_from(editors)
            .join(latest, true())
            .join(TaskActivity, TaskActivity.id == latest.c.id)
        )
    ).all()
    sessions = {row.actor_id: row for row in rows}
    entries = []
    for actor_id, occurred_at in sorted(edits, key=lambda edit: edit[1]):
        entry = sessions.get(actor_id)
        if entry is None or occurred_at - entry.timestamp > DESCRIPTION_SESSION_IDLE:
            entry = TaskActivity(
                task_id=task_id,
                actor_id=actor_id,
                agent_id=agent_id,
                action=TaskActivityAction.DESCRIPTION_EDITED,
                timestamp=occurred_at,
            )
            session.add(entry)
            sessions[actor_id] = entry
        else:
            entry.timestamp = max(entry.timestamp, occurred_at)
        entries.append(entry)
    return entries
