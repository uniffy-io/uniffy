"""ToolExecutor result handling: metadata carry-through and error sanitization."""

import asyncio
from unittest.mock import MagicMock
from uuid import uuid4

from uniffy.core.errors import RateLimitExceededError
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.executor import MAX_TOOL_RESULT_CHARS, ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry


def _executor_for(tool: ToolDefinition) -> ToolExecutor:
    registry = ToolRegistry()
    registry.register(tool)
    ctx = ToolContext(session=MagicMock(), user_id=uuid4(), organization_id=uuid4())
    return ToolExecutor(registry, ctx)


def _call(name: str) -> ToolCall:
    return ToolCall(id="tc_1", name=name, input={})


def test_success_result_keeps_metadata() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(success=True, data="done", metadata={"url": "https://x/1"})

    tool = ToolDefinition(name="t.read", description="", executor=_exec, read_only=True)
    result = asyncio.run(_executor_for(tool).execute(_call("t.read")))
    assert result.success
    assert result.data == "done"
    assert result.metadata == {"url": "https://x/1"}


def test_truncated_result_keeps_metadata() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        return ToolResult(
            success=True,
            data="x" * (MAX_TOOL_RESULT_CHARS + 1),
            metadata={"n": 1},
        )

    tool = ToolDefinition(name="t.big", description="", executor=_exec, read_only=True)
    result = asyncio.run(_executor_for(tool).execute(_call("t.big")))
    assert "[Truncated" in result.data
    assert result.metadata == {"n": 1}


def test_rate_limit_error_surfaces_retry_after() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        raise RateLimitExceededError("github", 30, 60, retry_after=42)

    tool = ToolDefinition(name="t.limited", description="", executor=_exec, read_only=True)
    result = asyncio.run(_executor_for(tool).execute(_call("t.limited")))
    assert not result.success
    assert result.error is not None
    assert "retry after 42s" in result.error


def test_sensitive_exception_is_genericized() -> None:
    async def _exec(_ctx: ToolContext, _args: dict) -> ToolResult:
        raise RuntimeError("relation missing: SELECT * FROM users WHERE id = 1")

    tool = ToolDefinition(name="t.leaky", description="", executor=_exec, read_only=True)
    result = asyncio.run(_executor_for(tool).execute(_call("t.leaky")))
    assert not result.success
    assert result.error == (
        "Internal error executing t.leaky. The operation could not be completed."
    )
    assert "SELECT" not in result.error
