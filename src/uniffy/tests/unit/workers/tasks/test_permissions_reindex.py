from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from uniffy.core.types import ContentType
from uniffy.vendor.arq import Retry
from uniffy.workers.tasks import JobName
from uniffy.workers.tasks.permissions_reindex import (
    _BATCH_SIZE,
    _domain_for,
    reindex_org_content_for_defaults,
)


class _Operations:
    index = AsyncMock()

    def __init__(self, session) -> None:
        self.session = session

    async def _index_for_search(self, row) -> None:
        await self.index(row)


def _session_for(rows: list[SimpleNamespace]):
    session = AsyncMock()
    session.execute.return_value = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: rows)
    )

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncMock]:
        yield session

    return session, open_session


def test_folder_and_room_have_defaults_reindexers() -> None:
    folder_ops, folder_model = _domain_for(ContentType.FOLDER)
    room_ops, room_model = _domain_for(ContentType.ROOM)

    assert folder_ops is not None
    assert folder_model.__name__ == "Folder"
    assert room_ops is not None
    assert room_model.__name__ == "Room"


async def test_project_reindex_records_and_enqueues_child_refresh() -> None:
    organization_id = uuid4()
    project_id = uuid4()
    row = SimpleNamespace(id=project_id)
    session, open_session = _session_for([row])
    _Operations.index.reset_mock()

    with (
        patch(
            "uniffy.workers.tasks.permissions_reindex._domain_for",
            return_value=(_Operations, object()),
        ),
        patch(
            "uniffy.workers.tasks.permissions_reindex._keyset_query",
            return_value=object(),
        ),
        patch("uniffy.workers.tasks.permissions_reindex.open_session", open_session),
        patch(
            "uniffy.workers.tasks.permissions_reindex.record_project_search_acl_refresh",
            AsyncMock(),
        ) as record,
        patch(
            "uniffy.workers.tasks.permissions_reindex.enqueue_project_search_acl_refresh",
            AsyncMock(),
        ) as enqueue,
    ):
        result = await reindex_org_content_for_defaults(
            {"job_try": 1},
            str(organization_id),
            ContentType.PROJECT.value,
        )

    assert result == {
        "status": "complete",
        "processed": 1,
        "succeeded": 1,
        "failed": 0,
    }
    record.assert_awaited_once_with(session, organization_id, project_id)
    enqueue.assert_awaited_once_with(project_id)
    session.commit.assert_awaited_once()


async def test_item_failure_retries_job() -> None:
    row = SimpleNamespace(id=uuid4())
    _session, open_session = _session_for([row])
    _Operations.index = AsyncMock(side_effect=RuntimeError("index failed"))

    with (
        patch(
            "uniffy.workers.tasks.permissions_reindex._domain_for",
            return_value=(_Operations, object()),
        ),
        patch(
            "uniffy.workers.tasks.permissions_reindex._keyset_query",
            return_value=object(),
        ),
        patch("uniffy.workers.tasks.permissions_reindex.open_session", open_session),
        pytest.raises(Retry),
    ):
        await reindex_org_content_for_defaults(
            {"job_try": 2},
            str(uuid4()),
            ContentType.NOTE.value,
        )


async def test_full_page_enqueues_cursor_scoped_continuation() -> None:
    organization_id = uuid4()
    rows = [SimpleNamespace(id=uuid4()) for _ in range(_BATCH_SIZE)]
    rows.sort(key=lambda row: row.id)
    _session, open_session = _session_for(rows)
    _Operations.index = AsyncMock()
    queue = AsyncMock()

    with (
        patch(
            "uniffy.workers.tasks.permissions_reindex._domain_for",
            return_value=(_Operations, object()),
        ),
        patch(
            "uniffy.workers.tasks.permissions_reindex._keyset_query",
            return_value=object(),
        ),
        patch("uniffy.workers.tasks.permissions_reindex.open_session", open_session),
        patch("uniffy.workers.tasks.permissions_reindex.get_queue", return_value=queue),
    ):
        result = await reindex_org_content_for_defaults(
            {"job_try": 1, "job_id": "initial"},
            str(organization_id),
            ContentType.NOTE.value,
            run_id="revision",
        )

    cursor = rows[-1].id
    assert result["status"] == "queued"
    queue.enqueue_job.assert_awaited_once_with(
        JobName.REINDEX_ORG_CONTENT_FOR_DEFAULTS,
        str(organization_id),
        ContentType.NOTE.value,
        str(cursor),
        "revision",
        _job_id=(
            f"reindex_defaults_page:{organization_id}:{ContentType.NOTE.value}:revision:{cursor}"
        ),
    )
