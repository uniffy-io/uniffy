"""A thread reply broadcast to its channel: two rows, one of everything else."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage, ChatMessageMetadataKey, SenderType
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.broadcasts import (
    released_resource_content,
    remap_file_references,
)
from uniffy.domains.chat.messages.converters import (
    public_message_metadata,
    thread_reply_context_to_proto,
)
from uniffy.domains.chat.messages.operations import ChatMessageOperations
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


async def test_broadcast_post_commit_invokes_agent_and_queues_delivery_once():
    sender = _sender()
    reply = _reply()
    copy = await _stage(sender, reply)
    channel = ChatChannel(
        id=CHANNEL,
        organization_id=ORG,
        owner_id=USER,
        name="Test",
        slug="test",
        channel_type=ChannelType.PUBLIC,
    )
    sender._get_channel_member_ids = AsyncMock(return_value=[USER])
    sender._publish_send_event = AsyncMock()
    sender._maybe_trigger_agents = AsyncMock()
    with (
        patch(
            "uniffy.domains.chat.messages.sending.ChatReadStateOperations", return_value=AsyncMock()
        ),
        patch("uniffy.domains.chat.messages.sending.enqueue_job", AsyncMock()) as enqueue,
    ):
        await sender._post_commit_send(
            reply,
            channel,
            USER,
            ROOT,
            NOW,
            "Sender",
            "",
            channel_copy=copy,
        )
    sender._maybe_trigger_agents.assert_awaited_once_with(reply, channel)
    enqueue.assert_awaited_once()
    assert [call.args[0].id for call in sender._publish_send_event.await_args_list] == [
        reply.id,
        copy.id,
    ]


def test_file_mapping_preserves_labels_other_types_and_foreign_org_urls():
    source, target, foreign_org = generate_id(), generate_id(), generate_id()
    source_urn = f"urn:uniffy:content:FILE:{source}"
    target_urn = f"urn:uniffy:content:FILE:{target}"
    content = (
        f"[[[{source_urn}|{source_urn}]]] "
        f"[[[person|urn:uniffy:content:USER:{source}]]] "
        f"![media](/api/files/{ORG}/{source}) "
        f"/api/files/{foreign_org}/{source}"
    )
    result = remap_file_references(content, ORG, {source: target})
    assert result == (
        f"[[[{source_urn}|{target_urn}]]] "
        f"[[[person|urn:uniffy:content:USER:{source}]]] "
        f"![media](/api/files/{ORG}/{target}) "
        f"/api/files/{foreign_org}/{source}"
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


class TestReleasedResources:
    """Which body the resource counter gives back when a row is deleted."""

    @staticmethod
    def _row(*, root_id, content: str, deleted: bool = False) -> ChatMessage:
        row = ChatMessage(
            channel_id=CHANNEL,
            sender_id=USER,
            sender_type=SenderType.USER,
            content=content,
            root_id=root_id,
        )
        row.id = generate_id()
        row.is_deleted = deleted
        return row

    def test_a_plain_message_releases_its_own_body(self) -> None:
        message = self._row(root_id=None, content="root")

        assert released_resource_content(message, None) == "root"

    def test_a_surviving_peer_keeps_the_count(self) -> None:
        reply = self._row(root_id=ROOT, content="reply")
        copy = self._row(root_id=None, content="copy")

        assert released_resource_content(copy, reply) is None
        assert released_resource_content(reply, copy) is None

    def test_the_last_copy_releases_the_reply_body_that_was_counted(self) -> None:
        reply = self._row(root_id=ROOT, content="reply", deleted=True)
        copy = self._row(root_id=None, content="copy")

        assert released_resource_content(copy, reply) == "reply"

    def test_the_last_reply_releases_its_own_body(self) -> None:
        reply = self._row(root_id=ROOT, content="reply")
        copy = self._row(root_id=None, content="copy", deleted=True)

        assert released_resource_content(reply, copy) == "reply"


class TestUnreadDeltaAnchor:
    """The send delta names the root row the badge is about, and only a root row."""

    @staticmethod
    async def _post_send(message: ChatMessage, copy: ChatMessage | None) -> AsyncMock:
        operations = ChatMessageOperations(MagicMock(), search_indexer=MagicMock())
        operations.session.execute = AsyncMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        operations.access = MagicMock()
        operations.access.filter_viewers = AsyncMock(return_value=[])
        operations._index_message = AsyncMock()
        operations._update_resources = AsyncMock()
        operations._publish_unread_notifications = AsyncMock()
        operations._emit_send_notifications = AsyncMock()
        channel = ChatChannel(
            id=CHANNEL,
            organization_id=ORG,
            owner_id=USER,
            name="Test",
            slug="test",
            channel_type=ChannelType.PUBLIC,
        )
        with patch(
            "uniffy.domains.chat.drafts.operations.ChatDraftOperations.clear_for_send",
            AsyncMock(),
        ):
            await operations.background_post_send(
                message, channel, USER, message.root_id, "Ada", [USER], index_message=copy
            )
        return operations._publish_unread_notifications

    async def test_a_root_message_anchors_on_itself(self) -> None:
        message = _reply()
        message.root_id = None

        publish = await self._post_send(message, None)

        assert publish.await_args.kwargs == {"message_id": message.id}

    async def test_a_broadcast_anchors_on_its_channel_copy(self) -> None:
        sender = _sender()
        reply = _reply()
        copy = await _stage(sender, reply)

        publish = await self._post_send(reply, copy)

        assert publish.await_args.kwargs == {"message_id": copy.id}

    async def test_a_plain_thread_reply_carries_no_anchor(self) -> None:
        publish = await self._post_send(_reply(), None)

        assert publish.await_args.kwargs == {"message_id": None}
