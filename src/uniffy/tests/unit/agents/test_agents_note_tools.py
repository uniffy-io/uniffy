"""Agent note tools preserve newer user content through version guards."""

from dataclasses import replace
from unittest.mock import AsyncMock, MagicMock, patch

from uniffy.core.errors import StaleContentVersionError
from uniffy.core.json_codec import loads
from uniffy.core.models.notes.note import Note
from uniffy.core.types import ContentType, NodeType, generate_id
from uniffy.domains.agents.tools.builtin.notes import (
    _execute_create_note,
    _execute_read_note,
    _execute_update_note,
    update_note,
)
from uniffy.domains.agents.tools.definitions import ToolContext


def _context() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        storage=MagicMock(),
        search_indexer=MagicMock(),
    )


def _note(ctx: ToolContext, *, version: int = 4, content: str = "latest") -> Note:
    return Note(
        id=generate_id(),
        organization_id=ctx.organization_id,
        owner_id=ctx.user_id,
        node_type=NodeType.NOTE,
        title="Roadmap",
        content=content,
        slug="roadmap",
        version=version,
    )


def test_isolated_read_context_shares_observed_versions_with_writer() -> None:
    ctx = _context()
    note = _note(ctx)
    isolated = replace(ctx, session=MagicMock())

    isolated.observed_content_versions[(ContentType.NOTE, note.id)] = note.version

    assert ctx.observed_content_versions[(ContentType.NOTE, note.id)] == note.version


async def test_read_note_returns_content_version() -> None:
    ctx = _context()
    note = _note(ctx, version=7)
    reader = MagicMock()
    reader.get_by_id = AsyncMock(return_value=note)
    tags = MagicMock()
    tags.get_for_urns = AsyncMock(return_value={})

    with (
        patch("uniffy.domains.agents.tools.builtin.notes.NoteReader", return_value=reader),
        patch("uniffy.domains.agents.tools.builtin.notes.TagOperations", return_value=tags),
        patch(
            "uniffy.domains.agents.tools.builtin.notes._fetch_titles",
            new=AsyncMock(return_value={}),
        ),
    ):
        result = await _execute_read_note(ctx, {"note_id": str(note.id)})

    assert result.success is True
    assert loads(result.data)["version"] == 7
    assert ctx.observed_content_versions[(ContentType.NOTE, note.id)] == 7


async def test_truncated_read_cannot_authorize_content_replacement() -> None:
    ctx = _context()
    note = _note(ctx, version=7, content="x" * 50_001)
    reader = MagicMock()
    reader.get_by_id = AsyncMock(return_value=note)
    tags = MagicMock()
    tags.get_for_urns = AsyncMock(return_value={})

    with (
        patch("uniffy.domains.agents.tools.builtin.notes.NoteReader", return_value=reader),
        patch("uniffy.domains.agents.tools.builtin.notes.TagOperations", return_value=tags),
        patch(
            "uniffy.domains.agents.tools.builtin.notes._fetch_titles",
            new=AsyncMock(return_value={}),
        ),
    ):
        result = await _execute_read_note(ctx, {"note_id": str(note.id)})

    payload = loads(result.data)
    assert payload["_truncated"] is True
    assert "Do not replace" in payload["_truncation_notice"]
    assert (ContentType.NOTE, note.id) not in ctx.observed_content_versions


async def test_create_note_returns_initial_content_version() -> None:
    ctx = _context()
    note = _note(ctx, version=1, content="draft")
    operations = MagicMock()
    operations.create = AsyncMock(return_value=note)

    with patch(
        "uniffy.domains.agents.tools.builtin.notes.NoteOperations",
        return_value=operations,
    ):
        result = await _execute_create_note(
            ctx,
            {"title": note.title, "content": note.content},
        )

    assert result.success is True
    assert "content version: 1" in result.data
    assert ctx.observed_content_versions[(ContentType.NOTE, note.id)] == 1


async def test_content_update_requires_expected_version() -> None:
    ctx = _context()
    note = _note(ctx)

    result = await _execute_update_note(
        ctx,
        {"note_id": str(note.id), "content": "stale replacement"},
    )

    assert result.success is False
    assert result.error is not None
    assert "notes.read_note immediately before updating" in result.error


async def test_content_update_passes_expected_version_to_note_domain() -> None:
    ctx = _context()
    note = _note(ctx, version=8)
    ctx.observed_content_versions[(ContentType.NOTE, note.id)] = 7
    operations = MagicMock()
    operations.update = AsyncMock(return_value=note)

    with patch(
        "uniffy.domains.agents.tools.builtin.notes.NoteOperations",
        return_value=operations,
    ):
        result = await _execute_update_note(
            ctx,
            {
                "note_id": str(note.id),
                "content": "merged latest content",
                "expected_version": 7,
            },
        )

    assert result.success is True
    assert "content version: 8" in result.data
    assert operations.update.await_args.kwargs["expected_content_version"] == 7
    assert ctx.observed_content_versions[(ContentType.NOTE, note.id)] == 8


async def test_content_update_rejects_version_not_read_during_current_run() -> None:
    ctx = _context()
    note = _note(ctx)

    result = await _execute_update_note(
        ctx,
        {
            "note_id": str(note.id),
            "content": "replacement from old context",
            "expected_version": 3,
        },
    )

    assert result.success is False
    assert result.error is not None
    assert "This agent run has not read that content version" in result.error


async def test_stale_content_update_tells_agent_to_reread_without_retrying() -> None:
    ctx = _context()
    note = _note(ctx)
    ctx.observed_content_versions[(ContentType.NOTE, note.id)] = 3
    operations = MagicMock()
    operations.update = AsyncMock(
        side_effect=StaleContentVersionError("Note", "stale content version")
    )

    with patch(
        "uniffy.domains.agents.tools.builtin.notes.NoteOperations",
        return_value=operations,
    ):
        result = await _execute_update_note(
            ctx,
            {
                "note_id": str(note.id),
                "content": "stale replacement",
                "expected_version": 3,
            },
        )

    assert result.success is False
    assert result.error is not None
    assert "No content was changed" in result.error
    assert "Read it again with notes.read_note" in result.error
    operations.update.assert_awaited_once()
    assert (ContentType.NOTE, note.id) not in ctx.observed_content_versions


def test_update_note_schema_exposes_content_version_guard() -> None:
    expected = update_note.parameter_schema["properties"]["expected_version"]
    assert expected["type"] == "integer"
    assert expected["minimum"] == 1
    assert "stale version is rejected" in update_note.description
