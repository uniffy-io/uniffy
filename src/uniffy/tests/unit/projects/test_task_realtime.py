from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pycrdt
import pytest

from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import RealtimeRenderConflict
from uniffy.core.types import ContentRole, ContentType, generate_id
from uniffy.domains.projects.realtime import TaskRealtimeAdapter
from uniffy.domains.projects.tasks.realtime import TaskRealtimePersistence


def _task() -> Task:
    return Task(
        id=generate_id(),
        project_id=generate_id(),
        organization_id=generate_id(),
        owner_id=generate_id(),
        title="Collaborative task",
        description="Initial body",
    )


def _session(task: Task | None, project_owner_id=None) -> MagicMock:
    session = MagicMock()
    project = (
        SimpleNamespace(
            id=task.project_id,
            owner_id=project_owner_id or generate_id(),
            access_mode=None,
            baseline_role=None,
        )
        if task is not None
        else None
    )
    session.execute = AsyncMock(
        return_value=MagicMock(
            scalar_one_or_none=lambda: task,
            one_or_none=lambda: project,
        )
    )
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.get = AsyncMock(return_value=MagicMock(owner_id=project_owner_id or generate_id()))
    return session


@pytest.mark.parametrize("content", ["Initial body", ""])
async def test_hydration_seeds_description(content: str) -> None:
    task = _task()
    task.description = content
    session = _session(task)
    adapter = TaskRealtimeAdapter(MagicMock())
    doc = pycrdt.Doc()
    await adapter.hydrate_ydoc(session, doc, task.id, task.organization_id)
    assert str(doc.get("markdown", type=pycrdt.Text)) == content
    assert await adapter.policy_key(session, task.id, task.organization_id) == (
        ContentType.PROJECT,
        task.project_id,
    )


async def test_authorization_uses_parent_role() -> None:
    task = _task()
    session = _session(task)
    adapter = TaskRealtimeAdapter(MagicMock())
    checker = MagicMock(effective_role=AsyncMock(return_value=ContentRole.EDITOR))
    user_id = generate_id()
    assert (
        await adapter.authorize(
            session,
            user_id,
            task.organization_id,
            task.id,
            checker=checker,
        )
        == ContentRole.EDITOR
    )
    project = session.execute.return_value.one_or_none()
    checker.effective_role.assert_awaited_once_with(
        user_id,
        task.organization_id,
        ContentType.PROJECT,
        task.project_id,
        owner_id=project.owner_id,
        access_mode=project.access_mode,
        baseline_role=project.baseline_role,
    )


async def test_missing_task_denies_and_skips_render() -> None:
    adapter = TaskRealtimeAdapter(MagicMock())
    session = _session(None)
    assert await adapter.authorize(session, generate_id(), generate_id(), generate_id()) is None
    assert await adapter.stage_render(session, pycrdt.Doc(), generate_id(), generate_id()) is None


async def test_render_exhaustion_preserves_snapshot_as_retryable_failure() -> None:
    task = _task()
    session = _session(task)
    session.execute.side_effect = [
        item
        for _ in range(3)
        for item in (MagicMock(scalar_one_or_none=lambda: task), MagicMock(rowcount=0))
    ]
    with pytest.raises(RealtimeRenderConflict):
        await TaskRealtimePersistence(session, MagicMock()).stage_save(
            task.organization_id, task.id, "Pending"
        )
    session.refresh.assert_not_awaited()
