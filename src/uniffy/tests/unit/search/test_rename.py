from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.json_codec import loads
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY, SearchIndexer
from uniffy.core.types import EventVisibility, generate_id
from uniffy.domains.search import rename
from uniffy.domains.search.jobs import jobs
from uniffy.domains.search.jobs.contracts import REINDEX_RENAMED_CONTENT


def _rows(values: list[object]) -> SimpleNamespace:
    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: values))


async def test_propagate_rename_commits_before_dispatching_reindex() -> None:
    organization_id = generate_id()
    note_id = generate_id()
    event_id = generate_id()
    task_id = generate_id()
    order: list[str] = []
    session = AsyncMock()
    session.commit.side_effect = lambda: order.append("commit")
    enqueue = AsyncMock(side_effect=lambda *_: order.append("enqueue"))

    with (
        patch.object(
            rename,
            "_propagate_to_notes",
            AsyncMock(return_value=[SimpleNamespace(id=note_id)]),
        ),
        patch.object(
            rename,
            "_propagate_to_calendar_events",
            AsyncMock(return_value=[SimpleNamespace(id=event_id)]),
        ),
        patch.object(
            rename,
            "_propagate_to_tasks",
            AsyncMock(return_value=[SimpleNamespace(id=task_id)]),
        ),
        patch.object(rename, "enqueue_job", enqueue),
    ):
        updated = await rename.propagate_rename(
            session,
            organization_id,
            "urn:uniffy:content:NOTE:01900000-0000-7000-8000-000000000001",
            "Renamed",
        )

    assert updated == 3
    assert order == ["commit", "enqueue"]
    ref, payload_json = enqueue.await_args.args
    assert ref is REINDEX_RENAMED_CONTENT
    assert loads(payload_json) == {
        "organization_id": str(organization_id),
        "note_ids": [str(note_id)],
        "event_ids": [str(event_id)],
        "task_ids": [str(task_id)],
    }


async def test_reindex_renamed_content_refreshes_search_and_live_mentions() -> None:
    organization_id = generate_id()
    note = SimpleNamespace(
        id=generate_id(),
        urn="urn:uniffy:content:NOTE:01900000-0000-7000-8000-000000000002",
        title="Note",
    )
    event = SimpleNamespace(
        id=generate_id(),
        urn="urn:uniffy:content:CALENDAR_EVENT:01900000-0000-7000-8000-000000000003",
        title="Private title",
        visibility=EventVisibility.PRIVATE,
    )
    task = SimpleNamespace(
        id=generate_id(),
        urn="urn:uniffy:content:TASK:01900000-0000-7000-8000-000000000004",
        title="Task",
        project_id=generate_id(),
        status="todo",
        priority="high",
        due_date=None,
        assignee_ids=[],
    )
    session = AsyncMock()
    session.execute.side_effect = [_rows([note]), _rows([event]), _rows([task])]

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncMock]:
        yield session

    refresh_note = AsyncMock()
    refresh_event = AsyncMock()
    refresh_task = AsyncMock()
    search_indexer = MagicMock(spec=SearchIndexer)
    payload = {
        "organization_id": str(organization_id),
        "note_ids": [str(note.id)],
        "event_ids": [str(event.id)],
        "task_ids": [str(task.id)],
    }

    with (
        patch.object(jobs, "open_session", open_session),
        patch.object(jobs, "refresh_note_search_projection", refresh_note),
        patch.object(jobs, "refresh_event_search_projection", refresh_event),
        patch.object(jobs, "refresh_task_search_projection", refresh_task),
    ):
        result = await jobs.reindex_renamed_content(
            {SEARCH_INDEXER_CTX_KEY: search_indexer}, rename.dumps_str(payload)
        )

    assert result == {"notes": 1, "events": 1, "tasks": 1}
    refresh_note.assert_awaited_once_with(session, note, search_indexer)
    refresh_event.assert_awaited_once_with(session, event, search_indexer)
    refresh_task.assert_awaited_once_with(session, task, search_indexer)
