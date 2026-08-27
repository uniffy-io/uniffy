from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from uniffy.core.models.search import SearchRemovalQueue
from uniffy.domains.search.jobs import flush_search_removals


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

    meili = AsyncMock()
    meili.delete_document.side_effect = RuntimeError("terminal task failed")
    release_lock = AsyncMock()
    with (
        patch(
            "uniffy.domains.search.jobs._acquire_lock",
            AsyncMock(return_value="owner-token"),
        ),
        patch(
            "uniffy.domains.search.jobs._release_lock",
            release_lock,
        ),
        patch("uniffy.domains.search.jobs.open_session", open_session),
        patch(
            "uniffy.domains.search.jobs.get_meilisearch_client",
            return_value=meili,
        ),
    ):
        result = await flush_search_removals({})

    assert result == {"status": "completed", "flushed": 0, "failed": 1, "dropped": 0}
    assert row.attempts == 1
    session.delete.assert_not_awaited()
    session.commit.assert_awaited_once()
    release_lock.assert_awaited_once_with("owner-token")
