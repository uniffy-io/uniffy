"""A thread reply broadcast to its channel: two rows, one of everything else."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKey, SenderType
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.converters import (
    public_message_metadata,
    thread_reply_context_to_proto,
)
from uniffy.domains.chat.messages.sending import MessageSender

CHANNEL = generate_id()
ROOT = generate_id()
ORG = generate_id()
USER = generate_id()
NOW = datetime(2026, 9, 14, 10, 0, tzinfo=UTC)


def _sender() -> MessageSender:
    sender = MessageSender()
    session = MagicMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    sender.session = session
    sender.storage = MagicMock()
    sender.search_indexer = MagicMock()
    return sender


def _reply() -> ChatMessage:
    reply = ChatMessage(
        channel_id=CHANNEL,
        sender_id=USER,
        sender_type=SenderType.USER,
        content="We are going with Postgres 18",
        root_id=ROOT,
    )
    reply.id = generate_id()
    return reply


async def _stage(sender: MessageSender, reply: ChatMessage, **overrides) -> ChatMessage:
    kwargs = {
        "user_id": USER,
        "organization_id": ORG,
        "channel_id": CHANNEL,
        "root_id": ROOT,
        "content": reply.content,
        "urn_mentions": [],
        "attachment_file_ids": None,
        "at": NOW,
    }
    kwargs.update(overrides)
    return await sender._stage_channel_copy(reply, **kwargs)


class TestChannelCopyRow:
    async def test_copy_is_a_root_row_pointing_at_both_ids(self) -> None:
        sender = _sender()
        reply = _reply()

        copy = await _stage(sender, reply)

        # Only root rows carry ThreadInfo, so the copy must not be a reply itself.
        assert copy.root_id is None
        raw = copy.message_metadata[ChatMessageMetadataKey.THREAD_REPLY.value]
        assert raw == {"root_message_id": str(ROOT), "reply_message_id": str(reply.id)}

    async def test_copy_carries_the_same_content_and_mentions(self) -> None:
        sender = _sender()
        reply = _reply()
        urns = [f"urn:uniffy:content:USER:{generate_id()}"]

        copy = await _stage(sender, reply, urn_mentions=urns)

        assert copy.content == reply.content
        # The reply is excluded from the channel unread aggregate, so the badge's
        # mention count can only come from the copy.
        assert copy.mentioned_urns == urns

    async def test_copy_never_triggers_a_second_agent_run(self) -> None:
        sender = _sender()

        copy = await _stage(sender, _reply())

        assert copy.mentioned_agent_ids is None

    async def test_copy_joins_the_callers_transaction(self) -> None:
        sender = _sender()

        await _stage(sender, _reply())

        # The pair exists whole or not at all; staging must never commit.
        sender.session.commit.assert_not_awaited()
        sender.session.flush.assert_awaited()


class TestFlagValidation:
    async def test_flag_without_a_root_id_is_rejected(self) -> None:
        sender = _sender()
        sender.access = MagicMock()

        with pytest.raises(ValidationError):
            await sender.send_message(
                user_id=USER,
                organization_id=ORG,
                channel_id=CHANNEL,
                content="hello",
                root_id=None,
                also_send_to_channel=True,
            )


class TestProjection:
    def test_context_is_projected_from_the_metadata(self) -> None:
        reply_id = generate_id()
        metadata = {
            ChatMessageMetadataKey.THREAD_REPLY.value: {
                "root_message_id": str(ROOT),
                "reply_message_id": str(reply_id),
            }
        }

        proto = thread_reply_context_to_proto(metadata)

        assert proto is not None
        assert proto.root_message_id == str(ROOT)
        assert proto.reply_message_id == str(reply_id)

    def test_raw_key_never_reaches_the_public_metadata_map(self) -> None:
        metadata = {
            ChatMessageMetadataKey.THREAD_REPLY.value: {
                "root_message_id": str(ROOT),
                "reply_message_id": str(generate_id()),
            },
            "kind": "tool_call",
        }

        assert public_message_metadata(metadata) == {"kind": "tool_call"}

    def test_incomplete_metadata_projects_nothing(self) -> None:
        metadata = {
            ChatMessageMetadataKey.THREAD_REPLY.value: {"root_message_id": str(ROOT)},
        }

        assert thread_reply_context_to_proto(metadata) is None

    def test_a_plain_message_has_no_context(self) -> None:
        assert thread_reply_context_to_proto(None) is None
        assert thread_reply_context_to_proto({"kind": "tool_call"}) is None
