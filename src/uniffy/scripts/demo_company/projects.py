"""Seed projects and their tasks through the real domain operations."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.projects.project import Project
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations
from uniffy.scripts.demo_company.context import (
    DemoContext,
    DomainResult,
    resolve_member_ids,
    tag_ids_for,
)
from uniffy.scripts.demo_company.loader import ProjectSpec

logger = logger.bind(component="scripts.demo_company.projects")


async def seed_projects(
    ctx: DemoContext,
    projects: tuple[ProjectSpec, ...],
    tag_ids: dict[str, UUID],
) -> DomainResult:
    result = DomainResult()
    if not projects:
        return result

    project_ops = ProjectOperations(ctx.session)
    task_ops = TaskOperations(ctx.session)

    for spec in projects:
        existing = (
            (
                await ctx.session.execute(
                    select(Project.id).where(
                        Project.organization_id == ctx.organization_id,
                        Project.slug == spec.slug,
                        Project.is_deleted == False,  # noqa: E712
                    )
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            # Tasks ride their project: an existing project skips wholesale.
            result.skipped += 1
            continue

        if ctx.dry_run:
            logger.info(f"[dry-run] project {spec.name!r} with {len(spec.tasks)} tasks")
            result.created += 1 + len(spec.tasks)
            continue

        project = await project_ops.create(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            name=spec.name,
            description=spec.description,
            icon=spec.icon,
            color=spec.color,
            slug=spec.slug,
            access_mode=AccessMode.OPEN_TO_ORG,
            baseline_role=ContentRole.EDITOR,
            tag_ids=tag_ids_for(tag_ids, spec.tags) or None,
        )
        result.created += 1
        logger.info(f"Created project {spec.name!r}")

        for task in spec.tasks:
            assignee_ids = await resolve_member_ids(ctx.session, ctx.organization_id, task.assignees)
            due_date = None
            if task.due_in_days is not None and task.due_in_days >= 0:
                due_date = (ctx.now + timedelta(days=task.due_in_days)).strftime("%Y-%m-%d")

            await task_ops.create(
                user_id=ctx.actor_id,
                organization_id=ctx.organization_id,
                project_id=project.id,
                title=task.title,
                task_type=task.task_type,
                description=task.description,
                status=task.status,
                priority=task.priority,
                assignee_ids=[str(user_id) for user_id in assignee_ids] or None,
                due_date=due_date,
            )
            result.created += 1

        logger.info(f"Created {len(spec.tasks)} tasks in {spec.name!r}")

    return result
