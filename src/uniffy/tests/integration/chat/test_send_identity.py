import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from uniffy.core.errors import ValidationError
from uniffy.core.models.chat.channel import ChatChannelStats
from uniffy.core.models.chat.message import ChatMessage
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages import sending
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.infrastructure.database import open_session

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_concurrent_retries_create_one_message(threads, session, monkeypatch):
    monkeypatch.setattr(sending, "check_chat_mutation_limit", AsyncMock())
    effects = AsyncMock()
    monkeypatch.setattr(ChatMessageOperations, "_post_commit_send", effects)
    client_id = generate_id()

    async def send(content="Retry test"):
        async with open_session() as transaction:
            message, _, _ = await ChatMessageOperations(transaction).send_message(
                user_id=threads.user_id,
                organization_id=threads.org_id,
                channel_id=threads.channel_id,
                content=content,
                client_message_id=client_id,
                message_metadata={"ui_hint": "preserved"},
            )
            return message.id

    first, second = await asyncio.wait_for(asyncio.gather(send(), send()), timeout=10)
    assert first == second
    assert (
        await session.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.client_message_id == client_id)
        )
        == 1
    )
    effects.assert_awaited_once()
    assert (
        await session.scalar(
            select(ChatChannelStats.message_count).where(
                ChatChannelStats.channel_id == threads.channel_id
            )
        )
        == 1
    )
    stored = await session.get(ChatMessage, first)
    assert stored.message_metadata == {"ui_hint": "preserved"}
    with pytest.raises(ValidationError):
        await send("Changed payload")


async def test_rolled_back_send_can_retry_same_identity(threads, session, monkeypatch):
    monkeypatch.setattr(sending, "check_chat_mutation_limit", AsyncMock())
    effects = AsyncMock()
    monkeypatch.setattr(ChatMessageOperations, "_post_commit_send", effects)
    client_id = generate_id()
    bump = sending.bump_channel_message_stats
    monkeypatch.setattr(
        sending,
        "bump_channel_message_stats",
        AsyncMock(side_effect=RuntimeError("Injected failure")),
    )

    async def send():
        async with open_session() as transaction:
            return await ChatMessageOperations(transaction).send_message(
                user_id=threads.user_id,
                organization_id=threads.org_id,
                channel_id=threads.channel_id,
                content="Retry after rollback",
                client_message_id=client_id,
            )

    with pytest.raises(RuntimeError, match="Injected failure"):
        await send()
    assert (
        await session.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.client_message_id == client_id)
        )
        == 0
    )
    monkeypatch.setattr(sending, "bump_channel_message_stats", bump)
    message, _, _ = await send()
    assert message.client_message_id == client_id
    effects.assert_awaited_once()
