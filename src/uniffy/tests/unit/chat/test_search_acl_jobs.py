from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from uniffy.domains.chat.jobs.contracts import REFRESH_CHAT_SEARCH_ACL
from uniffy.domains.chat.jobs.jobs import flush_chat_search_acl_refreshes


async def test_flush_uses_worker_valkey_pool() -> None:
    channel_id = uuid4()
    session = AsyncMock()
    session.execute.return_value = SimpleNamespace(all=lambda: [(channel_id, 0)])

    @asynccontextmanager
    async def open_session() -> AsyncIterator[AsyncMock]:
        yield session

    valkey = AsyncMock()
    with patch("uniffy.domains.chat.jobs.jobs.open_session", open_session):
        result = await flush_chat_search_acl_refreshes({"valkey": valkey})

    assert result == {"status": "complete", "enqueued": 1, "failed": 0}
    valkey.enqueue_job.assert_awaited_once_with(
        REFRESH_CHAT_SEARCH_ACL.name,
        str(channel_id),
    )
