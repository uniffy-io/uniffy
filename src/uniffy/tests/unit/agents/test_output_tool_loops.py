from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    EventType,
    ToolCall,
)
from uniffy.domains.agents.runtime import output
from uniffy.domains.agents.runtime.output_format import OutputSurface
from uniffy.domains.agents.runtime.runs.complete import CompletionToolLoop
from uniffy.domains.agents.runtime.runs.segments import StreamSegmentResult
from uniffy.domains.agents.runtime.runs.tools import StreamingToolLoop
from uniffy.domains.agents.runtime.writers import SessionMessageWriter
from uniffy.domains.agents.tools.builtin.args import markdown_body
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry


@pytest.mark.parametrize("streaming", [False, True])
async def test_each_tool_turn_uses_producing_model_after_fallback(monkeypatch, streaming):
    import uniffy.domains.agents.runtime.runs.tools as tools_mod

    seen = []
    counter = MagicMock()
    monkeypatch.setattr(output, "AGENT_OUTPUT_REPAIRS_TOTAL", counter)

    async def write(context, args):
        seen.append((context.output_provider, context.output_model))
        return ToolResult(
            success=True, data=markdown_body(context, args["content"], OutputSurface.NOTE)
        )

    registry = ToolRegistry()
    registry.register(ToolDefinition(name="notes.write", description="", executor=write))
    monkeypatch.setattr(tools_mod, "get_tool_registry", lambda: registry)
    ctx = ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        allowed_tools=frozenset({"notes.write"}),
    )
    calls = [
        ToolCall(id=f"call-{index}", name="notes-write", input={"content": "```md\nBody\n```"})
        for index in range(2)
    ]
    initial = CompletionResult(
        content="working",
        model="first-model",
        tool_calls=[calls[0]],
        stop_reason=CompletionStopReason.TOOL_USE,
    )
    responses = iter([
        CompletionResult(
            content="working",
            model="second-model",
            tool_calls=[calls[1]],
            stop_reason=CompletionStopReason.TOOL_USE,
        ),
        CompletionResult(content="done", model="second-model"),
    ])
    controller = SimpleNamespace(target=SimpleNamespace(provider_name="openai"))

    async def complete(**_kwargs):
        controller.target = SimpleNamespace(provider_name="openrouter")
        return next(responses)

    controller.complete = complete
    session_ops = SimpleNamespace(
        add_message=AsyncMock(side_effect=lambda **kwargs: AgentMessage(**kwargs))
    )
    kwargs = dict(
        agent_id=generate_id(),
        system_prompt="system",
        tool_schemas=[{"name": "notes-write"}],
        llm_messages=[],
        result=initial,
        executor=ToolExecutor(registry, ctx),
        run_tool_calls=[],
        call_controller=controller,
        deferred_pool={},
    )
    if streaming:

        async def segment(**_kwargs):
            yield StreamSegmentResult(
                completion=await complete(),
                error=None,
                error_exception=None,
                placeholder_id=None,
            )

        monkeypatch.setattr(tools_mod, "controlled_stream_segment", segment)
        writer = SessionMessageWriter(
            session_ops=session_ops,
            user_id=ctx.user_id,
            organization_id=ctx.organization_id,
            session_id=generate_id(),
        )
        events = [
            event
            async for event in StreamingToolLoop(MagicMock()).run(
                **kwargs,
                writer=writer,
                safety_identifier=None,
                pending_thinking=None,
            )
        ]
        assert events[-1].type == EventType.DONE
    else:
        result = await CompletionToolLoop(session_ops, MagicMock()).run(
            **kwargs,
            user_id=ctx.user_id,
            organization_id=ctx.organization_id,
            session_id=generate_id(),
            provider=SimpleNamespace(name="openai"),
            model="first-model",
        )
        assert result.content == "done"
    assert seen == [("openai", "first-model"), ("openrouter", "second-model")]
    assert [call.kwargs for call in counter.labels.call_args_list] == [
        {"kind": "fence_unwrap", "surface": "note", "provider": "openai"},
        {"kind": "fence_unwrap", "surface": "note", "provider": "openrouter"},
    ]
