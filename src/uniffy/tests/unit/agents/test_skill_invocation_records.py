import asyncio
import time
from contextlib import aclosing, asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.skill import SkillSurface
from uniffy.core.models.agents.skill_invocation import (
    AgentSkillInvocation,
    SkillInvocationStatus,
    SkillInvocationErrorCode,
)
from uniffy.core.types import generate_id
from uniffy.domains.agents.skills.invocations import InvocationTarget, SkillInvocationRecorder
from uniffy.domains.agents.runtime.skills import InvocationRun
from uniffy.domains.agents.providers.base import CompletionResult, EventType, StreamEvent
from uniffy.domains.agents.runtime.runs.segments import StreamSegmentResult
from uniffy.tests.unit.agents.test_runtime_execution import (
    _run_completion_runner,
    _run_streaming_runner,
)


def target(**overrides):
    return InvocationTarget(**{
        "organization_id": generate_id(),
        "user_id": generate_id(),
        "agent_id": generate_id(),
        "skill_id": generate_id(),
        "skill_version_id": generate_id(),
        "skill_version_number": 2,
        "surface": SkillSurface.SESSION,
        "session_id": generate_id(),
        **overrides,
    })


@pytest.mark.parametrize(
    "overrides",
    [
        {"session_id": None},
        {"channel_id": generate_id()},
        {"surface": SkillSurface.CHAT},
        {"skill_version_number": 0},
    ],
)
def test_invocation_target_rejects_ambiguous_destination_and_version(overrides):
    with pytest.raises(ValidationError):
        target(**overrides)


@pytest.fixture
def persistence():
    session = MagicMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()

    @asynccontextmanager
    async def factory():
        yield session

    return SkillInvocationRecorder(factory), session


async def test_start_failure_prevents_an_unobserved_invocation(persistence):
    recorder, session = persistence
    session.execute.side_effect = RuntimeError("unavailable")
    with pytest.raises(RuntimeError, match="unavailable"):
        await recorder.start(invocation_id=generate_id(), target=target())
    session.commit.assert_not_awaited()


async def test_start_returns_detached_exact_target(persistence):
    recorder, session = persistence
    selected = target()
    row = AgentSkillInvocation(id=generate_id(), **selected.values())
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    session.execute.return_value = result
    stored = await recorder.start(invocation_id=row.id, target=selected)
    assert stored.skill_version_id == selected.skill_version_id
    assert stored.skill_version_number == 2
    session.expunge.assert_called_once_with(row)
    session.commit.assert_awaited_once()


async def test_finalization_failure_is_nonfatal(persistence):
    recorder, session = persistence
    session.execute.side_effect = RuntimeError("unavailable")
    assert not await recorder.finalize(
        invocation_id=generate_id(),
        organization_id=generate_id(),
        status=SkillInvocationStatus.FAILED,
    )


async def test_finalization_rejects_nonterminal_status(persistence):
    recorder, session = persistence
    with pytest.raises(ValidationError):
        await recorder.finalize(
            invocation_id=generate_id(),
            organization_id=generate_id(),
            status=SkillInvocationStatus.STARTED,
        )
    session.execute.assert_not_awaited()


