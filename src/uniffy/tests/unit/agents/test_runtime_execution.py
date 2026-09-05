"""Behavioral contracts for the focused runtime execution owners."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.models.agents.message import AgentMessage, AgentMessageRole
from uniffy.core.models.agents.run_log import AgentRunStatus
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    EventType,
    StreamEvent,
    ToolCall,
)
from uniffy.domains.agents.runtime.destinations import SessionDestination
from uniffy.domains.agents.runtime.runs.complete import CompletionRunner, CompletionToolLoop
from uniffy.domains.agents.runtime.runs.segments import StreamSegmentResult
from uniffy.domains.agents.runtime.runs.stream import StreamingRunner
from uniffy.domains.agents.runtime.runs.tools import StreamingToolLoop
from uniffy.domains.agents.runtime.stream import MessageStreamer
from uniffy.domains.agents.tools.definitions import (
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry


class _Writer:
    def __init__(self) -> None:
        self.approval_scope_id = generate_id()
        self.approval_actor_user_id = generate_id()
        self.approval_agent_id = generate_id()
        self.approval_channel_id = generate_id()
        self.calls: list[dict] = []
        self.finalized: list[dict] = []

    async def add_message(self, **kwargs):
        message = SimpleNamespace(id=generate_id(), **kwargs)
        self.calls.append(kwargs)
        return message

    async def finalize_assistant_placeholder(self, **kwargs):
        message = SimpleNamespace(id=kwargs["message_id"], **kwargs)
        self.finalized.append(kwargs)
        return message


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def record(self, **kwargs) -> None:
        self.calls.append(kwargs)


@pytest.mark.parametrize("tool_success", [True, False])
async def test_completion_loop_preserves_order_and_session_isolation(
    monkeypatch, tool_success
) -> None:
    import uniffy.domains.agents.tools.executor as executor_mod

    main_session = MagicMock(name="main_session")
    read_sessions: list[object] = []
    read_active = 0
    read_peak = 0
    execution_order: list[str] = []

    async def read_tool(context: ToolContext, args: dict) -> ToolResult:
        nonlocal read_active, read_peak
        read_sessions.append(context.session)
        read_active += 1
        read_peak = max(read_peak, read_active)
        await asyncio.sleep(0)
        read_active -= 1
        execution_order.append(args["label"])
        return ToolResult(
            success=tool_success,
            data=args["label"],
            error="read failed" if not tool_success else None,
        )

    async def write_tool(context: ToolContext, args: dict) -> ToolResult:
        assert context.session is main_session
        execution_order.append(args["label"])
        await asyncio.sleep(0)
        return ToolResult(
            success=tool_success,
            data=args["label"],
            error="write failed" if not tool_success else None,
        )

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="reader.one",
            description="",
            executor=read_tool,
            read_only=True,
        )
    )
    registry.register(
        ToolDefinition(
            name="reader.two",
            description="",
            executor=read_tool,
            read_only=True,
        )
    )
    registry.register(ToolDefinition(name="writer.one", description="", executor=write_tool))
    registry.register(ToolDefinition(name="writer.two", description="", executor=write_tool))

    created_sessions: list[object] = []

    @asynccontextmanager
    async def session_factory():
        session = MagicMock(name=f"read_session_{len(created_sessions)}")
        created_sessions.append(session)
        yield session

    session_operations = MagicMock()
    session_operations.add_message = AsyncMock(
        side_effect=lambda **kwargs: SimpleNamespace(id=generate_id(), **kwargs)
    )
    monkeypatch.setattr(executor_mod, "fetch_agent_row", AsyncMock(return_value=None))
    monkeypatch.setattr(executor_mod, "write_audit_event", AsyncMock())

    calls = [
        ToolCall(id="r1", name="reader-one", input={"label": "read-one"}),
        ToolCall(id="w1", name="writer-one", input={"label": "write-one"}),
        ToolCall(id="r2", name="reader-two", input={"label": "read-two"}),
        ToolCall(id="w2", name="writer-two", input={"label": "write-two"}),
    ]
    initial = CompletionResult(
        content="checking",
        model="primary",
        stop_reason=CompletionStopReason.TOOL_USE,
        tool_calls=calls,
    )
    captured_messages: list[dict] = []

    class Provider:
        name = "test"

        async def chat_completion(self, **kwargs):
            captured_messages.extend(kwargs["messages"])
            return CompletionResult(content="done", model="primary")

    context = ToolContext(
        session=main_session,
        user_id=generate_id(),
        organization_id=generate_id(),
        allowed_tools=frozenset(registry.get(call.name).name for call in calls),
    )
    traces = []
    result = await CompletionToolLoop(session_operations, session_factory).run(
        user_id=context.user_id,
        organization_id=context.organization_id,
        session_id=generate_id(),
        agent_id=generate_id(),
        provider=Provider(),
        model="primary",
        system_prompt="system",
        tool_schemas=[{"name": call.name} for call in calls],
        llm_messages=[],
        result=initial,
        executor=ToolExecutor(registry, context),
        run_tool_calls=traces,
    )

    assert result.content == "done"
    assert traces == [
        {"name": call.name, "call_id": call.id, "success": tool_success} for call in calls
    ]
    assert read_peak == 2
    assert len(read_sessions) == 2
    assert set(read_sessions) == set(created_sessions)
    assert main_session not in read_sessions
    assert execution_order[-2:] == ["write-one", "write-two"]
    persisted = [call.kwargs for call in session_operations.add_message.await_args_list]
    assert [item["role"] for item in persisted] == [
        AgentMessageRole.ASSISTANT,
        AgentMessageRole.ASSISTANT,
        AgentMessageRole.ASSISTANT,
        AgentMessageRole.ASSISTANT,
        AgentMessageRole.TOOL,
        AgentMessageRole.TOOL,
        AgentMessageRole.TOOL,
        AgentMessageRole.TOOL,
    ]
    assert [item["tool_name"] for item in persisted] == [
        "reader-one",
        "writer-one",
        "reader-two",
        "writer-two",
        "reader-one",
        "writer-one",
        "reader-two",
        "writer-two",
    ]
    assert [block["tool_use_id"] for block in captured_messages[-1]["content"]] == [
        "r1",
        "w1",
        "r2",
        "w2",
    ]


async def test_streaming_loop_rejection_and_placeholder_finalization(monkeypatch) -> None:
    import uniffy.domains.agents.runtime.runs.tools as tools_mod

    executed = False

    async def destructive_tool(_context: ToolContext, _args: dict) -> ToolResult:
        nonlocal executed
        executed = True
        return ToolResult(success=True, data="deleted")

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="files.delete",
            description="",
            executor=destructive_tool,
            destructive=True,
        )
    )
    context = ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        allowed_tools=frozenset({"files.delete"}),
    )
    approval_store = MagicMock()
    approval_store.register = AsyncMock()
    approval_store.wait_for_response = AsyncMock(return_value=False)
    monkeypatch.setattr(tools_mod, "get_approval_store", lambda: approval_store)
    monkeypatch.setattr(tools_mod, "get_tool_registry", lambda: registry)

    placeholder_id = generate_id()

    async def controlled_segment(**_kwargs):
        yield StreamSegmentResult(
            completion=CompletionResult(content="finished", model="primary"),
            error=None,
            error_exception=None,
            placeholder_id=placeholder_id,
        )

    monkeypatch.setattr(tools_mod, "controlled_stream_segment", controlled_segment)
    writer = _Writer()
    initial = CompletionResult(
        content="",
        model="primary",
        stop_reason=CompletionStopReason.TOOL_USE,
        tool_calls=[ToolCall(id="delete-1", name="files-delete", input={})],
    )
    traces = []
    events = [
        event
        async for event in StreamingToolLoop(MagicMock()).run(
            writer=writer,
            agent_id=generate_id(),
            system_prompt="system",
            tool_schemas=[{"name": "files-delete"}],
            llm_messages=[],
            result=initial,
            executor=ToolExecutor(registry, context),
            run_tool_calls=traces,
            call_controller=MagicMock(),
            safety_identifier="digest",
            pending_thinking=None,
            deferred_pool=None,
        )
    ]

    assert [event.type for event in events] == [
        EventType.TOOL_RESULT_START,
        EventType.CONFIRMATION_REQUIRED,
        EventType.TOOL_RESULT_END,
        EventType.DONE,
    ]
    assert executed is False
    assert traces == [{"name": "files-delete", "call_id": "delete-1", "success": False}]
    assert events[2].success is False
    assert "rejected" in events[2].tool_result
    approval_store.register.assert_awaited_once()
    approval_store.wait_for_response.assert_awaited_once()
    assert writer.finalized[0]["message_id"] == placeholder_id
    assert events[-1].assistant_message.id == placeholder_id


@pytest.mark.parametrize("success", [True, False])
async def test_streaming_tool_trace_records_read_and_write_outcomes(monkeypatch, success):
    import uniffy.domains.agents.runtime.runs.tools as tools_mod

    async def execute(context, args):
        return ToolResult(success=success, data="result", error=None if success else "failed")

    registry = ToolRegistry()
    registry.register(
        ToolDefinition(name="notes.read", description="", executor=execute, read_only=True)
    )
    registry.register(ToolDefinition(name="notes.write", description="", executor=execute))
    context = ToolContext(
        session=MagicMock(),
        user_id=generate_id(),
        organization_id=generate_id(),
        allowed_tools=frozenset({"notes.read", "notes.write"}),
    )
    executor = ToolExecutor(registry, context)
    monkeypatch.setattr(executor, "execute", AsyncMock(return_value=await execute(None, {})))
    monkeypatch.setattr(tools_mod, "get_tool_registry", lambda: registry)
    monkeypatch.setattr(
        tools_mod,
        "gather_read_tool_results",
        AsyncMock(
            return_value={
                "read": await execute(None, {}),
            }
        ),
    )

    async def segment(**kwargs):
        yield StreamSegmentResult(
            completion=CompletionResult(content="done", model="test"),
            error=None,
            error_exception=None,
            placeholder_id=None,
        )

    monkeypatch.setattr(tools_mod, "controlled_stream_segment", segment)
    traces = []
    events = [
        event
        async for event in StreamingToolLoop(MagicMock()).run(
            writer=_Writer(),
            agent_id=generate_id(),
            system_prompt="system",
            tool_schemas=[{"name": "notes-read"}, {"name": "notes-write"}],
            llm_messages=[],
            result=CompletionResult(
                content="",
                model="test",
                stop_reason=CompletionStopReason.TOOL_USE,
                tool_calls=[
                    ToolCall(id="read", name="notes-read", input={}),
                    ToolCall(id="write", name="notes-write", input={}),
                ],
            ),
            executor=executor,
            run_tool_calls=traces,
            call_controller=MagicMock(),
            safety_identifier=None,
            pending_thinking=None,
            deferred_pool=None,
        )
    ]
    assert events[-1].type == EventType.DONE
    assert traces == [
        {"name": "notes-read", "call_id": "read", "success": success},
        {"name": "notes-write", "call_id": "write", "success": success},
    ]


def _streaming_runner(recorder: _Recorder, tool_loop) -> StreamingRunner:
    return StreamingRunner(
        session=MagicMock(),
        provider_operations=MagicMock(),
        recorder=recorder,
        tool_loop=tool_loop,
    )


async def _run_streaming_runner(
    monkeypatch, segment, *, tool_loop=None, tools=None, invocation=None
):
    import uniffy.domains.agents.runtime.runs.stream as stream_mod

    async def controlled_segment(**_kwargs):
        if isinstance(segment, list):
            for item in segment:
                if isinstance(item, BaseException):
                    raise item
                yield item
        elif segment is not None:
            yield segment

    monkeypatch.setattr(stream_mod, "controlled_stream_segment", controlled_segment)
    monkeypatch.setattr(
        stream_mod,
        "get_runtime_settings",
        AsyncMock(return_value=SimpleNamespace(send_deadline_seconds=30)),
    )
    recorder = _Recorder()
    writer = _Writer()
    runner = _streaming_runner(recorder, tool_loop or MagicMock())
    events = [
        event
        async for event in runner.run(
            writer=writer,
            invocation=invocation,
            user_id=generate_id(),
            organization_id=generate_id(),
            session_id=generate_id(),
            channel_id=None,
            agent_id=generate_id(),
            provider=SimpleNamespace(name="test"),
            provider_key_id=generate_id(),
            model="primary",
            fallback_models=[],
            agent_model_params={},
            params_override=None,
            request_params=None,
            system_prompt="system",
            tool_schemas=tools,
            llm_messages=[],
            registry=MagicMock(),
            tool_context=ToolContext(
                session=MagicMock(),
                user_id=generate_id(),
                organization_id=generate_id(),
            ),
            deferred_pool={},
        )
    ]
    return events, recorder, writer


async def test_streaming_runner_records_success_terminal(monkeypatch) -> None:
    completion = CompletionResult(content="done", model="resolved")
    segment = StreamSegmentResult(
        completion=completion,
        error=None,
        error_exception=None,
        placeholder_id=None,
    )

    events, recorder, writer = await _run_streaming_runner(monkeypatch, segment)

    assert [event.type for event in events] == [EventType.DONE]
    assert writer.calls[-1]["content"] == "done"
    assert recorder.calls[0]["status"] is AgentRunStatus.SUCCESS
    assert recorder.calls[0]["model"] == "resolved"


async def test_streaming_runner_records_provider_error_terminal(monkeypatch) -> None:
    segment = StreamSegmentResult(
        completion=None,
        error="provider detail",
        error_exception=RuntimeError("provider detail"),
        placeholder_id=None,
    )

    events, recorder, _writer = await _run_streaming_runner(monkeypatch, segment)

    assert [event.type for event in events] == [EventType.ERROR]
    assert events[0].error == "Model provider request failed"
    assert recorder.calls[0]["status"] is AgentRunStatus.ERROR
    assert recorder.calls[0]["error"] == "provider detail"


async def test_streaming_runner_records_missing_terminal(monkeypatch) -> None:
    events, recorder, _writer = await _run_streaming_runner(monkeypatch, None)

    assert [event.type for event in events] == [EventType.ERROR]
    assert events[0].error == "No response from LLM"
    assert recorder.calls[0]["status"] is AgentRunStatus.ERROR
    assert recorder.calls[0]["error"] == "No response from LLM"


async def test_streaming_runner_records_incomplete_tool_loop(monkeypatch) -> None:
    class ToolLoop:
        async def run(self, **_kwargs):
            yield StreamEvent(type=EventType.EXCEED_MAX_ITERS)
            yield StreamEvent(type=EventType.ERROR, error="iteration limit")

    segment = StreamSegmentResult(
        completion=CompletionResult(
            content="",
            model="primary",
            stop_reason=CompletionStopReason.TOOL_USE,
            tool_calls=[ToolCall(id="tool-1", name="search-query", input={})],
        ),
        error=None,
        error_exception=None,
        placeholder_id=None,
    )

    events, recorder, _writer = await _run_streaming_runner(
        monkeypatch,
        segment,
        tool_loop=ToolLoop(),
        tools=[{"name": "search-query"}],
    )

    assert [event.type for event in events] == [
        EventType.EXCEED_MAX_ITERS,
        EventType.ERROR,
    ]
    assert recorder.calls[0]["status"] is AgentRunStatus.ERROR
    assert recorder.calls[0]["error"] == "iteration limit"


async def test_streaming_runner_records_tool_loop_success(monkeypatch) -> None:
    assistant = SimpleNamespace(id=generate_id())

    class ToolLoop:
        async def run(self, **_kwargs):
            yield StreamEvent(
                type=EventType.DONE,
                assistant_message=assistant,
                model="resolved",
            )

    segment = StreamSegmentResult(
        completion=CompletionResult(
            content="",
            model="primary",
            stop_reason=CompletionStopReason.TOOL_USE,
            tool_calls=[ToolCall(id="tool-1", name="search-query", input={})],
        ),
        error=None,
        error_exception=None,
        placeholder_id=None,
    )

    events, recorder, _writer = await _run_streaming_runner(
        monkeypatch,
        segment,
        tool_loop=ToolLoop(),
        tools=[{"name": "search-query"}],
    )

    assert [event.type for event in events] == [EventType.DONE]
    assert events[0].assistant_message is assistant
    assert recorder.calls[0]["status"] is AgentRunStatus.SUCCESS
    assert recorder.calls[0]["model"] == "resolved"


async def _run_completion_runner(monkeypatch, provider, recorder=None, invocation=None):
    import uniffy.domains.agents.runtime.runs.complete as complete_mod

    monkeypatch.setattr(
        complete_mod,
        "get_runtime_settings",
        AsyncMock(
            return_value=SimpleNamespace(
                send_deadline_seconds=30,
                failover_enabled=False,
                circuit_breaker_failure_threshold=5,
                circuit_breaker_recovery_seconds=60,
            )
        ),
    )
    session_operations = MagicMock()
    session_operations.add_message = AsyncMock(
        side_effect=lambda **kwargs: SimpleNamespace(id=generate_id(), **kwargs)
    )
    recorder = recorder or _Recorder()
    runner = CompletionRunner(
        session=MagicMock(),
        session_operations=session_operations,
        session_factory=MagicMock(),
        provider_operations=MagicMock(),
        recorder=recorder,
    )
    result = await runner.run(
        invocation=invocation,
        user_id=generate_id(),
        organization_id=generate_id(),
        session_id=generate_id(),
        agent_id=generate_id(),
        provider=provider,
        provider_key_id=None,
        model="primary",
        fallback_models=[],
        agent_model_params={},
        request_params=None,
        system_prompt="system",
        tool_schemas=None,
        llm_messages=[],
        registry=MagicMock(),
        tool_context=ToolContext(
            session=MagicMock(),
            user_id=generate_id(),
            organization_id=generate_id(),
        ),
        deferred_pool={},
    )
    return result, recorder


async def test_completion_runner_records_success_terminal(monkeypatch) -> None:
    class Provider:
        name = "test"

        async def chat_completion(self, **_kwargs):
            return CompletionResult(content="done", model="resolved")

    (message, model), recorder = await _run_completion_runner(monkeypatch, Provider())

    assert message.content == "done"
    assert model == "resolved"
    assert recorder.calls[0]["status"] is AgentRunStatus.SUCCESS
    assert recorder.calls[0]["model"] == "resolved"


async def test_completion_runner_records_error_terminal(monkeypatch) -> None:
    class Provider:
        name = "test"

        async def chat_completion(self, **_kwargs):
            raise ValueError("invalid request")

    recorder = _Recorder()
    with pytest.raises(ValueError, match="invalid request"):
        await _run_completion_runner(monkeypatch, Provider(), recorder)

    assert recorder.calls[0]["status"] is AgentRunStatus.ERROR
    assert recorder.calls[0]["error"] == "invalid request"


async def test_message_streamer_rerun_preserves_anchor_and_destination() -> None:
    streamer = object.__new__(MessageStreamer)
    session_id = generate_id()
    anchor = AgentMessage(
        id=generate_id(),
        session_id=session_id,
        role=AgentMessageRole.USER,
        content="original",
    )
    streamer._session_operations = SimpleNamespace(
        load_message=AsyncMock(return_value=(anchor, SimpleNamespace(id=session_id)))
    )
    captured: dict = {}

    async def stream(**kwargs):
        captured.update(kwargs)
        yield StreamEvent(type=EventType.REPLY_START)

    streamer.stream = stream
    events = [
        event
        async for event in streamer.rerun(
            user_id=generate_id(),
            organization_id=generate_id(),
            message_id=anchor.id,
            user_timezone="UTC",
        )
    ]

    assert [event.type for event in events] == [EventType.REPLY_START]
    assert captured["destination"] == SessionDestination(session_id=session_id)
    assert captured["rerun_anchor"] is anchor
    assert captured["content"] == ""
