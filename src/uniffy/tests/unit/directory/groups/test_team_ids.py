"""Cached team-id lookup behind the chat mention badge."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.types import generate_id
from uniffy.domains.directory.groups.teams import user_team_ids

ORG = generate_id()
USER = generate_id()


def _session(rows=()):
    result = MagicMock()
    result.all = MagicMock(return_value=list(rows))
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


def _cache(cached=None):
    return (
        patch(
            "uniffy.domains.directory.groups.teams.get_cached_user_team_ids",
            AsyncMock(return_value=cached),
        ),
        patch("uniffy.domains.directory.groups.teams.set_cached_user_team_ids", AsyncMock()),
    )


class TestUserTeamIds:
    async def test_cache_hit_skips_the_query(self) -> None:
        team = generate_id()
        session = _session()
        get_patch, set_patch = _cache([str(team)])
        with get_patch, set_patch as writer:
            assert await user_team_ids(session, ORG, USER) == [team]
        session.execute.assert_not_awaited()
        writer.assert_not_awaited()

    async def test_miss_queries_then_writes_string_ids(self) -> None:
        first, second = generate_id(), generate_id()
        session = _session([(first,), (second,)])
        get_patch, set_patch = _cache(None)
        with get_patch, set_patch as writer:
            assert await user_team_ids(session, ORG, USER) == [first, second]
        writer.assert_awaited_once_with(ORG, USER, [str(first), str(second)])

    async def test_empty_membership_caches_an_empty_list(self) -> None:
        session = _session()
        get_patch, set_patch = _cache(None)
        with get_patch, set_patch as writer:
            assert await user_team_ids(session, ORG, USER) == []
        writer.assert_awaited_once_with(ORG, USER, [])
