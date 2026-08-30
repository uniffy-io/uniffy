from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.database import SESSION_FACTORY_CTX_KEY
from uniffy.core.json_codec import dumps_str
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.domains.chat.jobs.contracts import POST_SEND_CHAT_MESSAGE, REFRESH_CHAT_SEARCH_ACL
from uniffy.domains.chat.jobs.jobs import (
    flush_chat_search_acl_refreshes,
    post_send_chat_message,
)
from uniffy.domains.chat.messages.operations import ChatMessageOperations


async def test_committed_message_enqueues_owner_post_send_job() -> None:
    message_id = uuid4()
    channel_id = uuid4()
    user_id = uuid4()
    root_id = uuid4()
    member_ids = [uuid4(), uuid4()]
    message = SimpleNamespace(id=message_id, sender_type=SenderType.AGENT)
    channel = SimpleNamespace(id=channel_id)
    operations = ChatMessageOperations(MagicMock(), search_indexer=MagicMock())
    operations._get_channel_member_ids = AsyncMock(return_value=member_ids)
    operations._publish_send_event = AsyncMock()
    operations._maybe_trigger_agents = AsyncMock()
    enqueue = AsyncMock()

    with patch("uniffy.domains.chat.messages.operations.enqueue_job", enqueue):
        await operations._post_commit_send(
            message,
            channel,
            user_id,
            root_id,
            datetime.now(UTC),
            "Ada",
            "",
        )

    enqueue.assert_awaited_once_with(
        POST_SEND_CHAT_MESSAGE,
        str(message_id),
        str(channel_id),
        str(user_id),
        str(root_id),
        "Ada",
        dumps_str([str(member_id) for member_id in member_ids]),
    )


async def test_post_send_uses_worker_composed_dependencies() -> None:
    message_id = uuid4()
    channel_id = uuid4()
    user_id = uuid4()
    root_id = uuid4()
    member_ids = [uuid4(), uuid4()]
    message = SimpleNamespace(id=message_id)
    channel = SimpleNamespace(id=channel_id)
    session = AsyncMock()

    async def get(model: type, object_id: object) -> object | None:
        if model is ChatMessage and object_id == message_id:
            return message
        if model is ChatChannel and object_id == channel_id:
            return channel
        return None

    session.get.side_effect = get

    @asynccontextmanager
    async def session_factory() -> AsyncIterator[AsyncMock]:
        yield session

    search_indexer = MagicMock()
    operations = MagicMock()
    operations._background_post_send = AsyncMock()
    with patch(
        "uniffy.domains.chat.jobs.jobs.ChatMessageOperations",
        return_value=operations,
    ) as operations_factory:
        result = await post_send_chat_message(
            {
                SESSION_FACTORY_CTX_KEY: session_factory,
                SEARCH_INDEXER_CTX_KEY: search_indexer,
            },
            str(message_id),
            str(channel_id),
            str(user_id),
            str(root_id),
            "Ada",
            dumps_str([str(member_id) for member_id in member_ids]),
        )

    assert result == {"status": "success", "message_id": str(message_id)}
    operations_factory.assert_called_once_with(session, search_indexer=search_indexer)
    operations._background_post_send.assert_awaited_once_with(
        message,
        channel,
        user_id,
        root_id,
        "Ada",
        member_ids,
    )


async def test_post_send_skips_deleted_message_or_channel() -> None:
    session = AsyncMock()
    session.get.return_value = None

    @asynccontextmanager
    async def session_factory() -> AsyncIterator[AsyncMock]:
        yield session

    result = await post_send_chat_message(
        {
            SESSION_FACTORY_CTX_KEY: session_factory,
            SEARCH_INDEXER_CTX_KEY: MagicMock(),
        },
        str(uuid4()),
        str(uuid4()),
        str(uuid4()),
        None,
        "Ada",
        "[]",
    )

    assert result == {"status": "skipped", "reason": "message_or_channel_missing"}


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
