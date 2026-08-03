"""Chat mention fan-out: who gets notified, who must not, and which copy they get.

DB calls are stubbed; these exercise the visibility set math and the emit chain
of ``ChatMessageOperations``.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.content.team_mentions import TeamExpansion
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.models.shared import NotificationType
from uniffy.core.types import generate_id
from uniffy.domains.chat.messages.operations import ChatMessageOperations

ORG = generate_id()


def _channel(channel_type: ChannelType = ChannelType.PUBLIC) -> ChatChannel:
    return ChatChannel(
        organization_id=ORG,
        owner_id=generate_id(),
        name="general",
        slug="general",
        description="",
        channel_type=channel_type,
    )


def _message(channel_id, sender_id) -> ChatMessage:
    return ChatMessage(
        channel_id=channel_id,
        sender_id=sender_id,
        sender_type=SenderType.USER,
        content="heads up team",
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
    return ChatMessageOperations(session, access=MagicMock())


class TestVisibleMentionTargets:
    async def test_member_channel_intersects_with_channel_members(self) -> None:
        inside, outside = generate_id(), generate_id()
        ops = _ops()
        expansion = TeamExpansion(generate_id(), "Engineering", (inside, outside))

        direct, teams = await ops._visible_mention_targets(
            _channel(ChannelType.PRIVATE), [inside], set(), [expansion]
        )

        assert direct == set()
        assert teams == [(expansion, [inside])]
        ops.session.execute.assert_not_awaited()

    async def test_member_channel_drops_direct_mention_of_non_member(self) -> None:
        member, outsider = generate_id(), generate_id()
        ops = _ops()

        direct, teams = await ops._visible_mention_targets(
            _channel(ChannelType.PRIVATE), [member], {member, outsider}, []
        )

        assert direct == {member}
        assert teams == []

    async def test_team_with_no_visible_recipient_is_dropped(self) -> None:
        ops = _ops()
        expansion = TeamExpansion(generate_id(), "Engineering", (generate_id(),))

        _, teams = await ops._visible_mention_targets(
            _channel(ChannelType.PRIVATE), [generate_id()], set(), [expansion]
        )

        assert teams == []

    async def test_public_channel_passes_expansion_through(self) -> None:
        a, b = generate_id(), generate_id()
        ops = _ops()
        expansion = TeamExpansion(generate_id(), "Engineering", (a, b))

        direct, teams = await ops._visible_mention_targets(
            _channel(ChannelType.PUBLIC), [], set(), [expansion]
        )

        assert teams == [(expansion, [a, b])]
        assert direct == set()
        ops.session.execute.assert_not_awaited()

    async def test_public_channel_checks_direct_targets_once(self) -> None:
        active, deactivated = generate_id(), generate_id()
        ops = _ops([_rows_result([(active,)])])

        direct, _ = await ops._visible_mention_targets(
            _channel(ChannelType.PUBLIC), [], {active, deactivated}, []
        )

        assert direct == {active}
        assert ops.session.execute.await_count == 1


def _capture_notifications():
    emitted: list = []

    async def _emit(event):
        emitted.append(event)

    return emitted, AsyncMock(side_effect=_emit)


def _emit_patches(emit_mock, stream_mock):
    return (
        patch("uniffy.core.events.bus.emit_notification", emit_mock),
        patch("uniffy.domains.chat.streaming.publisher.publish_user_chat_event", stream_mock),
    )


class TestEmitSendNotifications:
    async def _emit(self, channel, sender, member_ids, mentioned, team_mentions, ops=None):
        emitted, emit_mock = _capture_notifications()
        stream_mock = AsyncMock()
        ops = ops or _ops()
        message = _message(channel.id, sender)
        emit_patch, stream_patch = _emit_patches(emit_mock, stream_mock)
        with emit_patch, stream_patch:
            await ops._emit_send_notifications(
                message,
                channel,
                sender,
                None,
                "Ada",
                member_ids,
                mentioned,
                team_mentions,
            )
        return emitted, stream_mock

    async def test_team_event_carries_team_copy_and_metadata(self) -> None:
        sender, member = generate_id(), generate_id()
        channel = _channel()
        team_id = generate_id()
        expansion = TeamExpansion(team_id, "Engineering", (member,))

        emitted, stream = await self._emit(
            channel, sender, [sender, member], set(), [(expansion, [member])]
        )

        assert len(emitted) == 1
        event = emitted[0]
        assert event.notification_type is NotificationType.CHAT_MENTION
        assert event.title == "Mentioned Engineering in #general"
        assert event.target_user_ids == [member]
        assert event.metadata["team_id"] == str(team_id)
        assert event.metadata["team_name"] == "Engineering"
        assert stream.await_count == 1

    async def test_direct_mention_wins_copy_and_is_excluded_from_team(self) -> None:
        sender, both, only_team = generate_id(), generate_id(), generate_id()
        channel = _channel()
        expansion = TeamExpansion(generate_id(), "Engineering", (both, only_team))

        emitted, _ = await self._emit(
            channel, sender, [sender, both, only_team], {both}, [(expansion, [both, only_team])]
        )

        assert [e.title for e in emitted] == [
            "Mentioned you in #general",
            "Mentioned Engineering in #general",
        ]
        assert emitted[0].target_user_ids == [both]
        assert emitted[1].target_user_ids == [only_team]

    async def test_sender_never_notified_by_own_team_ping(self) -> None:
        sender, other = generate_id(), generate_id()
        channel = _channel()
        expansion = TeamExpansion(generate_id(), "Engineering", (sender, other))

        emitted, _ = await self._emit(
            channel, sender, [sender, other], set(), [(expansion, [sender, other])]
        )

        assert len(emitted) == 1
        assert emitted[0].target_user_ids == [other]

    async def test_two_teams_notify_once_under_the_first(self) -> None:
        sender, shared = generate_id(), generate_id()
        channel = _channel()
        first = TeamExpansion(generate_id(), "Engineering", (shared,))
        second = TeamExpansion(generate_id(), "Design", (shared,))

        emitted, stream = await self._emit(
            channel,
            sender,
            [sender, shared],
            set(),
            [(first, [shared]), (second, [shared])],
        )

        assert len(emitted) == 1
        assert emitted[0].title == "Mentioned Engineering in #general"
        assert stream.await_count == 1

    async def test_no_team_mentions_leaves_the_chain_untouched(self) -> None:
        sender, mentioned = generate_id(), generate_id()
        channel = _channel()

        emitted, stream = await self._emit(
            channel, sender, [sender, mentioned], {mentioned}, None
        )

        assert [e.title for e in emitted] == ["Mentioned you in #general"]
        assert stream.await_count == 1

    async def test_dm_recipients_exclude_team_notified_users(self) -> None:
        sender, peer = generate_id(), generate_id()
        channel = _channel(ChannelType.GROUP_DM)
        expansion = TeamExpansion(generate_id(), "Engineering", (peer,))

        emitted, _ = await self._emit(
            channel, sender, [sender, peer], set(), [(expansion, [peer])]
        )

        assert [e.notification_type for e in emitted] == [NotificationType.CHAT_MENTION]


class TestBackgroundPostSendFanout:
    async def _run(self, channel, message, member_ids, expansions):
        ops = _ops()
        ops._index_message = AsyncMock()
        ops._update_resources = AsyncMock()
        ops._publish_unread_notifications = AsyncMock()
        ops._emit_send_notifications = AsyncMock()
        sender = message.sender_id
        with patch(
            "uniffy.domains.chat.messages.operations.expand_team_mentions",
            AsyncMock(return_value=expansions),
        ), patch(
            "uniffy.domains.chat.drafts.operations.ChatDraftOperations.clear_for_send",
            AsyncMock(),
        ):
            await ops._background_post_send(message, channel, sender, None, "Ada", member_ids)
        return ops

    async def test_team_recipients_reach_both_notification_paths(self) -> None:
        sender, member, outsider = generate_id(), generate_id(), generate_id()
        team_id = generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, sender)
        message.content = f"[[[Engineering|urn:uniffy:content:TEAM:{team_id}]]] ship it"
        expansion = TeamExpansion(team_id, "Engineering", (member, outsider))

        ops = await self._run(channel, message, [sender, member], [expansion])

        unread_call = ops._publish_unread_notifications.call_args.args
        assert unread_call[3] == {member}
        emit_call = ops._emit_send_notifications.call_args.args
        assert emit_call[6] == set()
        assert emit_call[7] == [(expansion, [member])]

    async def test_message_without_team_mentions_skips_expansion(self) -> None:
        sender = generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, sender)

        ops = await self._run(channel, message, [sender], [])

        assert ops._emit_send_notifications.call_args.args[7] == []

    async def test_system_message_chip_pings_nobody(self) -> None:
        actor, added = generate_id(), generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, actor)
        message.sender_type = SenderType.SYSTEM
        message.content = (
            f"[[[Ada|urn:uniffy:content:USER:{actor}]]] added "
            f"[[[Grace|urn:uniffy:content:USER:{added}]]] to the channel"
        )

        ops = await self._run(channel, message, [actor, added], [])

        assert ops._publish_unread_notifications.call_args.args[3] == set()
        emit_call = ops._emit_send_notifications.call_args.args
        assert emit_call[6] == set()
        assert emit_call[7] == []

    async def test_system_message_still_marks_the_row_unread(self) -> None:
        actor, added = generate_id(), generate_id()
        channel = _channel(ChannelType.PRIVATE)
        message = _message(channel.id, actor)
        message.sender_type = SenderType.SYSTEM

        ops = await self._run(channel, message, [actor, added], [])

        assert ops._publish_unread_notifications.call_args.args[2] == [actor, added]
