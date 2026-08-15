"""TEAM mention extraction and the batched roster expansion behind team pings."""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.content.references import extract_mentioned_team_ids_from_content
from uniffy.core.content.team_mentions import expand_team_mentions
from uniffy.core.events.mentions import extract_mentioned_team_ids
from uniffy.core.types import generate_id

ORG = generate_id()


def _session(rows):
    result = MagicMock()
    result.all = MagicMock(return_value=rows)
    session = MagicMock()
    session.execute = AsyncMock(return_value=result)
    return session


def _team_urn(team_id) -> str:
    return f"urn:uniffy:content:TEAM:{team_id}"


class TestExtractContent:
    def test_picks_team_urns_only(self) -> None:
        team = generate_id()
        user = generate_id()
        content = (
            f"ping [[[Engineering|{_team_urn(team)}]]] and [[[Ada|urn:uniffy:content:USER:{user}]]]"
        )
        assert extract_mentioned_team_ids_from_content(content) == [team]

    def test_preserves_first_occurrence_order(self) -> None:
        first = generate_id()
        second = generate_id()
        content = (
            f"[[[Design|{_team_urn(second)}]]] "
            f"[[[Eng|{_team_urn(first)}]]] "
            f"[[[Design again|{_team_urn(second)}]]]"
        )
        assert extract_mentioned_team_ids_from_content(content) == [second, first]

    def test_malformed_uuid_skipped(self) -> None:
        content = "[[[Broken|urn:uniffy:content:TEAM:not-a-uuid]]]"
        assert extract_mentioned_team_ids_from_content(content) == []

    def test_empty_content(self) -> None:
        assert extract_mentioned_team_ids_from_content("") == []


class TestExtractRefs:
    def test_reference_order_preserved_and_deduped(self) -> None:
        first = generate_id()
        second = generate_id()
        refs = [
            f"urn:uniffy:content:USER:{generate_id()}",
            _team_urn(first),
            _team_urn(second),
            _team_urn(first),
        ]
        assert extract_mentioned_team_ids(refs) == [first, second]

    def test_garbage_uuid_skipped(self) -> None:
        good = generate_id()
        refs = ["urn:uniffy:content:TEAM:zzz", _team_urn(good)]
        assert extract_mentioned_team_ids(refs) == [good]

    def test_none_and_empty(self) -> None:
        assert extract_mentioned_team_ids(None) == []
        assert extract_mentioned_team_ids([]) == []


class TestExpandTeamMentions:
    async def test_empty_input_never_queries(self) -> None:
        session = _session([])
        assert await expand_team_mentions(session, ORG, []) == []
        session.execute.assert_not_awaited()

    async def test_groups_members_per_team_in_input_order(self) -> None:
        first = generate_id()
        second = generate_id()
        a, b, c = generate_id(), generate_id(), generate_id()
        session = _session([
            (second, "Design", c),
            (first, "Engineering", a),
            (first, "Engineering", b),
        ])
        expansions = await expand_team_mentions(session, ORG, [first, second])
        assert [e.team_id for e in expansions] == [first, second]
        assert expansions[0].name == "Engineering"
        assert set(expansions[0].member_ids) == {a, b}
        assert expansions[1].member_ids == (c,)

    async def test_team_without_active_members_is_absent(self) -> None:
        empty = generate_id()
        populated = generate_id()
        member = generate_id()
        session = _session([(populated, "Engineering", member)])
        expansions = await expand_team_mentions(session, ORG, [empty, populated])
        assert [e.team_id for e in expansions] == [populated]

    async def test_duplicate_input_ids_expand_once(self) -> None:
        team = generate_id()
        member = generate_id()
        session = _session([(team, "Engineering", member)])
        expansions = await expand_team_mentions(session, ORG, [team, team])
        assert len(expansions) == 1
