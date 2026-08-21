"""Broadcast mention extraction, policy gate, and send fan-out."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.content.references import (
    BroadcastMention,
    broadcast_urn,
    extract_all_outgoing_references,
    extract_broadcast_mentions_from_content,
    strip_broadcast_urns,
)
from uniffy.core.errors import PermissionDeniedError
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChannelRole, ChatChannelMember
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.shared import NotificationType
from uniffy.core.types import SubjectType, generate_id
from uniffy.domains.chat.messages.operations import ChatMessageOperations
from uniffy.domains.chat.policy import BroadcastMinRole, ResolvedChatPolicy

ORG = generate_id()

CHANNEL_URN = broadcast_urn(BroadcastMention.CHANNEL)
HERE_URN = broadcast_urn(BroadcastMention.HERE)


def _channel(channel_type: ChannelType = ChannelType.PUBLIC) -> ChatChannel:
    return ChatChannel(
        organization_id=ORG,
        owner_id=generate_id(),
        name="general",
        slug="general",
        description="",
        channel_type=channel_type,
    )


def _message(channel_id, sender_id, content="hello") -> ChatMessage:
    return ChatMessage(
        channel_id=channel_id,
        sender_id=sender_id,
        sender_type=SenderType.USER,
        content=content,
    )


def _member(role: ChannelRole = ChannelRole.MEMBER) -> ChatChannelMember:
    user_id = generate_id()
    return ChatChannelMember(
        channel_id=generate_id(),
        subject_type=SubjectType.USER,
        subject_id=user_id,
        user_id=user_id,
        role=role,
    )


def _rows_result(rows):
    result = MagicMock()
    result.all = MagicMock(return_value=rows)
    return result


def _ops(execute_results=None) -> ChatMessageOperations:
    session = MagicMock()
    if execute_results is None:
        session.execute = AsyncMock(return_value=_rows_result([]))
    else:
        session.execute = AsyncMock(side_effect=execute_results)
    access = MagicMock()
    access.filter_viewers = AsyncMock(return_value=[])
    access.is_org_admin = AsyncMock(return_value=False)
    access.is_chat_domain_admin = AsyncMock(return_value=False)
    return ChatMessageOperations(session, access=access)


class TestExtraction:
    def test_both_kinds_extract(self) -> None:
        content = f"[[[@channel|{CHANNEL_URN}]]] [[[@here|{HERE_URN}]]]"
        assert extract_broadcast_mentions_from_content(content) == {
            BroadcastMention.CHANNEL,
            BroadcastMention.HERE,
        }

    def test_plain_text_at_channel_is_not_a_broadcast(self) -> None:
        assert extract_broadcast_mentions_from_content("hey @channel wake up") == set()

    def test_unknown_broadcast_kind_is_ignored(self) -> None:
        content = (
            "[[[@admins|urn:uniffy:broadcast:admins]]] "
            "[[[@everyone|urn:uniffy:broadcast:everyone]]]"
        )
        assert extract_broadcast_mentions_from_content(content) == set()

    def test_broadcast_urns_land_in_outgoing_references(self) -> None:
        content = f"ship it [[[@channel|{CHANNEL_URN}]]]"
        assert extract_all_outgoing_references(content) == [CHANNEL_URN]

    def test_strip_broadcast_urns_keeps_content_urns(self) -> None:
        user_urn = f"urn:uniffy:content:USER:{generate_id()}"
        assert strip_broadcast_urns([CHANNEL_URN, user_urn, HERE_URN]) == [user_urn]


class TestEffectiveKind:
    def test_here_with_channel_widens_to_channel(self) -> None:
        kind = ChatMessageOperations._effective_broadcast_kind({
            BroadcastMention.HERE,
            BroadcastMention.CHANNEL,
        })
        assert kind is BroadcastMention.CHANNEL

    def test_here_alone_stays_here(self) -> None:
        kind = ChatMessageOperations._effective_broadcast_kind({BroadcastMention.HERE})
        assert kind is BroadcastMention.HERE


def _policy(min_role: BroadcastMinRole) -> ResolvedChatPolicy:
    return ResolvedChatPolicy(organization_id=ORG, broadcast_min_role=min_role)


def _policy_patch(min_role: BroadcastMinRole):
    # Bound at import in operations, so the patch targets the consumer module.
    return patch(
        "uniffy.domains.chat.messages.operations.resolve_chat_policy",
        AsyncMock(return_value=_policy(min_role)),
    )


class TestBroadcastGate:
    async def test_member_policy_allows_everyone(self) -> None:
        ops = _ops()
        with _policy_patch(BroadcastMinRole.MEMBER):
            await ops._require_broadcast_allowed(generate_id(), _channel(), _member())

    async def test_admin_policy_rejects_plain_member(self) -> None:
        ops = _ops()
        with _policy_patch(BroadcastMinRole.ADMIN), pytest.raises(PermissionDeniedError):
            await ops._require_broadcast_allowed(generate_id(), _channel(), _member())

    async def test_admin_policy_allows_channel_admin(self) -> None:
        ops = _ops()
        with _policy_patch(BroadcastMinRole.ADMIN):
            await ops._require_broadcast_allowed(
                generate_id(), _channel(), _member(ChannelRole.ADMIN)
            )

    async def test_admin_policy_allows_org_admin_without_channel_role(self) -> None:
        ops = _ops()
        ops.access.is_org_admin = AsyncMock(return_value=True)
        with _policy_patch(BroadcastMinRole.ADMIN):
            await ops._require_broadcast_allowed(generate_id(), _channel(), _member())

    async def test_admin_policy_rejects_missing_membership(self) -> None:
        ops = _ops()
        with _policy_patch(BroadcastMinRole.ADMIN), pytest.raises(PermissionDeniedError):
            await ops._require_broadcast_allowed(generate_id(), _channel(), None)


def _pref_row(user_id, is_muted=False, level=None):
    from uniffy.core.models.chat.channel_member import ChatNotificationLevel

    return (user_id, is_muted, level or ChatNotificationLevel.ALL)


class TestBroadcastFanout:
    async def _run(self, channel, message, member_ids, *, pref_rows=(), online=None):
        ops = _ops([_rows_result(list(pref_rows))])
        ops._index_message = AsyncMock()
        ops._update_resources = AsyncMock()
        ops._publish_unread_notifications = AsyncMock()
        ops._emit_send_notifications = AsyncMock()
        if online is not None:
            ops._online_member_ids = AsyncMock(return_value=set(online))
        with patch(
            "uniffy.domains.chat.drafts.operations.ChatDraftOperations.clear_for_send",
            AsyncMock(),
        ):
            await ops._background_post_send(
                message, channel, message.sender_id, None, "Ada", member_ids
            )
        return ops

    async def test_channel_broadcast_badges_and_notifies_all_members(self) -> None:
        sender, a, b = generate_id(), generate_id(), generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, sender, f"[[[@channel|{CHANNEL_URN}]]] standup")

        ops = await self._run(channel, message, [sender, a, b])

        unread_mentioned = ops._publish_unread_notifications.call_args.args[3]
        assert unread_mentioned == {a, b}
        emit_kwargs = ops._emit_send_notifications.call_args.kwargs
        assert emit_kwargs["broadcast_kind"] is BroadcastMention.CHANNEL
        assert emit_kwargs["broadcast_target_ids"] == {a, b}

    async def test_here_notifies_online_only_but_badges_everyone(self) -> None:
        sender, online_user, offline_user = generate_id(), generate_id(), generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, sender, f"[[[@here|{HERE_URN}]]] quick sync")

        ops = await self._run(
            channel, message, [sender, online_user, offline_user], online=[online_user]
        )

        unread_mentioned = ops._publish_unread_notifications.call_args.args[3]
        assert unread_mentioned == {online_user, offline_user}
        emit_kwargs = ops._emit_send_notifications.call_args.kwargs
        assert emit_kwargs["broadcast_kind"] is BroadcastMention.HERE
        assert emit_kwargs["broadcast_target_ids"] == {online_user}

    async def test_muted_and_none_members_badge_but_are_not_notified(self) -> None:
        from uniffy.core.models.chat.channel_member import ChatNotificationLevel

        sender, muted, silent, normal = (
            generate_id(),
            generate_id(),
            generate_id(),
            generate_id(),
        )
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, sender, f"[[[@channel|{CHANNEL_URN}]]] all hands")

        ops = await self._run(
            channel,
            message,
            [sender, muted, silent, normal],
            pref_rows=[
                _pref_row(muted, is_muted=True),
                _pref_row(silent, level=ChatNotificationLevel.NONE),
                _pref_row(normal),
            ],
        )

        unread_mentioned = ops._publish_unread_notifications.call_args.args[3]
        assert unread_mentioned == {muted, silent, normal}
        emit_kwargs = ops._emit_send_notifications.call_args.kwargs
        assert emit_kwargs["broadcast_target_ids"] == {normal}

    async def test_system_message_broadcast_markup_pings_nobody(self) -> None:
        actor = generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, actor, f"[[[@channel|{CHANNEL_URN}]]]")
        message.sender_type = SenderType.SYSTEM

        ops = await self._run(channel, message, [actor, generate_id()])

        emit_kwargs = ops._emit_send_notifications.call_args.kwargs
        assert emit_kwargs["broadcast_kind"] is None
        assert emit_kwargs["broadcast_target_ids"] == set()


class TestBroadcastNotificationEmit:
    async def _emit(self, channel, sender, member_ids, *, kind, targets):
        emitted: list = []

        async def _capture(event):
            emitted.append(event)

        stream_mock = AsyncMock()

        async def _fan_out(events):
            for user_id, event_type, payload in events:
                await stream_mock(user_id, event_type, payload)

        ops = _ops()
        message = _message(channel.id, sender, "ship it")
        with (
            patch(
                "uniffy.core.events.bus.emit_notification",
                AsyncMock(side_effect=_capture),
            ),
            patch(
                "uniffy.domains.chat.streaming.publisher.publish_user_chat_event",
                stream_mock,
            ),
            patch(
                "uniffy.domains.chat.streaming.publisher.publish_user_chat_events",
                AsyncMock(side_effect=_fan_out),
            ),
        ):
            await ops._emit_send_notifications(
                message,
                channel,
                sender,
                None,
                "Ada",
                member_ids,
                set(),
                None,
                broadcast_kind=kind,
                broadcast_target_ids=targets,
            )
        return emitted, stream_mock

    async def test_broadcast_event_carries_kind_metadata(self) -> None:
        sender, member = generate_id(), generate_id()
        channel = _channel()

        emitted, stream = await self._emit(
            channel,
            sender,
            [sender, member],
            kind=BroadcastMention.CHANNEL,
            targets={member},
        )

        assert len(emitted) == 1
        event = emitted[0]
        assert event.notification_type is NotificationType.CHAT_MENTION
        assert event.title == "Mentioned everyone in #general"
        assert event.target_user_ids == [member]
        assert event.metadata["broadcast"] == "channel"
        assert stream.await_count == 1

    async def test_here_copy_differs_and_sender_is_excluded(self) -> None:
        sender, member = generate_id(), generate_id()
        channel = _channel()

        emitted, _ = await self._emit(
            channel,
            sender,
            [sender, member],
            kind=BroadcastMention.HERE,
            targets={sender, member},
        )

        assert len(emitted) == 1
        assert emitted[0].title == "Mentioned everyone active in #general"
        assert emitted[0].target_user_ids == [member]

    async def test_dm_recipients_exclude_broadcast_notified_users(self) -> None:
        sender, peer = generate_id(), generate_id()
        channel = _channel(ChannelType.GROUP_DM)

        emitted, _ = await self._emit(
            channel,
            sender,
            [sender, peer],
            kind=BroadcastMention.CHANNEL,
            targets={peer},
        )

        assert [e.notification_type for e in emitted] == [NotificationType.CHAT_MENTION]
        assert emitted[0].metadata["broadcast"] == "channel"
