"""Seed projects, their custom fields, sprints and tasks through the real domain operations."""

from __future__ import annotations

import re
from datetime import timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.project import Project
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.projects.operations import (
    ProjectFieldOperations,
    ProjectOperations,
    SprintOperations,
    TaskOperations,
)
from uniffy.domains.projects.status_colors import brand_ramp_color
from uniffy.scripts.demo_company.context import (
    DemoContext,
    DomainResult,
    resolve_member_map,
    tag_ids_for,
)
from uniffy.scripts.demo_company.project_specs import (
    FieldSpec,
    FieldValue,
    ProjectSpec,
    SprintSpec,
    TaskSpec,
)

logger = logger.bind(component="scripts.demo_company.projects")

PROGRESS_EVERY = 250
SELECT_TYPES = (ProjectFieldType.SINGLE_SELECT, ProjectFieldType.MULTI_SELECT)


async def seed_projects(
    ctx: DemoContext,
    projects: tuple[ProjectSpec, ...],
    tag_ids: dict[str, UUID],
) -> DomainResult:
    result = DomainResult()
    for spec in projects:
        if await _project_exists(ctx, spec.slug):
            # Tasks ride their project: an existing project skips wholesale.
            result.skipped += 1
            continue

        if ctx.dry_run:
            logger.info(f"[dry-run] project {spec.name!r} with {len(spec.tasks)} tasks")
            result.created += 1 + len(spec.tasks)
            continue

        await _seed_project(ctx, spec, tag_ids)
        result.created += 1 + len(spec.tasks)
    return result


async def _project_exists(ctx: DemoContext, slug: str) -> bool:
    existing = await ctx.session.execute(
        select(Project.id).where(
            Project.organization_id == ctx.organization_id,
            Project.slug == slug,
            Project.is_deleted == False,  # noqa: E712
        )
    )
    return existing.scalars().first() is not None


async def _seed_project(ctx: DemoContext, spec: ProjectSpec, tag_ids: dict[str, UUID]) -> None:
    project = await ProjectOperations(ctx.session, ctx.storage, ctx.search_indexer).create(
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
    fields = await _create_fields(ctx, project.id, spec.fields)
    sprint_ids = await _create_sprints(ctx, project.id, spec.sprints)
    members = await resolve_member_map(ctx.session, ctx.organization_id, _emails(spec))

    task_ops = TaskOperations(ctx.session, ctx.storage, ctx.search_indexer)
    task_ids: dict[str, UUID] = {}
    for index, task in enumerate(spec.tasks, start=1):
        created = await task_ops.create(
            user_id=ctx.actor_id,
            organization_id=ctx.organization_id,
            project_id=project.id,
            title=task.title,
            task_type=task.task_type,
            tag_ids=tag_ids_for(tag_ids, task.tags) or None,
            description=task.description,
            status=task.status,
            priority=task.priority,
            assignee_ids=[str(members[email]) for email in task.assignees if email in members]
            or None,
            start_date=_date(ctx, task.start_in_days),
            due_date=_date(ctx, task.due_in_days),
            parent_id=task_ids[task.parent] if task.parent else None,
            blocked_by_task_ids=[str(task_ids[key]) for key in task.blocked_by] or None,
            is_milestone=task.is_milestone,
            recurrence_rule=task.recurrence_rule,
            sprint_id=sprint_ids[task.sprint] if task.sprint else None,
            estimated_minutes=task.estimated_minutes,
            time_spent_minutes=task.time_spent_minutes,
            field_values=_field_values(ctx, task, fields, members) or None,
        )
        if task.key is not None:
            task_ids[task.key] = created.id
        if index % PROGRESS_EVERY == 0:
            logger.info(f"  {spec.slug}: {index}/{len(spec.tasks)} tasks")

    logger.info(
        f"Created project {spec.name!r}: {len(spec.tasks)} tasks, "
        f"{len(spec.sprints)} sprints, {len(spec.fields)} custom fields"
    )


async def _create_fields(
    ctx: DemoContext,
    project_id: UUID,
    specs: tuple[FieldSpec, ...],
) -> dict[str, FieldDefinition]:
    ops = ProjectFieldOperations(ctx.session)
    fields: dict[str, FieldDefinition] = {}
    for sort_order, spec in enumerate(specs, start=10):
        config = None
        if spec.field_type in SELECT_TYPES:
            config = {
                "options": [
                    {
                        "id": _option_id(label),
                        "label": label,
                        "color": brand_ramp_color(index, len(spec.options)),
                        "sortOrder": index,
                    }
                    for index, label in enumerate(spec.options)
                ]
            }
        fields[spec.name] = await ops.create(
            ctx.actor_id,
            ctx.organization_id,
            project_id,
            name=spec.name,
            field_type=spec.field_type,
            config=config,
            sort_order=sort_order,
        )
    return fields


async def _create_sprints(
    ctx: DemoContext,
    project_id: UUID,
    specs: tuple[SprintSpec, ...],
) -> dict[str, UUID]:
    """Past sprints close, the one spanning today starts, later ones stay planned."""
    ops = SprintOperations(ctx.session)
    sprint_ids: dict[str, UUID] = {}
    for spec in specs:
        sprint = await ops.create(
            ctx.actor_id,
            ctx.organization_id,
            project_id,
            name=spec.name,
            goal=spec.goal,
            start_date=_date(ctx, spec.start_in_days),
            end_date=_date(ctx, spec.end_in_days),
        )
        if spec.end_in_days < 0:
            await ops.complete(ctx.actor_id, ctx.organization_id, sprint.id)
        elif spec.start_in_days <= 0:
            await ops.start(ctx.actor_id, ctx.organization_id, sprint.id)
        sprint_ids[spec.name] = sprint.id
    return sprint_ids


def _field_values(
    ctx: DemoContext,
    task: TaskSpec,
    fields: dict[str, FieldDefinition],
    members: dict[str, UUID],
) -> dict[str, object]:
    values: dict[str, object] = {}
    for name, value in task.field_values:
        definition = fields[name]
        resolved = _field_value(ctx, definition.type, value, members)
        if resolved is not None:
            values[definition.id] = resolved
    return values


def _field_value(
    ctx: DemoContext,
    field_type: str,
    value: FieldValue,
    members: dict[str, UUID],
) -> object:
    if field_type == ProjectFieldType.SINGLE_SELECT:
        return _option_id(str(value))
    if field_type == ProjectFieldType.MULTI_SELECT:
        labels = value if isinstance(value, tuple) else (str(value),)
        return [_option_id(label) for label in labels]
    if field_type == ProjectFieldType.PERSON:
        member = members.get(str(value))
        return str(member) if member else None
    if field_type == ProjectFieldType.DATE and isinstance(value, int):
        return _date(ctx, value)
    return value


def _option_id(label: str) -> str:
    return "opt_" + re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")


def _date(ctx: DemoContext, day_offset: int | None) -> str | None:
    if day_offset is None:
        return None
    return (ctx.now + timedelta(days=day_offset)).strftime("%Y-%m-%d")


def _emails(spec: ProjectSpec) -> tuple[str, ...]:
    person_fields = {
        field.name for field in spec.fields if field.field_type == ProjectFieldType.PERSON
    }
    emails = {email for task in spec.tasks for email in task.assignees}
    emails |= {
        str(value)
        for task in spec.tasks
        for name, value in task.field_values
        if name in person_fields
    }
    return tuple(sorted(emails))
