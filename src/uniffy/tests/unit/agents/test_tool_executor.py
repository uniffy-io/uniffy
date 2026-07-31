"""ToolExecutor: the enabled-tool gate, metadata carry-through, error sanitization."""

from unittest.mock import MagicMock

from uniffy.core.errors import RateLimitExceededError
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.executor import MAX_TOOL_RESULT_CHARS, ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry


def _executor_for(
    tool: ToolDefinition,
    *,
    allowed: frozenset[str] | None = None,
) -> ToolExecutor:
    registry = ToolRegistry()
    registry.register(tool)
    ctx = ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        allowed_tools=frozenset({tool.name}) if allowed is None else allowed,
    )
    return ToolExecutor(registry, ctx)


def _call(name: str) -> ToolCall:
    return ToolCall(id="tc_1", name=name, input={})


async def test_unadvertised_tool_never_executes() -> None:
    ran = False

    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        nonlocal ran
        ran = True
        return ToolResult(success=True, data="deleted")

    tool = ToolDefinition(name="files.delete_file", description="", executor=_exec)
    executor = _executor_for(tool, allowed=frozenset({"notes.read_note"}))
    result = await executor.execute(_call("files.delete_file"))

    assert ran is False
    assert not result.success
    assert result.error is not None
    assert "not enabled" in result.error


async def test_enabled_tool_executes() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(success=True, data="ok")

    tool = ToolDefinition(name="notes.read_note", description="", executor=_exec, read_only=True)
    executor = _executor_for(tool, allowed=frozenset({"notes.read_note"}))
    result = await executor.execute(_call("notes.read_note"))

    assert result.success


async def test_internal_tool_runs_without_being_in_the_enabled_set() -> None:
    # view_skill / load_group are advertised by the runtime itself and are
    # absent from every builder's enabled set by design.
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(success=True, data="loaded")

    tool = ToolDefinition(
        name="tools.load_group",
        description="",
        executor=_exec,
        internal=True,
    )
    executor = _executor_for(tool, allowed=frozenset())
    result = await executor.execute(_call("tools.load_group"))

    assert result.success


async def test_empty_allowed_set_denies_every_non_internal_tool() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(success=True, data="ok")

    tool = ToolDefinition(name="notes.read_note", description="", executor=_exec, read_only=True)
    executor = _executor_for(tool, allowed=frozenset())
    result = await executor.execute(_call("notes.read_note"))

    assert not result.success


async def test_success_result_keeps_metadata() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(success=True, data="done", metadata={"url": "https://x/1"})

    tool = ToolDefinition(name="t.read", description="", executor=_exec, read_only=True)
    result = await _executor_for(tool).execute(_call("t.read"))
    assert result.success
    assert result.data == "done"
    assert result.metadata == {"url": "https://x/1"}


async def test_truncated_result_keeps_metadata() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(
            success=True,
            data="x" * (MAX_TOOL_RESULT_CHARS + 1),
            metadata={"n": 1},
        )

    tool = ToolDefinition(name="t.big", description="", executor=_exec, read_only=True)
    result = await _executor_for(tool).execute(_call("t.big"))
    assert "[Truncated" in result.data
    assert result.metadata == {"n": 1}


async def test_rate_limit_error_surfaces_retry_after() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        raise RateLimitExceededError("github", 30, 60, retry_after=42)

    tool = ToolDefinition(name="t.limited", description="", executor=_exec, read_only=True)
    result = await _executor_for(tool).execute(_call("t.limited"))
    assert not result.success
    assert result.error is not None
    assert "retry after 42s" in result.error


async def test_sensitive_exception_is_genericized() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        raise RuntimeError("relation missing: SELECT * FROM users WHERE id = 1")

    tool = ToolDefinition(name="t.leaky", description="", executor=_exec, read_only=True)
    result = await _executor_for(tool).execute(_call("t.leaky"))
    assert not result.success
    assert result.error == (
        "Internal error executing t.leaky. The operation could not be completed."
    )
    assert "SELECT" not in result.error
