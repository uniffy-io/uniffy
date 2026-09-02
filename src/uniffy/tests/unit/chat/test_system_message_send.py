"""SYSTEM breadcrumbs must post regardless of the attributed user's channel membership."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.message import ChatMessageMetadataKind, SenderType
from uniffy.core.types import generate_id


def _build_channel(organization_id):
    channel = MagicMock()
    channel.id = generate_id()
    channel.organization_id = organization_id
    channel.is_agent_dm = False
    return channel


def _build_ops(channel):
    from uniffy.domains.chat.messages.operations import ChatMessageOperations

    session = MagicMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    access = MagicMock()
    access.get_channel = AsyncMock(return_value=channel)
    access.require_send = AsyncMock(
        side_effect=PermissionDeniedError("send", "Must join channel to send messages")
    )
    ops = ChatMessageOperations(session, access)
    return ops, access


async def test_system_sender_bypasses_membership_gate() -> None:
    org_id = generate_id()
    channel = _build_channel(org_id)
    ops, access = _build_ops(channel)

    with (
        patch("uniffy.domains.chat.messages.sending.bump_channel_message_stats", AsyncMock()),
        patch.object(ops, "_post_commit_send", AsyncMock()) as post_commit,
    ):
        message, _, _ = await ops.send_message(
            user_id=generate_id(),
            organization_id=org_id,
            channel_id=channel.id,
            content="Call ended - 5m 00s",
            message_metadata={"kind": ChatMessageMetadataKind.CALL_ENDED.value},
            sender_type=SenderType.SYSTEM,
        )

    access.require_send.assert_not_awaited()
    post_commit.assert_awaited_once()
    assert message.sender_type == SenderType.SYSTEM
    assert message.message_metadata == {"kind": ChatMessageMetadataKind.CALL_ENDED.value}


async def test_user_sender_still_requires_membership() -> None:
    org_id = generate_id()
    channel = _build_channel(org_id)
    ops, access = _build_ops(channel)

    with pytest.raises(PermissionDeniedError):
        await ops.send_message(
            user_id=generate_id(),
            organization_id=org_id,
            channel_id=channel.id,
            content="hello",
        )
    access.require_send.assert_awaited_once()
