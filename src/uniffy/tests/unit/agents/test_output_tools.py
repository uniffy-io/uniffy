from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.types import ContentType, generate_id
from uniffy.domains.agents.tools.builtin import calendar, notes, projects
from uniffy.domains.agents.tools.definitions import ToolContext

URN = "urn:uniffy:content:NOTE:019558e0-8700-7000-8000-000000000001"
RAW = f"```md\n[Self]: [[Roadmap|{URN}]]\n```"
EXPECTED = f"[Self]: [[[Roadmap|{URN}]]]\n"


@pytest.fixture
def mutations(monkeypatch):
    import uniffy.domains.projects.operations as project_ops
    import uniffy.domains.scheduling.calendar.operations as calendar_ops
    import uniffy.domains.scheduling.calendar.queries as calendar_queries

    ctx = ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        storage=MagicMock(),
        search_indexer=MagicMock(),
        call_lifecycle=MagicMock(),
        output_provider="openrouter",
        output_model="mock-model",
    )
    row = SimpleNamespace(id=generate_id(), version=4, title="Roadmap")
    ctx.observed_content_versions[ContentType.NOTE, row.id] = row.version
    note_ops, task_ops, event_ops = MagicMock(), MagicMock(), MagicMock()
    for ops in [note_ops, task_ops, event_ops]:
        ops.create = AsyncMock(return_value=row)
        ops.update = AsyncMock(return_value=row)
    task_ops.update.return_value = (row, [])
    monkeypatch.setattr(notes, "NoteOperations", lambda *_args: note_ops)
    monkeypatch.setattr(project_ops, "TaskOperations", lambda *_args: task_ops)
    monkeypatch.setattr(calendar_ops, "CalendarEventOperations", lambda *_args: event_ops)
    monkeypatch.setattr(calendar_queries, "ensure_default_calendar", AsyncMock(return_value=row))
    monkeypatch.setattr(projects, "_format_task_result", lambda *_args: "Task saved")
    monkeypatch.setattr(calendar, "_format_event_result", AsyncMock(return_value="Event saved"))
    return ctx, row, note_ops, task_ops, event_ops


@pytest.mark.parametrize("domain", ["note", "task", "event"])
@pytest.mark.parametrize("operation", ["create", "update"])
async def test_body_tools_normalize_before_domain_mutation(mutations, domain, operation):
    ctx, row, note_ops, task_ops, event_ops = mutations
    identifier = str(row.id)
    args = dict(
        title="Roadmap",
        project_id=identifier,
        note_id=identifier,
        task_id=identifier,
        event_id=identifier,
        expected_version=row.version,
        start_time="2026-09-21T10:00:00Z",
        end_time="2026-09-21T11:00:00Z",
    )
    module, ops, field = {
        "note": (notes, note_ops, "content"),
        "task": (projects, task_ops, "description"),
        "event": (calendar, event_ops, "description"),
    }[domain]
    args[field] = RAW
    result = await getattr(module, f"_execute_{operation}_{domain}")(ctx, args)
    assert result.success
    stored = getattr(ops, operation).await_args.kwargs
    assert stored[field] == EXPECTED
    assert stored["user_id"] == ctx.user_id
    assert stored["organization_id"] == ctx.organization_id
    assert args[field] == RAW
    if domain == "note" and operation == "update":
        assert stored["expected_content_version"] == row.version


@pytest.mark.parametrize("domain", ["note", "task", "event"])
@pytest.mark.parametrize("body", [None, ""])
async def test_updates_preserve_omission_and_explicit_empty_body(mutations, domain, body):
    ctx, row, note_ops, task_ops, event_ops = mutations
    module, ops, field = {
        "note": (notes, note_ops, "content"),
        "task": (projects, task_ops, "description"),
        "event": (calendar, event_ops, "description"),
    }[domain]
    args = {f"{domain}_id": str(row.id), "title": "Renamed"}
    if body is not None:
        args[field] = body
        args["expected_version"] = row.version
    result = await getattr(module, f"_execute_update_{domain}")(ctx, args)
    assert result.success
    stored = ops.update.await_args.kwargs
    if body is None:
        assert stored.get(field) is None
    else:
        assert stored[field] == ""


async def test_note_normalization_does_not_bypass_fresh_read_guard(mutations):
    ctx, row, note_ops, *_ = mutations
    ctx.observed_content_versions.clear()
    result = await notes._execute_update_note(
        ctx,
        {
            "note_id": str(row.id),
            "content": RAW,
            "expected_version": row.version,
        },
    )
    assert not result.success
    assert "has not read" in result.error
    note_ops.update.assert_not_awaited()
