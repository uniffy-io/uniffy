"""Bundled skill file-to-row sync.

Vanilla pytest + ``asyncio.run`` with a fake session, matching the repo's other
agents tests (no pytest-asyncio, no live DB).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.db.bundled_skills import _sync_locked


def _run(coro):
    return asyncio.run(coro)


def _shipped() -> list[dict[str, str]]:
    return [
        {
            "id": doc.scalar("id"),
            "name": doc.scalar("name"),
            "display_name": doc.scalar("display_name"),
            "description": doc.scalar("description"),
            "content": doc.body,
        }
        for doc in load_documents(DATA_DIR / "skills")
    ]


def _sync(existing: list[AgentSkill]) -> list[AgentSkill]:
    """Run the sync against `existing` rows; return the rows it added."""
    session = MagicMock()
    session.add = MagicMock()
    lookup = MagicMock()
    lookup.scalars.return_value.all.return_value = existing
    session.execute = AsyncMock(return_value=lookup)

    _run(_sync_locked(session))
    return [c.args[0] for c in session.add.call_args_list]


def _row(entry: dict[str, str], **overrides) -> AgentSkill:
    fields = {
        "id": UUID(entry["id"]),
        "organization_id": None,
        "name": entry["name"],
        "display_name": entry["display_name"],
        "description": entry["description"],
        "content": entry["content"],
        "source": "bundled",
    }
    return AgentSkill(**{**fields, **overrides})


class TestShippedFiles:
    def test_every_skill_declares_a_stable_id(self) -> None:
        entries = _shipped()
        assert entries
        ids = [UUID(e["id"]) for e in entries]
        assert len(set(ids)) == len(ids)
        # Version 7 keeps bundled ids sortable alongside every other row's id.
        assert all(i.version == 7 for i in ids)


class TestSync:
    def test_inserts_every_shipped_skill_on_an_empty_database(self) -> None:
        added = _sync([])

        assert {s.name for s in added} == {e["name"] for e in _shipped()}
        assert all(s.source == "bundled" for s in added)
        assert all(s.organization_id is None for s in added)

    def test_ids_come_from_the_files_not_the_database(self) -> None:
        added = _sync([])
        assert {str(s.id) for s in added} == {e["id"] for e in _shipped()}

    def test_is_a_noop_when_rows_already_match(self) -> None:
        rows = [_row(e) for e in _shipped()]
        assert _sync(rows) == []
        assert all(r.status == "active" for r in rows)

    def test_edited_content_reaches_an_existing_deployment(self) -> None:
        entries = _shipped()
        stale = _row(entries[0], content="whatever shipped two releases ago")
        rows = [stale] + [_row(e) for e in entries[1:]]

        assert _sync(rows) == []
        assert stale.content == entries[0]["content"]

    def test_new_skill_lands_on_an_existing_deployment(self) -> None:
        entries = _shipped()
        added = _sync([_row(e) for e in entries[1:]])

        assert [s.name for s in added] == [entries[0]["name"]]

    def test_unshipped_skill_is_retired_not_deleted(self) -> None:
        dropped = AgentSkill(
            id=UUID("019fa4a1-b703-7496-aae4-1450000000ff"),
            organization_id=None,
            name="removed_last_release",
            display_name="Removed",
            description="",
            content="",
            source="bundled",
        )
        rows = [dropped] + [_row(e) for e in _shipped()]

        assert _sync(rows) == []
        assert dropped.status == "retired"

    def test_row_predating_fixed_ids_is_left_alone_not_duplicated(self) -> None:
        entries = _shipped()
        legacy = _row(entries[0], id=UUID("019fa1cb-c8a8-71e6-8610-51590d0e69a7"))
        rows = [legacy] + [_row(e) for e in entries[1:]]

        # Inserting would trip the unique index on (name) where org is null.
        assert _sync(rows) == []
        assert legacy.status == "active"

    def test_reshipping_a_retired_skill_reactivates_it(self) -> None:
        entries = _shipped()
        revived = _row(entries[0], status="retired")
        rows = [revived] + [_row(e) for e in entries[1:]]

        assert _sync(rows) == []
        assert revived.status == "active"
