"""Agent note tools refuse content writes that no read in the current run authorized."""

from dataclasses import replace
from unittest.mock import MagicMock

from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.types import ContentType, generate_id
from uniffy.domains.agents.tools.builtin.notes import update_note
from uniffy.domains.agents.tools.definitions import ToolContext


def _context() -> ToolContext:
    return ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        buffer=UpdateBuffer(),
        storage=MagicMock(),
        search_indexer=MagicMock(),
    )


def test_isolated_read_context_shares_observed_versions_with_writer() -> None:
    ctx = _context()
    note_id = generate_id()
    isolated = replace(ctx, session=MagicMock())

    isolated.observed_content_versions[(ContentType.NOTE, note_id)] = 4

    assert ctx.observed_content_versions[(ContentType.NOTE, note_id)] == 4


async def test_content_update_requires_expected_version() -> None:
    result = await update_note.executor(
        _context(),
        {"note_id": str(generate_id()), "content": "stale replacement"},
    )

    assert result.success is False
    assert result.error is not None
    assert "notes.read_note immediately before updating" in result.error


async def test_content_update_rejects_version_not_read_during_current_run() -> None:
    result = await update_note.executor(
        _context(),
        {
            "note_id": str(generate_id()),
            "content": "replacement from old context",
            "expected_version": 3,
        },
    )

    assert result.success is False
    assert result.error is not None
    assert "This agent run has not read that content version" in result.error


def test_update_note_schema_exposes_content_version_guard() -> None:
    expected = update_note.parameter_schema["properties"]["expected_version"]
    assert expected["type"] == "integer"
    assert expected["minimum"] == 1
    assert "stale version is rejected" in update_note.description
