"""Request-context propagation across ``asyncio.gather`` in the tool loop.

Read-only tools fan out concurrently against per-tool sessions. Python
3.13 copies the running ``Context`` per task by default, so the IP /
UA captured by ``RequestContextMiddleware`` survives the fan-out and
reaches every concurrent audit write inside the request.
"""

import asyncio
from contextvars import copy_context
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from uniffy.core.audit.request_context import (
    audit_ip_var,
    audit_user_agent_var,
)
from uniffy.domains.agents.providers.base import ToolCall
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry


async def _ok_executor(_ctx: ToolContext, _args: dict) -> ToolResult:
    return ToolResult(success=True, data='{"ok": true}')


def _audit_rows(session: MagicMock) -> list:
    return [
        call.args[0]
        for call in session.add.call_args_list
        if call.args and call.args[0].__class__.__name__ == "AuditEvent"
    ]


def test_gather_fan_out_inherits_audit_ip_and_user_agent() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: None)
    )
    session.commit = AsyncMock()

    tool = ToolDefinition(
        name="notes.create_note",
        description="",
        executor=_ok_executor,
        read_only=False,
    )
    registry = ToolRegistry()
    registry.register(tool)

    ctx = ToolContext(
        session=session,
        user_id=uuid4(),
        organization_id=uuid4(),
        agent_id=uuid4(),
    )

    async def fan_out() -> None:
        executor = ToolExecutor(registry, ctx)
        await asyncio.gather(
            executor.execute(ToolCall(id="t1", name=tool.name, input={})),
            executor.execute(ToolCall(id="t2", name=tool.name, input={})),
            executor.execute(ToolCall(id="t3", name=tool.name, input={})),
        )

    def run_with_context() -> None:
        audit_ip_var.set("192.0.2.50")
        audit_user_agent_var.set("uniffy-test-runner")
        asyncio.run(fan_out())

    ctx_copy = copy_context()
    ctx_copy.run(run_with_context)

    rows = _audit_rows(session)
    assert len(rows) == 3
    for row in rows:
        assert row.ip_address == "192.0.2.50"
        assert row.user_agent == "uniffy-test-runner"
