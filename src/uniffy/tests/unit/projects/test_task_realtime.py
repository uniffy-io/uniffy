from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pycrdt
import pytest

from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.adapter import RealtimeRenderConflict, RealtimeRenderSuperseded
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
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: task))
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
    with patch(
        "uniffy.domains.projects.realtime.TaskContentOperations._resolve_role",
        AsyncMock(return_value=ContentRole.EDITOR),
    ) as resolve:
        user_id = generate_id()
        assert (
            await adapter.authorize(session, user_id, task.organization_id, task.id)
            == ContentRole.EDITOR
        )
        resolve.assert_awaited_once_with(user_id, task.organization_id, task)


async def test_authorization_threads_a_shared_checker_through() -> None:
    task = _task()
    session = _session(task)
    checker = MagicMock()
    with patch("uniffy.domains.projects.realtime.TaskContentOperations") as operations:
        operations.return_value._resolve_role = AsyncMock(return_value=ContentRole.VIEWER)
        assert (
            await TaskRealtimeAdapter(MagicMock()).authorize(
                session, generate_id(), task.organization_id, task.id, checker=checker
            )
            == ContentRole.VIEWER
        )
        operations.assert_called_once_with(session, permission_checker=checker)


async def test_missing_task_denies_and_skips_render() -> None:
    adapter = TaskRealtimeAdapter(MagicMock())
    session = _session(None)
    assert await adapter.authorize(session, generate_id(), generate_id(), generate_id()) is None
    assert not await adapter.render_and_persist(session, pycrdt.Doc(), generate_id(), generate_id())


def test_external_content_is_idempotent() -> None:
    adapter = TaskRealtimeAdapter(MagicMock())
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("Initial")
    assert adapter.apply_external_content(doc, "Replacement")
    assert str(doc.get("markdown", type=pycrdt.Text)) == "Replacement"
    assert not adapter.apply_external_content(doc, "Replacement")


async def test_render_exhaustion_preserves_snapshot_as_retryable_failure() -> None:
    task = _task()
    session = _session(task)
    session.execute.side_effect = [
        item
        for _ in range(3)
        for item in (MagicMock(scalar_one_or_none=lambda: task), MagicMock(rowcount=0))
    ]
    with pytest.raises(RealtimeRenderConflict):
        await TaskRealtimePersistence(session, MagicMock()).save(
            task.organization_id, task.id, "Pending"
        )
    session.refresh.assert_not_awaited()


@pytest.mark.parametrize("editor_known", [True, False])
async def test_render_retries_then_indexes_and_attributes_mentions(editor_known: bool) -> None:
    task = _task()
    project_owner = generate_id()
    editor = generate_id()
    session = _session(task, project_owner_id=project_owner)
    session.execute.side_effect = [
        MagicMock(scalar_one_or_none=lambda: task),
        MagicMock(rowcount=0),
        MagicMock(scalar_one_or_none=lambda: task),
        MagicMock(rowcount=1),
    ]
    with (
        patch("uniffy.domains.projects.tasks.realtime.TaskContentOperations") as operations,
        patch("uniffy.domains.projects.tasks.realtime.TaskNotifications") as notifications,
    ):
        operations.return_value._index_for_search = AsyncMock()
        notifications.return_value.emit_mention_notifications = AsyncMock()
        assert (
            await TaskRealtimePersistence(session, MagicMock()).save(
                task.organization_id,
                task.id,
                "Merged",
                actor_id=editor if editor_known else None,
            )
            is task
        )
        operations.return_value._index_for_search.assert_awaited_once_with(task)
        notifications.return_value.emit_mention_notifications.assert_awaited_once_with(
            task, editor if editor_known else project_owner, None, None
        )


async def test_render_refuses_to_overwrite_a_later_plain_write() -> None:
    task = _task()
    task.updated_at = datetime.now(UTC)
    session = _session(task)
    with pytest.raises(RealtimeRenderSuperseded):
        await TaskRealtimePersistence(session, MagicMock()).save(
            task.organization_id,
            task.id,
            "Stale live text",
            supersede_after=task.updated_at - timedelta(seconds=5),
        )
    session.commit.assert_not_awaited()


async def test_render_proceeds_when_the_plain_write_left_equal_text() -> None:
    task = _task()
    task.updated_at = datetime.now(UTC)
    session = _session(task)
    with (
        patch("uniffy.domains.projects.tasks.realtime.TaskContentOperations") as operations,
        patch("uniffy.domains.projects.tasks.realtime.TaskNotifications") as notifications,
    ):
        operations.return_value._index_for_search = AsyncMock()
        notifications.return_value.emit_mention_notifications = AsyncMock()
        saved = await TaskRealtimePersistence(session, MagicMock()).save(
            task.organization_id,
            task.id,
            task.description,
            supersede_after=task.updated_at - timedelta(seconds=5),
        )
    assert saved is task


async def test_adapter_threads_the_supersede_floor_through() -> None:
    task = _task()
    session = _session(task)
    floor = datetime.now(UTC)
    doc = pycrdt.Doc()
    doc["markdown"] = pycrdt.Text("Merged")
    with patch("uniffy.domains.projects.realtime.TaskRealtimePersistence") as persistence:
        persistence.return_value.save = AsyncMock(return_value=task)
        assert await TaskRealtimeAdapter(MagicMock()).render_and_persist(
            session, doc, task.id, task.organization_id, supersede_after=floor
        )
    assert persistence.return_value.save.await_args.kwargs["supersede_after"] == floor
