"""Channel read cursors: the badge aggregate, and where mark-unread parks the cursor."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from uniffy.core.content.references import BROADCAST_URNS
from uniffy.core.errors import NotFoundError
from uniffy.core.types import generate_id
from uniffy.domains.chat.reads.cursors import ChannelCursor
from uniffy.domains.chat.reads.operations import _EPOCH, ChatReadStateOperations

ORG = generate_id()
USER = generate_id()


def _result(rows=()):
    result = MagicMock()
    result.all = MagicMock(return_value=list(rows))
    return result


def _row(value):
    result = MagicMock()
    result.one_or_none = MagicMock(return_value=value)
    return result


def _ops(aggregate_rows=(), latest_rows=()):
    session = MagicMock()
    # PG cursor read, then the unread aggregate, then the latest-message lookup.
    session.execute = AsyncMock(
        side_effect=[_result(), _result(aggregate_rows), _result(latest_rows), _result()]
    )
    return ChatReadStateOperations(session)


def _no_valkey():
    return patch(
        "uniffy.domains.chat.reads.operations._get_valkey_client",
        MagicMock(return_value=None),
    )


def _teams(team_ids):
    return patch(
        "uniffy.domains.chat.reads.operations.user_team_ids",
        AsyncMock(return_value=list(team_ids)),
    )


async def _run(ops, channel_ids, team_ids=()):
    with _no_valkey(), _teams(team_ids):
        return await ops.get_unread_counts(USER, ORG, list(channel_ids))


class TestMentionMatch:
    async def test_user_and_team_urns_are_bound(self) -> None:
        first, second = generate_id(), generate_id()
        ops = _ops()
        await _run(ops, [generate_id()], [first, second])

        params = ops.session.execute.call_args_list[1].args[1]
        assert params["mention_urns"] == [
            f"urn:uniffy:content:USER:{USER}",
            *BROADCAST_URNS,
            f"urn:uniffy:content:TEAM:{first}",
            f"urn:uniffy:content:TEAM:{second}",
        ]

    async def test_user_without_teams_binds_user_and_broadcast_urns(self) -> None:
        ops = _ops()
        await _run(ops, [generate_id()])

        params = ops.session.execute.call_args_list[1].args[1]
        assert params["mention_urns"] == [f"urn:uniffy:content:USER:{USER}", *BROADCAST_URNS]

    async def test_counts_returned_per_channel_without_valkey(self) -> None:
        channel = generate_id()
        ops = _ops([(channel, 4, 2)])

        counts = await _run(ops, [channel], [generate_id()])

        assert counts[channel]["unread_count"] == 4
        assert counts[channel]["mention_count"] == 2

    async def test_latest_message_id_rides_the_same_batch(self) -> None:
        channel, newest = generate_id(), generate_id()
        ops = _ops([(channel, 4, 2)], [(channel, newest)])

        counts = await _run(ops, [channel], [generate_id()])

        # A surface that never opened the channel needs this to mark it read.
        assert counts[channel]["latest_message_id"] == newest

    async def test_channel_without_rows_fills_zeros(self) -> None:
        channel = generate_id()
        ops = _ops()

        counts = await _run(ops, [channel])

        assert counts[channel] == {
            "unread_count": 0,
            "mention_count": 0,
            "last_read_message_id": None,
            "latest_message_id": None,
            "first_unread_message_id": None,
        }

    async def test_empty_channel_list_short_circuits(self) -> None:
        ops = _ops()
        assert await _run(ops, []) == {}
        ops.session.execute.assert_not_awaited()


def _valkey(client):
    return patch(
        "uniffy.domains.chat.reads.operations._get_valkey_client",
        MagicMock(return_value=client),
    )


def _unread_ops(target_at, predecessor):
    """Session answering the target lookup then the keyset lookup."""
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[_row((target_at,) if target_at else None), _row(predecessor), _result()]
    )
    session.commit = AsyncMock()
    return ChatReadStateOperations(session)


class TestMarkChannelUnread:
    async def test_cursor_lands_on_predecessor_with_its_own_timestamp(self) -> None:
        channel, target = generate_id(), generate_id()
        predecessor_id = generate_id()
        predecessor_at = datetime(2026, 9, 14, 10, 0, tzinfo=UTC)
        ops = _unread_ops(datetime(2026, 9, 14, 10, 5, tzinfo=UTC), (predecessor_id, predecessor_at))
        client = MagicMock(eval=AsyncMock())

        with _valkey(client):
            cursor_id, cursor_at = await ops.mark_channel_unread(USER, channel, target)

        assert (cursor_id, cursor_at) == (predecessor_id, predecessor_at)
        value = client.eval.call_args.args[5]
        cursor = ChannelCursor.decode(value)
        assert (cursor.message_id, cursor.read_at) == (predecessor_id, predecessor_at)

    async def test_first_message_target_caches_explicit_null_cursor(self) -> None:
        channel, target = generate_id(), generate_id()
        ops = _unread_ops(datetime(2026, 9, 14, 10, 0, tzinfo=UTC), None)
        client = MagicMock(eval=AsyncMock())

        with _valkey(client):
            cursor_id, cursor_at = await ops.mark_channel_unread(USER, channel, target)

        assert (cursor_id, cursor_at) == (None, _EPOCH)
        cursor = ChannelCursor.decode(client.eval.call_args.args[5])
        assert (cursor.message_id, cursor.read_at) == (None, _EPOCH)

    async def test_target_outside_the_channel_is_rejected(self) -> None:
        ops = _unread_ops(None, None)

        with _valkey(None), pytest.raises(NotFoundError):
            await ops.mark_channel_unread(USER, generate_id(), generate_id())
