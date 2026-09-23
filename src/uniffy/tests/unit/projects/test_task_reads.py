"""Task read-path dependency tests."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import postgresql

from uniffy.core.types import generate_id
from uniffy.domains.projects.projects import ProjectOperations
from uniffy.domains.projects.tasks.reader import TaskReader


async def test_list_tasks_does_not_require_search_writer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    count_result = MagicMock()
    count_result.scalar_one.return_value = 0
    tasks_result = MagicMock()
    tasks_result.scalars.return_value.all.return_value = []

    session = MagicMock()
    session.execute = AsyncMock(side_effect=[tasks_result, count_result])
    get_project = AsyncMock(return_value=MagicMock())
    monkeypatch.setattr(ProjectOperations, "get_by_id", get_project)

    operations = TaskReader(session)
    tasks, total = await operations.list_tasks(
        user_id=generate_id(),
        organization_id=generate_id(),
        project_id=generate_id(),
    )

    assert tasks == []
    assert total == 0
    get_project.assert_awaited_once()


async def test_list_tasks_orders_by_id_last(monkeypatch: pytest.MonkeyPatch) -> None:
    count_result = MagicMock()
    count_result.scalar_one.return_value = 0
    tasks_result = MagicMock()
    tasks_result.scalars.return_value.all.return_value = []

    session = MagicMock()
    session.execute = AsyncMock(side_effect=[tasks_result, count_result])
    monkeypatch.setattr(ProjectOperations, "get_by_id", AsyncMock(return_value=MagicMock()))

    await TaskReader(session).list_tasks(
        user_id=generate_id(),
        organization_id=generate_id(),
        project_id=generate_id(),
        page=2,
        page_size=3,
    )

    page_query = session.execute.await_args_list[0].args[0]
    sql = str(page_query.compile(dialect=postgresql.dialect()))
    order_by = sql.split("ORDER BY", 1)[1].split("LIMIT", 1)[0].strip()
    assert order_by == (
        "projects_tasks.sort_order ASC, projects_tasks.number ASC, projects_tasks.id ASC"
    )
