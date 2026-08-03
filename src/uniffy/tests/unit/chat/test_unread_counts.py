"""Unread mention matching: the badge aggregate counts team mentions too."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.types import generate_id
from uniffy.domains.chat.read_state.operations import ChatReadStateOperations

ORG = generate_id()
USER = generate_id()


def _result(rows=()):
    result = MagicMock()
    result.all = MagicMock(return_value=list(rows))
    return result


def _ops(aggregate_rows=()):
    session = MagicMock()
    session.execute = AsyncMock(side_effect=[_result(), _result(aggregate_rows)])
    return ChatReadStateOperations(session)


def _no_valkey():
    return patch(
        "uniffy.domains.chat.read_state.operations._get_valkey_client",
        MagicMock(return_value=None),
    )


def _teams(team_ids):
    return patch(
        "uniffy.domains.chat.read_state.operations.user_team_ids",
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
            f"urn:uniffy:content:TEAM:{first}",
            f"urn:uniffy:content:TEAM:{second}",
        ]

    async def test_user_without_teams_binds_a_single_urn(self) -> None:
        ops = _ops()
        await _run(ops, [generate_id()])

        params = ops.session.execute.call_args_list[1].args[1]
        assert params["mention_urns"] == [f"urn:uniffy:content:USER:{USER}"]

    async def test_counts_returned_per_channel_without_valkey(self) -> None:
        channel = generate_id()
        ops = _ops([(channel, 4, 2)])

        counts = await _run(ops, [channel], [generate_id()])

        assert counts[channel]["unread_count"] == 4
        assert counts[channel]["mention_count"] == 2

    async def test_channel_without_rows_fills_zeros(self) -> None:
        channel = generate_id()
        ops = _ops()

        counts = await _run(ops, [channel])

        assert counts[channel] == {
            "unread_count": 0,
            "mention_count": 0,
            "last_read_message_id": None,
        }

    async def test_empty_channel_list_short_circuits(self) -> None:
        ops = _ops()
        assert await _run(ops, []) == {}
        ops.session.execute.assert_not_awaited()
