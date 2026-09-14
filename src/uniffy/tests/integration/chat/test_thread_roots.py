"""Only channel messages can serve as thread roots."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.draft import ChatDraft
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.chat.thread import ChatThread, ChatThreadStats
from uniffy.core.types import generate_id
from uniffy.domains.chat.drafts.operations import ChatDraftOperations
from uniffy.domains.chat.messages import sending
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.threads.operations import ChatThreadOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.mark.parametrize("root_attribute", ["root_a_id", "channel_last_id"])
async def test_channel_message_opens_thread(session, threads, root_attribute) -> None:
    root_id = getattr(threads, root_attribute)
    ops = ChatThreadOperations(session)

    root, *_ = await ops.get_thread(threads.user_id, threads.org_id, threads.channel_id, root_id)
    replies, has_more = await ops.get_thread_messages(
        threads.user_id, threads.org_id, threads.channel_id, root_id
    )

    assert root.id == root_id
    assert root.root_id is None
    assert [reply.id for reply in replies] == (
        [threads.reply_a_user_id, threads.reply_a_agent_id] if root_id == threads.root_a_id else []
    )
    assert has_more is False


@pytest.mark.parametrize("reply_attribute", ["reply_a_user_id", "reply_a_agent_id"])
@pytest.mark.parametrize("method", ["get_thread", "get_thread_messages"])
async def test_reply_cannot_open_nested_thread(session, threads, reply_attribute, method) -> None:
    operation = getattr(ChatThreadOperations(session), method)

    with pytest.raises(ValidationError, match="Thread replies cannot start another thread"):
        await operation(
            threads.user_id,
            threads.org_id,
            threads.channel_id,
            getattr(threads, reply_attribute),
        )


async def test_thread_read_rejects_root_outside_channel(session, threads) -> None:
    ops = ChatThreadOperations(session)
    other_channel = ChatChannel(
        organization_id=threads.org_id,
        owner_id=threads.user_id,
        name="Other channel",
        slug=f"other-{generate_id()}",
        channel_type=ChannelType.PRIVATE,
    )
    session.add(other_channel)
    await session.flush()
    root = ChatMessage(
        channel_id=other_channel.id,
        sender_id=threads.user_id,
        sender_type=SenderType.USER,
        content="root outside requested channel",
    )
    session.add(root)
    await session.flush()

    with pytest.raises(NotFoundError):
        await ops.get_thread_messages(threads.user_id, threads.org_id, threads.channel_id, root.id)
    await session.rollback()


async def test_send_rejects_nested_reply_without_writes(session, threads, monkeypatch) -> None:
    monkeypatch.setattr(sending, "check_chat_mutation_limit", AsyncMock())
    ops = ChatMessageOperations(session)

    with pytest.raises(ValidationError, match="flat threads only"):
        await ops.send_message(
            threads.user_id,
            threads.org_id,
            threads.channel_id,
            "nested reply",
            root_id=threads.reply_a_user_id,
        )

    assert (
        await session.execute(
            select(ChatMessage).where(ChatMessage.root_id == threads.reply_a_user_id)
        )
    ).scalars().all() == []
    assert (
        await session.execute(
            select(ChatThread).where(ChatThread.root_message_id == threads.reply_a_user_id)
        )
    ).scalar_one_or_none() is None
    stats = (
        await session.execute(
            select(ChatThreadStats).where(ChatThreadStats.root_message_id == threads.root_a_id)
        )
    ).scalar_one()
    assert stats.reply_count == 2


async def test_draft_rejects_nested_reply_without_writes(session, threads) -> None:
    ops = ChatDraftOperations(session)

    with pytest.raises(ValidationError, match="Thread replies cannot start another thread"):
        await ops.save_draft(
            threads.user_id,
            threads.org_id,
            threads.channel_id,
            threads.reply_a_user_id,
            "nested draft",
        )

    assert (
        await session.execute(select(ChatDraft).where(ChatDraft.channel_id == threads.channel_id))
    ).scalars().all() == []
