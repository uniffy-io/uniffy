"""Bundled skill file-to-row sync."""

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

from uniffy.core.data_files import DATA_DIR, load_documents
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.models.agents.skill_version import AgentSkillVersion
from uniffy.core.types import generate_id
from uniffy.domains.agents.skills import bundled


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


def _row(entry: dict[str, str], **overrides) -> AgentSkill:
    fields = {
        **entry,
        "id": UUID(entry["id"]),
        "organization_id": None,
        "source": "bundled",
        "active_version_id": generate_id(),
    }
    return AgentSkill(**{**fields, **overrides})


def _version(row: AgentSkill) -> SimpleNamespace:
    return SimpleNamespace(
        id=row.active_version_id,
        skill_id=row.id,
        version_number=row.latest_version_number,
        name=row.name,
        display_name=row.display_name,
        description=row.description,
        content=row.content,
        requires_tools=list(row.requires_tools),
        supported_surfaces=list(row.supported_surfaces),
    )


async def _sync(existing: list[AgentSkill], *, versions=None):
    session = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    versions = versions if versions is not None else [_version(row) for row in existing]
    lookup = MagicMock()
    lookup.all.return_value = list(zip(existing, versions, strict=True))
    maximum = MagicMock()
    maximum.scalar.return_value = max(
        (version.version_number for version in versions if version is not None),
        default=0,
    )
    session.execute = AsyncMock(side_effect=[lookup] + [maximum] * (len(_shipped()) + 1))
    changed = await bundled.sync_skill_documents(session)
    session.commit.assert_not_awaited()
    added = [call.args[0] for call in session.add.call_args_list]
    return (
        changed,
        [row for row in added if isinstance(row, AgentSkill)],
        [row for row in added if isinstance(row, AgentSkillVersion)],
    )


class TestShippedFiles:
    def test_every_skill_declares_a_stable_id(self) -> None:
        entries = _shipped()
        assert entries
        ids = [UUID(entry["id"]) for entry in entries]
        assert len(set(ids)) == len(ids)
        assert all(skill_id.version == 7 for skill_id in ids)

    @pytest.mark.parametrize("key", ["always_active", "when_to_use", "auto_invoke"])
    async def test_automatic_activation_frontmatter_is_rejected(self, monkeypatch, key) -> None:
        doc = load_documents(DATA_DIR / "skills")[0]
        monkeypatch.setattr(
            bundled,
            "load_documents",
            lambda path: [replace(doc, meta={**doc.meta, key: "true"})],
        )
        session = MagicMock()
        session.execute = AsyncMock()
        with pytest.raises(ValueError, match="unsupported bundled skill frontmatter"):
            await bundled.sync_skill_documents(session)
        session.execute.assert_not_awaited()


