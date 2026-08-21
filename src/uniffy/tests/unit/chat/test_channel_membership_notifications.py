"""Channel membership notification emission."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.types import NotificationType, generate_id
from uniffy.domains.chat.channels.operations import ChatChannelOperations


def _channel() -> ChatChannel:
    return ChatChannel(
        organization_id=generate_id(),
        owner_id=generate_id(),
        name="private-team",
        slug="private-team",
        channel_type=ChannelType.PRIVATE,
    )


async def test_added_members_receive_one_deduplicated_invite() -> None:
    channel = _channel()
    actor_id = generate_id()
    target_id = generate_id()
    operations = ChatChannelOperations(MagicMock())

    with patch(
        "uniffy.domains.chat.channels.operations.emit_notification",
        new=AsyncMock(),
    ) as emit:
        await operations._notify_membership_changed(
            channel,
            actor_user_id=actor_id,
            target_user_ids=[actor_id, target_id, target_id],
            added=True,
        )

    event = emit.await_args.args[0]
    assert event.notification_type == NotificationType.CHAT_CHANNEL_INVITE
    assert event.target_user_ids == [target_id]
    assert event.metadata == {
        "channel_id": str(channel.id),
        "channel_name": "private-team",
        "channel_type": ChannelType.PRIVATE.value,
    }


async def test_removed_members_receive_a_removal_notification() -> None:
    channel = _channel()
    actor_id = generate_id()
    target_id = generate_id()
    operations = ChatChannelOperations(MagicMock())

    with patch(
        "uniffy.domains.chat.channels.operations.emit_notification",
        new=AsyncMock(),
    ) as emit:
        await operations._notify_membership_changed(
            channel,
            actor_user_id=actor_id,
            target_user_ids=[target_id],
            added=False,
        )

    event = emit.await_args.args[0]
    assert event.notification_type == NotificationType.CHAT_CHANNEL_REMOVED
    assert event.target_user_ids == [target_id]


async def test_actor_only_membership_change_emits_nothing() -> None:
    channel = _channel()
    actor_id = generate_id()
    operations = ChatChannelOperations(MagicMock())

    with patch(
        "uniffy.domains.chat.channels.operations.emit_notification",
        new=AsyncMock(),
    ) as emit:
        await operations._notify_membership_changed(
            channel,
            actor_user_id=actor_id,
            target_user_ids=[actor_id],
            added=True,
        )

    emit.assert_not_awaited()
