"""Unit tests for ``NoteOperations`` write-path concurrency and persistence guards.

Covers the ``update`` version CAS (bump only on content change, snapshot-row
delete, retry on a lost race) and ``realtime_save`` (blank-overwrite telemetry,
CAS re-read retries). Live-DB integration coverage runs under the notes-domain
harness.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.dml import Delete, Update

from uniffy.core.errors import ConflictError
from uniffy.core.models.notes.note import Note
from uniffy.core.types import AccessMode, NodeType
from uniffy.domains.notes.operations import NoteOperations


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def publish_mock(monkeypatch):
    """Content updates fan out over Valkey; keep unit tests off the wire."""
    mock = AsyncMock()
    monkeypatch.setattr("uniffy.domains.notes.operations.publish_content_replace", mock)
    return mock


def _make_note(*, version: int = 3, content: str = "old content") -> Note:
    return Note(
        id=uuid4(),
        organization_id=uuid4(),
        owner_id=uuid4(),
        node_type=NodeType.NOTE,
        title="t",
        content=content,
        slug="t",
        version=version,
    )


def _make_ops(note: Note) -> NoteOperations:
    ops = NoteOperations.__new__(NoteOperations)
    ops.session = MagicMock()
    ops.session.execute = AsyncMock()
    ops.session.commit = AsyncMock()
    ops.session.rollback = AsyncMock()
    ops.session.refresh = AsyncMock()
    ops._fetch_by_id = AsyncMock(return_value=note)
    ops._require_edit = AsyncMock()
    ops._sync_tags_after_save = AsyncMock()
    ops._index_for_search = AsyncMock()
    ops._effective_policy = AsyncMock(return_value=(AccessMode.OWNER_ONLY, None))
    ops._notify_new_mentions = AsyncMock()
    ops._propagate_title_to_mentions = AsyncMock()
    ops._refresh_children_parent_label = AsyncMock()
    return ops


def _params(stmt) -> dict:
    return stmt.compile(dialect=postgresql.dialect()).params


def _select_result(note: Note | None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = note
    return result


class TestUpdateCas:
    def test_content_update_bumps_version_and_deletes_snapshot_row(self) -> None:
        note = _make_note(version=3)
        ops = _make_ops(note)
        ops.session.execute.side_effect = [MagicMock(rowcount=1), MagicMock()]

        result = _run(
            ops.update(
                user_id=note.owner_id,
                organization_id=note.organization_id,
                note_id=note.id,
                content="new content",
            )
        )

        assert result is note
        update_stmt = ops.session.execute.await_args_list[0].args[0]
        assert isinstance(update_stmt, Update)
        params = _params(update_stmt)
        assert params["version"] == 4
        assert params["version_1"] == 3
        assert params["content"] == "new content"

        delete_stmt = ops.session.execute.await_args_list[1].args[0]
        assert isinstance(delete_stmt, Delete)
        assert delete_stmt.table.name == "realtime_yjs_snapshots"

    def test_content_update_publishes_content_replace(self, publish_mock) -> None:
        note = _make_note(version=3)
        ops = _make_ops(note)
        ops.session.execute.side_effect = [MagicMock(rowcount=1), MagicMock()]

        _run(
            ops.update(
                user_id=note.owner_id,
                organization_id=note.organization_id,
                note_id=note.id,
                content="new content",
            )
        )

        publish_mock.assert_awaited_once()
        args = publish_mock.await_args.args
        assert args[0] == ops.content_type
        assert args[1] == note.id
        assert args[2] == "new content"

    def test_title_only_update_keeps_version_and_snapshot_row(self, publish_mock) -> None:
        note = _make_note(version=3)
        ops = _make_ops(note)
        ops.session.execute.side_effect = [MagicMock(rowcount=1)]

        _run(
            ops.update(
                user_id=note.owner_id,
                organization_id=note.organization_id,
                note_id=note.id,
                title="renamed",
            )
        )

        assert ops.session.execute.await_count == 1
        params = _params(ops.session.execute.await_args_list[0].args[0])
        assert "version" not in params
        assert params["version_1"] == 3
        assert params["title"] == "renamed"
        publish_mock.assert_not_awaited()

    def test_update_retries_after_concurrent_version_bump(self) -> None:
        note = _make_note(version=3)
        refreshed = _make_note(version=4)
        refreshed.id = note.id
        refreshed.organization_id = note.organization_id
        refreshed.owner_id = note.owner_id
        ops = _make_ops(note)
        ops.session.execute.side_effect = [
            MagicMock(rowcount=0),
            _select_result(refreshed),
            MagicMock(rowcount=1),
            MagicMock(),
        ]

        result = _run(
            ops.update(
                user_id=note.owner_id,
                organization_id=note.organization_id,
                note_id=note.id,
                content="new content",
            )
        )

        assert result is refreshed
        first = _params(ops.session.execute.await_args_list[0].args[0])
        second = _params(ops.session.execute.await_args_list[2].args[0])
        assert first["version_1"] == 3
        assert second["version_1"] == 4
        assert second["version"] == 5
        ops.session.rollback.assert_awaited_once()

    def test_update_raises_conflict_after_exhausted_retries(self) -> None:
        note = _make_note(version=3)
        ops = _make_ops(note)
        ops.session.execute.side_effect = [
            MagicMock(rowcount=0),
            _select_result(note),
            MagicMock(rowcount=0),
            _select_result(note),
            MagicMock(rowcount=0),
        ]

        with pytest.raises(ConflictError):
            _run(
                ops.update(
                    user_id=note.owner_id,
                    organization_id=note.organization_id,
                    note_id=note.id,
                    title="renamed",
                )
            )


class TestRealtimeSave:
    def test_blank_transition_counts_metric_and_still_writes(self) -> None:
        note = _make_note(version=3, content="existing text")
        ops = _make_ops(note)
        ops.session.execute.side_effect = [
            _select_result(note),
            MagicMock(rowcount=1),
        ]

        with patch(
            "uniffy.domains.notes.operations.REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL"
        ) as counter:
            result = _run(
                ops.realtime_save(
                    organization_id=note.organization_id,
                    note_id=note.id,
                    content="",
                    canvas_content=None,
                )
            )

        assert result is note
        counter.labels.assert_called_once_with(content_type="NOTE")
        counter.labels.return_value.inc.assert_called_once()
        params = _params(ops.session.execute.await_args_list[1].args[0])
        assert params["content"] == ""
        assert params["version"] == 4

    def test_non_blank_save_does_not_count_metric(self) -> None:
        note = _make_note(version=3, content="existing text")
        ops = _make_ops(note)
        ops.session.execute.side_effect = [
            _select_result(note),
            MagicMock(rowcount=1),
        ]

        with patch(
            "uniffy.domains.notes.operations.REALTIME_BLANK_CONTENT_OVERWRITES_TOTAL"
        ) as counter:
            _run(
                ops.realtime_save(
                    organization_id=note.organization_id,
                    note_id=note.id,
                    content="fresh text",
                    canvas_content=None,
                )
            )

        counter.labels.assert_not_called()

    def test_cas_loss_re_reads_and_retries(self) -> None:
        note = _make_note(version=3)
        refreshed = _make_note(version=4)
        refreshed.id = note.id
        refreshed.organization_id = note.organization_id
        refreshed.owner_id = note.owner_id
        ops = _make_ops(note)
        ops.session.execute.side_effect = [
            _select_result(note),
            MagicMock(rowcount=0),
            _select_result(refreshed),
            MagicMock(rowcount=1),
        ]

        result = _run(
            ops.realtime_save(
                organization_id=note.organization_id,
                note_id=note.id,
                content="rendered",
                canvas_content=None,
            )
        )

        assert result is refreshed
        second = _params(ops.session.execute.await_args_list[3].args[0])
        assert second["version_1"] == 4
        assert second["version"] == 5

    def test_returns_none_after_exhausted_cas(self) -> None:
        note = _make_note(version=3)
        ops = _make_ops(note)
        ops.session.execute.side_effect = [
            _select_result(note),
            MagicMock(rowcount=0),
            _select_result(note),
            MagicMock(rowcount=0),
            _select_result(note),
            MagicMock(rowcount=0),
        ]

        result = _run(
            ops.realtime_save(
                organization_id=note.organization_id,
                note_id=note.id,
                content="rendered",
                canvas_content=None,
            )
        )

        assert result is None
        assert ops.session.execute.await_count == 6
        ops._index_for_search.assert_not_awaited()
