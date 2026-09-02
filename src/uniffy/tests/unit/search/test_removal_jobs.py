from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from uniffy.core.models.search import SearchRemovalQueue
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY, SearchIndexer, WorkspaceSearch
from uniffy.domains.search.jobs.jobs import flush_search_removals


async def test_failed_acknowledgement_remains_queued() -> None:
    row = SearchRemovalQueue(
        urn="urn:uniffy:content:NOTE:01900000-0000-7000-8000-000000000001",
        organization_id=uuid4(),
    )
    session = AsyncMock()
    session.execute.return_value = SimpleNamespace(
        scalars=lambda: SimpleNamespace(all=lambda: [row])
    )

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncMock]:
        yield session

    search = AsyncMock(spec=WorkspaceSearch)
    search.delete_document.side_effect = RuntimeError("terminal task failed")
    indexer = SearchIndexer(search)
    release_lock = AsyncMock()
    with (
        patch(
            "uniffy.domains.search.jobs.jobs._acquire_lock",
            AsyncMock(return_value="owner-token"),
        ),
        patch(
            "uniffy.domains.search.jobs.jobs._release_lock",
            release_lock,
        ),
        patch("uniffy.domains.search.jobs.jobs.open_session", open_session),
    ):
        result = await flush_search_removals({SEARCH_INDEXER_CTX_KEY: indexer})

    assert result == {"status": "completed", "flushed": 0, "failed": 1, "dropped": 0}
    assert row.attempts == 1
    session.delete.assert_not_awaited()
    session.commit.assert_awaited_once()
    release_lock.assert_awaited_once_with("owner-token")