@pytest.fixture
def invocation(monkeypatch):
    recorder = SimpleNamespace(
        start=AsyncMock(return_value=SimpleNamespace(status=SkillInvocationStatus.STARTED)),
        finalize=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(
        "uniffy.domains.agents.runtime.skills.SkillInvocationRecorder", lambda _: recorder
    )
    return InvocationRun(MagicMock()), recorder


@pytest.mark.parametrize("surface", list(SkillSurface))
@pytest.mark.parametrize("failure", [False, True])
async def test_stream_invocation_terminal_correlates_response_before_done(
    monkeypatch, invocation, surface, failure
):
    run, recorder = invocation
    selected = target(
        surface=surface,
        session_id=generate_id() if surface == SkillSurface.SESSION else None,
        channel_id=generate_id() if surface == SkillSurface.CHAT else None,
    )
    placeholder = generate_id()
    segment = StreamSegmentResult(
        completion=None if failure else CompletionResult(content="answer", model="fixture"),
        error="provider detail" if failure else None,
        error_exception=ValueError("provider detail") if failure else None,
        placeholder_id=None if failure else placeholder,
    )
    async with run:
        await run.start(selected)
        events, _, _ = await _run_streaming_runner(monkeypatch, segment, invocation=run)
        recorder.finalize.assert_awaited_once()
        assert events[-1].type == (EventType.ERROR if failure else EventType.DONE)
    final = recorder.finalize.await_args.kwargs
    assert final["status"] == (
        SkillInvocationStatus.FAILED if failure else SkillInvocationStatus.COMPLETED
    )
    assert final["response_message_id"] == (None if failure else placeholder)
    assert final["run_log_id"] is None
    assert final["error_code"] == (SkillInvocationErrorCode.PROVIDER_FAILURE if failure else None)


@pytest.mark.parametrize("failure", [False, True])
async def test_unary_invocation_keeps_run_and_exact_response(monkeypatch, invocation, failure):
    run, recorder = invocation
    log_id = generate_id()
    logs = SimpleNamespace(record=AsyncMock(return_value=log_id))

    class Provider:
        name = "fixture"

        async def chat_completion(self, **kwargs):
            if failure:
                raise ValueError("provider detail")
            return CompletionResult(content="answer", model="fixture")

    try:
        async with run:
            await run.start(target())
            (message, _), _ = await _run_completion_runner(monkeypatch, Provider(), logs, run)
            assert run.response_message_id == message.id
    except ValueError:
        assert failure
    final = recorder.finalize.await_args.kwargs
    assert final["run_log_id"] == log_id
    assert final["status"] == (
        SkillInvocationStatus.FAILED if failure else SkillInvocationStatus.COMPLETED
    )


@pytest.mark.parametrize("ending", ["cancel", "deadline", "close", "prepare_failure", "incomplete"])
async def test_invocation_interruption_finalizes_without_response(invocation, ending):
    run, recorder = invocation
    if ending == "deadline":
        run.deadline_at = time.monotonic() - 1

    async def stream():
        async with run:
            await run.start(target())
            run.tool_calls.extend([{"success": False}, {"success": None}])
            yield "started"
            if ending in ("cancel", "deadline"):
                raise asyncio.CancelledError
            if ending == "prepare_failure":
                raise ValueError("private detail")

    try:
        async with aclosing(stream()) as events:
            assert await anext(events) == "started"
            if ending != "close":
                await anext(events)
    except asyncio.CancelledError, ValueError, StopAsyncIteration:
        pass
    final = recorder.finalize.await_args.kwargs
    assert final["response_message_id"] is None
    assert final["tool_calls"] == [{"success": False}, {"success": None}]
    expected = {
        "cancel": SkillInvocationErrorCode.CANCELLED,
        "close": SkillInvocationErrorCode.CANCELLED,
        "deadline": SkillInvocationErrorCode.DEADLINE_EXCEEDED,
        "prepare_failure": SkillInvocationErrorCode.RUN_FAILURE,
        "incomplete": SkillInvocationErrorCode.INCOMPLETE,
    }
    assert final["error_code"] == expected[ending]


async def test_ordinary_turn_opens_no_invocation_transaction(invocation):
    run, recorder = invocation
    async with run:
        await run.complete(generate_id(), generate_id())
    recorder.start.assert_not_awaited()
    recorder.finalize.assert_not_awaited()


async def test_completed_replay_never_runs_or_overwrites(invocation):
    run, recorder = invocation
    recorder.start.return_value.status = SkillInvocationStatus.COMPLETED
    with pytest.raises(ValidationError):
        async with run:
            await run.start(target())
    recorder.finalize.assert_not_awaited()


async def test_finalization_retry_preserves_completed_outcome(invocation):
    run, recorder = invocation
    recorder.finalize.side_effect = [False, True]
    response_id = generate_id()
    async with run:
        await run.start(target())
        await run.complete(response_id, None)
    assert recorder.finalize.await_count == 2
    for call in recorder.finalize.await_args_list:
        assert call.kwargs["status"] == SkillInvocationStatus.COMPLETED
        assert call.kwargs["error_code"] is None
        assert call.kwargs["response_message_id"] == response_id


@pytest.mark.parametrize("failure", [True, False])
async def test_stream_interruption_keeps_reserved_response(monkeypatch, invocation, failure):
    run, recorder = invocation
    response = SimpleNamespace(id=generate_id())
    terminal = (
        StreamSegmentResult(
            completion=None,
            error="provider failed",
            error_exception=None,
            placeholder_id=response.id,
        )
        if failure
        else asyncio.CancelledError()
    )
    try:
        async with run:
            await run.start(
                target(surface=SkillSurface.CHAT, session_id=None, channel_id=generate_id())
            )
            await _run_streaming_runner(
                monkeypatch,
                [
                    StreamEvent(type=EventType.MESSAGE_STORED, message=response),
                    terminal,
                ],
                invocation=run,
            )
    except asyncio.CancelledError:
        assert not failure
    assert recorder.finalize.await_args.kwargs["response_message_id"] == response.id
    assert recorder.finalize.await_args.kwargs["status"] == (
        SkillInvocationStatus.FAILED if failure else SkillInvocationStatus.CANCELLED
    )


async def test_tool_call_prefix_is_not_attributed_as_final_response(invocation):
    run, _ = invocation
    run.observe_stream(
        StreamEvent(type=EventType.MESSAGE_STORED, message=SimpleNamespace(id=generate_id()))
    )
    assert run.response_message_id is not None
    run.observe_stream(StreamEvent(type=EventType.TOOL_CALL_START))
    assert run.response_message_id is None
