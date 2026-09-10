from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import NotFoundError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import (
    ChatMessage,
    ChatMessageMetadataKind,
    ChatMessageVisibility,
    SenderType,
)
from uniffy.core.types import AccessMode, ContentRole, SubjectType, generate_id
from uniffy.domains.chat.agents import index_agent_message
from uniffy.domains.chat.senders import SenderInfo


@pytest.mark.parametrize(
    "channel_type", [ChannelType.PUBLIC, ChannelType.PRIVATE, ChannelType.DIRECT]
)
async def test_agent_preview_uses_chat_projection_and_channel_audience(
    channel_type: ChannelType,
) -> None:
    organization_id, user_id, agent_id = generate_id(), generate_id(), generate_id()
    channel = ChatChannel(
        organization_id=organization_id,
        owner_id=user_id,
        name="Planning",
        slug="planning",
        channel_type=channel_type,
    )
    message = ChatMessage(
        channel_id=channel.id,
        sender_id=agent_id,
        sender_type=SenderType.AGENT,
        content=f"Updated [[[Runbook|urn:uniffy:content:NOTE:{generate_id()}]]]",
        message_metadata={"kind": ChatMessageMetadataKind.FINAL},
    )
    indexer = MagicMock(index=AsyncMock())
    with (
        patch(
            "uniffy.domains.chat.access.ChatAccessChecker.get_channel",
            AsyncMock(return_value=channel),
        ) as get_channel,
        patch(
            "uniffy.domains.chat.messages.delivery.fetch_channel_members",
            AsyncMock(
                return_value=[
                    {"subject_type": SubjectType.USER.value, "user_id": str(user_id)},
                    {"subject_type": SubjectType.AGENT.value, "user_id": None},
                ]
            ),
        ),
        patch(
            "uniffy.domains.chat.messages.indexing.SenderResolver.resolve_one",
            AsyncMock(
                return_value=SenderInfo(
                    id=agent_id,
                    sender_type=SenderType.AGENT,
                    display_name="Planner",
                )
            ),
        ),
        patch("uniffy.domains.chat.messages.indexing.publish_mention_state", AsyncMock()),
    ):
        await index_agent_message(MagicMock(), indexer, message, organization_id)

    get_channel.assert_awaited_once_with(channel.id, organization_id)
    document = indexer.index.await_args.kwargs
    assert document["urn"] == f"urn:uniffy:content:CHAT_MESSAGE:{message.id}"
    assert document["title"] == "Updated Runbook"
    assert document["description"] == "Updated Runbook"
    assert document["organization_id"] == organization_id
    assert document["url_path"] == f"/chat/{channel.id}#{message.id}"
    assert document["metadata"]["sender_name"] == "Planner"
    if channel_type == ChannelType.PUBLIC:
        assert document["access_mode"] == AccessMode.OPEN_TO_ORG
        assert document["baseline_role"] == ContentRole.VIEWER
        assert document["shared_user_ids"] is None
    else:
        assert document["access_mode"] == AccessMode.EXPLICIT_MEMBERS
        assert document["baseline_role"] is None
        assert document["shared_user_ids"] == [user_id]


@pytest.mark.parametrize(
    "metadata",
    [{"kind": kind} for kind in ChatMessageMetadataKind if kind != ChatMessageMetadataKind.FINAL]
    + [
        {"visibility": ChatMessageVisibility.AGENT_INTERNAL},
        {"streaming": True},
        {"streaming": "true"},
        {"was_cancelled": True},
        {"was_cancelled": "True"},
    ],
)
async def test_nonfinal_or_hidden_agent_rows_never_enter_search(metadata: dict) -> None:
    message = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.AGENT,
        content="Internal runtime content",
        message_metadata=metadata,
    )
    indexer = MagicMock(index=AsyncMock())
    with patch(
        "uniffy.domains.chat.access.ChatAccessChecker.get_channel", AsyncMock()
    ) as get_channel:
        await index_agent_message(MagicMock(), indexer, message, generate_id())

    get_channel.assert_not_awaited()
    indexer.index.assert_not_awaited()


@pytest.mark.parametrize(
    "content,is_deleted", [("", False), (" \n ", False), ("Removed reply", True)]
)
async def test_empty_or_deleted_agent_reply_is_not_indexed(content: str, is_deleted: bool) -> None:
    message = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.AGENT,
        content=content,
        is_deleted=is_deleted,
    )
    indexer = MagicMock(index=AsyncMock())
    with patch(
        "uniffy.domains.chat.access.ChatAccessChecker.get_channel", AsyncMock()
    ) as get_channel:
        await index_agent_message(MagicMock(), indexer, message, generate_id())

    get_channel.assert_not_awaited()
    indexer.index.assert_not_awaited()


async def test_missing_or_cross_org_channel_cannot_publish_agent_preview() -> None:
    message = ChatMessage(
        channel_id=generate_id(),
        sender_id=generate_id(),
        sender_type=SenderType.AGENT,
        content="An answer",
    )
    indexer = MagicMock(index=AsyncMock())
    with patch(
        "uniffy.domains.chat.access.ChatAccessChecker.get_channel",
        AsyncMock(side_effect=NotFoundError("channel", message.channel_id)),
    ):
        await index_agent_message(MagicMock(), indexer, message, generate_id())

    indexer.index.assert_not_awaited()
