"""Team mentions on notes: delta semantics, actor exclusion, per-team copy."""

from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.content.team_mentions import TeamExpansion
from uniffy.core.models.notes.note import Note
from uniffy.core.types import NodeType, generate_id
from uniffy.domains.notes.operations import NoteOperations

ORG = generate_id()


def _note(refs: list[str]) -> Note:
    return Note(
        id=generate_id(),
        organization_id=ORG,
        owner_id=generate_id(),
        node_type=NodeType.NOTE,
        title="Roadmap",
        content="",
        slug="roadmap",
        outgoing_references=refs,
    )


def _ops() -> NoteOperations:
    ops = NoteOperations.__new__(NoteOperations)
    ops.session = MagicMock()
    return ops


def _team_urn(team_id) -> str:
    return f"urn:uniffy:content:TEAM:{team_id}"


async def _notify(note, actor, old_refs, expansions, writer_id=None):
    emitted: list = []
    ops = _ops()
    with (
        patch(
            "uniffy.domains.notes.content.notifications.emit_notification",
            AsyncMock(side_effect=lambda event: emitted.append(event)),
        ),
        patch(
            "uniffy.domains.notes.content.notifications.expand_team_mentions",
            AsyncMock(return_value=expansions),
        ) as expander,
    ):
        await ops._notify_new_mentions(actor, ORG, note, old_refs, writer_id)
    return emitted, expander


class TestNoteTeamMentions:
    async def test_new_team_mention_notifies_members(self) -> None:
        actor, member = generate_id(), generate_id()
        team = generate_id()
        note = _note([_team_urn(team)])
        expansion = TeamExpansion(team, "Engineering", (member,))

        emitted, _ = await _notify(note, actor, None, [expansion])

        assert len(emitted) == 1
        assert emitted[0].title == "Mentioned Engineering in: Roadmap"
        assert emitted[0].target_user_ids == [member]
        assert emitted[0].metadata == {"team_id": str(team), "team_name": "Engineering"}

    async def test_team_already_mentioned_is_not_re_notified(self) -> None:
        actor = generate_id()
        team = generate_id()
        note = _note([_team_urn(team)])

        emitted, expander = await _notify(note, actor, [_team_urn(team)], [])

        assert emitted == []
        expander.assert_not_awaited()

    async def test_writer_and_direct_targets_excluded_from_team_event(self) -> None:
        actor, writer, direct, plain = (
            generate_id(),
            generate_id(),
            generate_id(),
            generate_id(),
        )
        team = generate_id()
        note = _note([_team_urn(team), f"urn:uniffy:content:USER:{direct}"])
        expansion = TeamExpansion(team, "Engineering", (writer, direct, plain))

        emitted, _ = await _notify(note, actor, None, [expansion], writer_id=writer)

        assert emitted[0].title == "Mentioned you in: Roadmap"
        assert emitted[0].target_user_ids == [direct]
        assert emitted[1].target_user_ids == [plain]

    async def test_unknown_writer_keeps_every_team_member(self) -> None:
        actor, owner = generate_id(), generate_id()
        team = generate_id()
        note = _note([_team_urn(team)])
        expansion = TeamExpansion(team, "Engineering", (owner,))

        emitted, _ = await _notify(note, actor, None, [expansion], writer_id=None)

        assert emitted[0].target_user_ids == [owner]

    async def test_no_team_mention_skips_expansion(self) -> None:
        actor = generate_id()
        note = _note([f"urn:uniffy:content:USER:{generate_id()}"])

        emitted, expander = await _notify(note, actor, None, [])

        assert len(emitted) == 1
        expander.assert_not_awaited()
