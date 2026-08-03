"""Team mentions on tasks: delta semantics, actor exclusion, per-team copy."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.content.team_mentions import TeamExpansion
from uniffy.core.models.projects.task import Task
from uniffy.core.types import generate_id
from uniffy.domains.projects.operations import TaskOperations

ORG = generate_id()


def _task() -> Task:
    return Task(
        id=generate_id(),
        organization_id=ORG,
        project_id=generate_id(),
        owner_id=generate_id(),
        title="Ship the badge",
    )


def _team_urn(team_id) -> str:
    return f"urn:uniffy:content:TEAM:{team_id}"


async def _emit(actor, old_refs, new_refs, expansions):
    emitted: list = []
    ops = TaskOperations.__new__(TaskOperations)
    ops.session = MagicMock()
    with patch(
        "uniffy.domains.projects.operations.emit_notification",
        AsyncMock(side_effect=lambda event: emitted.append(event)),
    ), patch(
        "uniffy.domains.projects.operations.expand_team_mentions",
        AsyncMock(return_value=expansions),
    ) as expander:
        await ops._emit_mention_notifications(_task(), actor, old_refs, new_refs)
    return emitted, expander


class TestTaskTeamMentions:
    async def test_new_team_mention_notifies_members(self) -> None:
        actor, member = generate_id(), generate_id()
        team = generate_id()
        expansion = TeamExpansion(team, "Engineering", (member,))

        emitted, _ = await _emit(actor, None, [_team_urn(team)], [expansion])

        assert len(emitted) == 1
        assert emitted[0].title == "Mentioned Engineering in: Ship the badge"
        assert emitted[0].target_user_ids == [member]
        assert emitted[0].metadata == {"team_id": str(team), "team_name": "Engineering"}

    async def test_pre_existing_team_mention_is_not_re_notified(self) -> None:
        actor = generate_id()
        team = generate_id()

        emitted, expander = await _emit(actor, [_team_urn(team)], [_team_urn(team)], [])

        assert emitted == []
        expander.assert_not_awaited()

    async def test_actor_and_direct_targets_excluded(self) -> None:
        actor, direct, plain = generate_id(), generate_id(), generate_id()
        team = generate_id()
        expansion = TeamExpansion(team, "Engineering", (actor, direct, plain))
        new_refs = [_team_urn(team), f"urn:uniffy:content:USER:{direct}"]

        emitted, _ = await _emit(actor, None, new_refs, [expansion])

        assert emitted[0].target_user_ids == [direct]
        assert emitted[1].target_user_ids == [plain]

    async def test_direct_only_mention_skips_expansion(self) -> None:
        actor = generate_id()
        new_refs = [f"urn:uniffy:content:USER:{generate_id()}"]

        emitted, expander = await _emit(actor, None, new_refs, [])

        assert len(emitted) == 1
        expander.assert_not_awaited()
