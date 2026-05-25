"""Seed a 'Hierarchy QA' project with a curated task tree.

One-off helper for manually QA'ing the parent-aware filters added in
issue #95. Goes through ``ProjectOperations.create`` and
``TaskOperations.create`` so URNs and search indexing are populated
correctly (raw SQL would skip ``BaseContentOperations``).

Usage:

    uv run python scripts/seed_hierarchy_qa_project.py

Idempotent: if a project named "Hierarchy QA" already exists for the
admin user's first org, it is deleted (soft) first and recreated, so
re-running gives a clean fixture each time.

Hierarchy seeded:

    Epic A
      Story A1
        Task A1a
        Task A1b
          Subtask A1b-i        (depth 3)
      Story A2
        Task A2a
    Epic B (no children)
    Task X (root)
      Task X-1                  (depth 1)
    Task Y (root, leaf)
    Bug Z (root, leaf)
"""

from __future__ import annotations

import asyncio
import os
import sys
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.project import Project
from uniffy.core.search import init_meilisearch
from uniffy.db.session import init_db, open_session
from uniffy.domains.projects.operations import ProjectOperations, TaskOperations

ADMIN_EMAIL_DEFAULT = "admin@uniffy.io"
PROJECT_NAME = "Hierarchy QA"


async def _resolve_admin(session, email: str) -> tuple[UUID, UUID]:
    user_row = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if user_row is None:
        raise SystemExit(f"User {email!r} not found. Set ADMIN_EMAIL env var to override.")

    membership = (
        await session.execute(
            select(OrganizationMember).where(OrganizationMember.user_id == user_row.id)
        )
    ).scalars().first()
    if membership is None:
        raise SystemExit(f"User {email!r} is not a member of any organization.")
    return user_row.id, membership.organization_id


async def _delete_existing_project(session, user_id: UUID, organization_id: UUID) -> None:
    existing = (
        await session.execute(
            select(Project).where(
                Project.organization_id == organization_id,
                Project.name == PROJECT_NAME,
                Project.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    if not existing:
        return
    ops = ProjectOperations(session)
    for proj in existing:
        logger.info(f"Removing existing {PROJECT_NAME!r} project id={proj.id}")
        await ops.delete(user_id=user_id, organization_id=organization_id, project_id=proj.id)


async def _create_task(
    ops: TaskOperations,
    *,
    user_id: UUID,
    organization_id: UUID,
    project_id: UUID,
    title: str,
    task_type: str = "task",
    parent_id: UUID | None = None,
) -> UUID:
    task = await ops.create(
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title=title,
        task_type=task_type,
        parent_id=parent_id,
    )
    return task.id


async def _seed_tree(
    session, user_id: UUID, organization_id: UUID, project_id: UUID
) -> None:
    ops = TaskOperations(session)

    epic_a = await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Epic A",
        task_type="epic",
    )
    story_a1 = await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Story A1",
        task_type="story",
        parent_id=epic_a,
    )
    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Task A1a",
        parent_id=story_a1,
    )
    task_a1b = await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Task A1b",
        parent_id=story_a1,
    )
    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Subtask A1b-i",
        parent_id=task_a1b,
    )
    story_a2 = await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Story A2",
        task_type="story",
        parent_id=epic_a,
    )
    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Task A2a",
        parent_id=story_a2,
    )

    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Epic B",
        task_type="epic",
    )

    task_x = await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Task X",
    )
    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Task X-1",
        parent_id=task_x,
    )
    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Task Y",
    )
    await _create_task(
        ops,
        user_id=user_id,
        organization_id=organization_id,
        project_id=project_id,
        title="Bug Z",
        task_type="bug",
    )


async def main() -> None:
    email = os.getenv("ADMIN_EMAIL", ADMIN_EMAIL_DEFAULT)
    logger.info(f"Seeding {PROJECT_NAME!r} for {email}")

    await init_db(skip_migrations=True)
    await init_meilisearch()

    async with open_session() as session:
        user_id, organization_id = await _resolve_admin(session, email)
        await _delete_existing_project(session, user_id, organization_id)

        project_ops = ProjectOperations(session)
        project = await project_ops.create(
            user_id=user_id,
            organization_id=organization_id,
            name=PROJECT_NAME,
            description="Test fixture for parent-aware filters (#95).",
            icon="folder",
            color="#10b981",
        )
        logger.info(f"Created project id={project.id} slug={project.slug}")

        await _seed_tree(session, user_id, organization_id, project.id)
        await session.commit()

        logger.info("Seeded hierarchy:")
        logger.info("  Epic A")
        logger.info("    Story A1")
        logger.info("      Task A1a")
        logger.info("      Task A1b")
        logger.info("        Subtask A1b-i")
        logger.info("    Story A2")
        logger.info("      Task A2a")
        logger.info("  Epic B")
        logger.info("  Task X")
        logger.info("    Task X-1")
        logger.info("  Task Y")
        logger.info("  Bug Z")
        logger.info("")
        logger.info(f"Open the project at /projects/{project.id}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Seeding failed: {exc}")
        sys.exit(1)
