"""Backdate seeded projects and tasks so creation and completion line up with task dates."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update

from uniffy.core.models import Project, Task
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.scripts.demo_company.context import DemoContext
from uniffy.scripts.demo_company.loader import DemoContent

CREATED_ACTIVITY = "created"


async def spread_projects(
    ctx: DemoContext, content: DemoContent
) -> tuple[list[Project | Task], int]:
    """Stamp rows whose spec carries day offsets; return the rest for the even history spread.

    Tasks match their spec by number, since a seeded project numbers its tasks in spec order.
    """
    slugs = [spec.slug for spec in content.projects]
    projects = (
        (
            await ctx.session.execute(
                select(Project).where(
                    Project.organization_id == ctx.organization_id,
                    Project.slug.in_(slugs),
                    Project.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_slug = {row.slug: row for row in projects}
    tasks = (
        (
            await ctx.session.execute(
                select(Task).where(
                    Task.project_id.in_([row.id for row in projects]),
                    Task.is_deleted.is_(False),
                )
            )
        )
        .scalars()
        .all()
    )
    by_number = {(row.project_id, row.number): row for row in tasks}

    undated: list[Project | Task] = []
    dated = 0
    dated_tasks: list[Task] = []
    for spec in content.projects:
        project = by_slug.get(spec.slug)
        if project is None:
            continue
        if spec.created_in_days is None:
            undated.append(project)
        else:
            project.created_at = project.updated_at = _stamp(ctx, spec.created_in_days, 0)
            dated += 1

        for number, task_spec in enumerate(spec.tasks, start=1):
            task = by_number.get((project.id, number))
            if task is None:
                continue
            if task_spec.created_in_days is None:
                undated.append(task)
                continue
            task.created_at = _stamp(ctx, task_spec.created_in_days, number)
            task.updated_at = task.created_at
            if task.completed_at is not None and task_spec.completed_in_days is not None:
                task.completed_at = _stamp(ctx, task_spec.completed_in_days, number + 3)
                task.updated_at = max(task.completed_at, task.created_at)
            dated_tasks.append(task)

    await ctx.session.flush()
    await _align_created_activity([task.id for task in dated_tasks], ctx)
    return undated, dated + len(dated_tasks)


async def _align_created_activity(task_ids: list[UUID], ctx: DemoContext) -> None:
    if not task_ids:
        return
    await ctx.session.execute(
        update(TaskActivity)
        .where(
            TaskActivity.task_id == Task.id,
            TaskActivity.task_id.in_(task_ids),
            TaskActivity.action == CREATED_ACTIVITY,
        )
        .values(timestamp=Task.created_at)
    )


def _stamp(ctx: DemoContext, day_offset: int, salt: int) -> datetime:
    """Working-hours time on that day, spread by `salt` so rows do not share one instant."""
    day = (ctx.now + timedelta(days=day_offset)).replace(minute=0, second=0, microsecond=0)
    stamp = day.replace(hour=7 + salt % 9) + timedelta(minutes=(salt * 7) % 60)
    return min(stamp, ctx.now)