class TestSync:
    async def test_inserts_every_shipped_skill_with_an_active_snapshot(self) -> None:
        changed, added, snapshots = await _sync([])
        assert changed
        assert {row.name for row in added} == {entry["name"] for entry in _shipped()}
        assert all(row.source == "bundled" and row.organization_id is None for row in added)
        assert {row.active_version_id for row in added} == {version.id for version in snapshots}
        assert all(version.version_number == 1 for version in snapshots)
        assert all("always_active" not in type(row).model_fields for row in added)

    async def test_ids_come_from_the_files_not_the_database(self) -> None:
        _, added, _ = await _sync([])
        assert {str(row.id) for row in added} == {entry["id"] for entry in _shipped()}

    async def test_is_a_noop_when_rows_and_snapshots_match(self) -> None:
        rows = [_row(entry) for entry in _shipped()]
        assert await _sync(rows) == (False, [], [])
        assert all(row.status == "active" for row in rows)

    async def test_edited_content_appends_a_snapshot_and_follows_latest(self) -> None:
        entries = _shipped()
        stale = _row(entries[0], content="Previous instructions")
        previous_id = stale.active_version_id
        rows = [stale] + [_row(entry) for entry in entries[1:]]
        versions = [_version(row) for row in rows]
        changed, added, snapshots = await _sync(rows, versions=versions)
        assert changed and not added
        assert stale.content == entries[0]["content"]
        assert snapshots[0].content == stale.content
        assert snapshots[0].version_number == 2
        assert snapshots[0].parent_version_id == previous_id
        assert stale.active_version_id == snapshots[0].id
        assert versions[0].content == "Previous instructions"

    async def test_pinned_body_survives_a_shipped_edit(self) -> None:
        entries = _shipped()
        stale = _row(entries[0], content="Pinned instructions", active_version_pinned=True)
        pinned_id = stale.active_version_id
        changed, _, snapshots = await _sync([stale] + [_row(entry) for entry in entries[1:]])
        assert changed and snapshots
        assert stale.active_version_id == pinned_id
        assert stale.latest_version_number == 2

    async def test_matching_head_with_stale_snapshot_gets_an_exact_version(self) -> None:
        rows = [_row(entry) for entry in _shipped()]
        versions = [_version(row) for row in rows]
        versions[0].content = "Outdated snapshot"
        changed, _, snapshots = await _sync(rows, versions=versions)
        assert changed
        assert snapshots[0].content == rows[0].content

    async def test_missing_active_snapshot_is_materialized(self) -> None:
        rows = [_row(entry) for entry in _shipped()]
        rows[0].active_version_id = None
        changed, _, snapshots = await _sync(rows)
        assert changed
        assert rows[0].active_version_id == snapshots[0].id

    async def test_new_skill_lands_on_an_existing_deployment(self) -> None:
        entries = _shipped()
        _, added, snapshots = await _sync([_row(entry) for entry in entries[1:]])
        assert [row.name for row in added] == [entries[0]["name"]]
        assert snapshots[0].skill_id == added[0].id

    async def test_unshipped_skill_is_retired_not_deleted(self) -> None:
        dropped = AgentSkill(
            id=generate_id(),
            name="removed_workflow",
            display_name="Removed",
            content="Retained instructions",
            source="bundled",
            active_version_id=generate_id(),
        )
        active_id = dropped.active_version_id
        changed, added, snapshots = await _sync([dropped] + [_row(entry) for entry in _shipped()])
        assert changed and not added and not snapshots
        assert dropped.status == "retired"
        assert dropped.active_version_id == active_id
        assert dropped.content == "Retained instructions"

    async def test_conflicting_fixed_id_fails_without_rebinding(self) -> None:
        entries = _shipped()
        conflict = _row(entries[0], id=generate_id())
        with pytest.raises(ValueError, match="different fixed ID"):
            await _sync([conflict] + [_row(entry) for entry in entries[1:]])
        assert conflict.status == "active"

    async def test_reshipping_reactivates_without_duplicate_history(self) -> None:
        entries = _shipped()
        revived = _row(entries[0], status="retired")
        changed, added, snapshots = await _sync([revived] + [_row(entry) for entry in entries[1:]])
        assert changed and not added and not snapshots
        assert revived.status == "active"


@pytest.mark.parametrize("commit_fails", [False, True])
async def test_sync_invalidates_only_after_authoritative_commit(commit_fails) -> None:
    session = MagicMock()
    session.commit = AsyncMock(side_effect=RuntimeError("commit failed") if commit_fails else None)
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)

    async def invalidate(tag):
        session.commit.assert_awaited_once()
        assert tag == bundled.BUNDLED_SKILLS_TAG

    with (
        patch.object(bundled, "startup_advisory_lock", return_value=MagicMock()),
        patch.object(bundled, "open_session", return_value=context),
        patch.object(bundled, "sync_skill_documents", AsyncMock(return_value=True)),
        patch.object(bundled, "cache_invalidate_by_tag", AsyncMock(side_effect=invalidate)) as cache,
    ):
        if commit_fails:
            with pytest.raises(RuntimeError, match="commit failed"):
                await bundled.sync_bundled_skills()
            cache.assert_not_awaited()
        else:
            await bundled.sync_bundled_skills()
            cache.assert_awaited_once()
