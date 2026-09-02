"""Task read-path dependency tests."""

from unittest.mock import AsyncMock, MagicMock

import pytest

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
    session.execute = AsyncMock(side_effect=[count_result, tasks_result])
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
