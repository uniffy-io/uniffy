from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from uniffy.core.search.indexer import SearchIndexer
from uniffy.core.search.meilisearch import MeilisearchClient


def _client_with_wait_result(status: str) -> MeilisearchClient:
    client = MeilisearchClient()
    sdk_client = AsyncMock()
    sdk_client.wait_for_task.return_value = SimpleNamespace(status=status)
    client._client = sdk_client
    return client


async def test_await_task_requires_terminal_success() -> None:
    client = _client_with_wait_result("failed")

    with pytest.raises(RuntimeError, match="did not succeed"):
        await client._await_task(SimpleNamespace(task_uid=41))


async def test_await_task_rejects_missing_task_identity() -> None:
    client = _client_with_wait_result("succeeded")

    with pytest.raises(RuntimeError, match="did not return a task"):
        await client._await_task(None)
    with pytest.raises(RuntimeError, match="no uid"):
        await client._await_task(SimpleNamespace())


async def test_remove_preserves_pending_row_when_acknowledgement_fails() -> None:
    row_id = uuid4()
    meili = AsyncMock()
    meili.delete_document.side_effect = RuntimeError("task failed")

    with (
        patch(
            "uniffy.core.search.indexer._record_pending_removal",
            AsyncMock(return_value=row_id),
        ),
        patch(
            "uniffy.core.search.indexer._clear_pending_removal",
            AsyncMock(),
        ) as clear,
        patch(
            "uniffy.core.search.meilisearch.get_meilisearch_client",
            return_value=meili,
        ),
    ):
        await SearchIndexer().remove(
            "urn:uniffy:content:NOTE:01900000-0000-7000-8000-000000000001",
            uuid4(),
        )

    clear.assert_not_awaited()


async def test_remove_clears_pending_row_after_confirmed_success() -> None:
    row_id = uuid4()
    meili = AsyncMock()

    with (
        patch(
            "uniffy.core.search.indexer._record_pending_removal",
            AsyncMock(return_value=row_id),
        ),
        patch(
            "uniffy.core.search.indexer._clear_pending_removal",
            AsyncMock(),
        ) as clear,
        patch(
            "uniffy.core.search.meilisearch.get_meilisearch_client",
            return_value=meili,
        ),
    ):
        await SearchIndexer().remove(
            "urn:uniffy:content:NOTE:01900000-0000-7000-8000-000000000001",
            uuid4(),
        )

    clear.assert_awaited_once_with(row_id)
