"""ToolExecutor boundary emits ``agent.tool_call.<name>`` for mutating tools.

A single emission point covers every existing and future mutating
tool. These tests assert:

- Read-only tools never emit.
- Mutating tools emit exactly one row on success.
- Mutating tools emit exactly one row on failure, with
  ``details.status = "failed"`` and an ``error_reason`` tag.
- The action follows the ``agent.tool_call.<tool_name>`` shape.
"""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.errors import PermissionDeniedError
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry


def _context(
    session: MagicMock | None = None,
    *,
    allowed: frozenset[str] = frozenset(),
) -> ToolContext:
    return ToolContext(
        session=session or _stub_session(),
        user_id=generate_id(),
        organization_id=generate_id(),
        agent_id=generate_id(),
        session_id=generate_id(),
        allowed_tools=allowed,
    )


def _stub_session() -> MagicMock:
    session = MagicMock()
    session.add = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: None)
    )
    session.commit = AsyncMock()
    return session


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def _make_registry(tool: ToolDefinition) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(tool)
    return registry


async def _ok_executor(_ctx: ToolContext, _args: dict) -> ToolResult:
    return ToolResult(success=True, data='{"ok": true}')


async def _denied_executor(_ctx: ToolContext, _args: dict) -> ToolResult:
    raise PermissionDeniedError("delete", "note")


async def test_read_only_tool_does_not_audit() -> None:
    session = _stub_session()
    ctx = _context(session, allowed=frozenset({"notes.read_note"}))
    tool = ToolDefinition(
        name="notes.read_note",
        description="",
        executor=_ok_executor,
        read_only=True,
    )
    executor = ToolExecutor(_make_registry(tool), ctx)

    await executor.execute(ToolCall(id="t1", name=tool.name, input={}))

    assert _audit_rows(session) == []


async def test_mutating_tool_success_emits_single_row() -> None:
    session = _stub_session()
    ctx = _context(session, allowed=frozenset({"notes.create_note"}))
    tool = ToolDefinition(
        name="notes.create_note",
        description="",
        executor=_ok_executor,
        read_only=False,
    )
    executor = ToolExecutor(_make_registry(tool), ctx)

    await executor.execute(ToolCall(id="t1", name=tool.name, input={}))

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.action == "agent.tool_call.notes.create_note"
    assert row.details["status"] == "success"
    assert row.details["tool_name"] == "notes.create_note"
    assert row.details["actor_kind"] == "agent"
    assert row.details["agent_id"] == str(ctx.agent_id)


async def test_mutating_tool_failure_emits_failed_with_reason() -> None:
    session = _stub_session()
    ctx = _context(session, allowed=frozenset({"notes.delete_note"}))
    tool = ToolDefinition(
        name="notes.delete_note",
        description="",
        executor=_denied_executor,
        read_only=False,
    )
    executor = ToolExecutor(_make_registry(tool), ctx)

    result = await executor.execute(ToolCall(id="t1", name=tool.name, input={}))

    assert result.success is False
    rows = _audit_rows(session)
    assert len(rows) == 1
    assert rows[0].details["status"] == "failed"
    assert rows[0].details["error_reason"] == "permission_denied"


async def test_unknown_tool_does_not_audit() -> None:
    session = _stub_session()
    ctx = _context(session)
    registry = ToolRegistry()
    executor = ToolExecutor(registry, ctx)

    await executor.execute(ToolCall(id="t1", name="nope.unknown", input={}))

    assert _audit_rows(session) == []
