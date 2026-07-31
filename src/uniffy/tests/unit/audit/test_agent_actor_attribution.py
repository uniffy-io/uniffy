"""Agent-as-actor attribution convention.

When an agent acts on behalf of its human owner, audit rows attribute
to the **human** via ``actor_user_id`` and surface the agent's
identity through ``details.actor_kind = "agent"`` plus
``details.agent_id``. ``on_behalf_of_user_id`` is reserved and stays
``None``.
"""

from unittest.mock import AsyncMock, MagicMock

from uniffy.core.types import generate_id
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


async def test_tool_call_attributes_to_human_with_agent_kind_detail() -> None:
    session = MagicMock()
    session.add = MagicMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=lambda: None)
    )
    session.commit = AsyncMock()

    human_id = generate_id()
    agent_id = generate_id()
    ctx = ToolContext(
        session=session,
        user_id=human_id,
        organization_id=generate_id(),
        agent_id=agent_id,
        allowed_tools=frozenset({"notes.create_note"}),
    )

    tool = ToolDefinition(
        name="notes.create_note",
        description="",
        executor=_ok_executor,
        read_only=False,
    )
    registry = ToolRegistry()
    registry.register(tool)
    executor = ToolExecutor(registry, ctx)

    await executor.execute(ToolCall(id="t1", name=tool.name, input={}))

    rows = _audit_rows(session)
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_user_id == human_id
    assert row.on_behalf_of_user_id is None
    assert row.details["actor_kind"] == "agent"
    assert row.details["agent_id"] == str(agent_id)
