from datetime import UTC, datetime

import pytest
from sqlalchemy import delete

from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.types import AccessMode, generate_id
from uniffy.domains.projects.tasks.reader import TaskReader

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_offset_pages_partition_tasks_with_tied_sort_keys(session, env) -> None:
    project = Project(
        organization_id=env.org_id,
        owner_id=env.admin_id,
        access_mode=AccessMode.OWNER_ONLY,
        name=f"Paging {generate_id().hex[:10]}",
        slug=f"PG{generate_id().hex[:8].upper()}",
    )
    created_at = datetime.now(UTC)
    tasks = [
        Task(
            project_id=project.id,
            organization_id=env.org_id,
            owner_id=env.admin_id,
            title=f"Tied {number}",
            sort_order=0,
            number=number,
            created_at=created_at,
            updated_at=created_at,
        )
        for number in range(1, 8)
    ]
    # Rollback expires the rows, so cleanup and assertions work from plain ids.
    project_id = project.id
    task_ids = [task.id for task in tasks]

    try:
        session.add(project)
        await session.flush()
        # Insert against id order so heap order alone cannot produce the expected pages.
        session.add_all(reversed(tasks))
        await session.commit()

        reader = TaskReader(session)
        seen: list = []
        for page in (1, 2, 3):
            page_tasks, total = await reader.list_tasks(
                user_id=env.admin_id,
                organization_id=env.org_id,
                project_id=project_id,
                page=page,
                page_size=3,
            )
            assert total == len(task_ids)
            seen.extend(task.id for task in page_tasks)

        assert seen == sorted(task_ids)
    finally:
        await session.rollback()
        await session.execute(delete(Task).where(Task.project_id == project_id))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.commit()
