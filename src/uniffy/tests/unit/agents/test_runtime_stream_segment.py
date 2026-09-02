"""Tests for provider stream-event enrichment and failover boundaries."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    StreamEvent,
)
from uniffy.domains.agents.runtime.models.calls import (
    ModelCallController,
    ModelCallTarget,
)
from uniffy.domains.agents.runtime.runs.segments import (
    StreamSegmentResult,
    controlled_stream_segment,
    stream_segment,
)
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator
from uniffy.domains.agents.runtime.settings.operations import ResolvedRuntimeSettings


def _placeholder() -> AgentMessage:
    return AgentMessage(
        id=generate_id(),
        session_id=generate_id(),
        role="assistant",
        content="",
        created_at=datetime.now(UTC),
    )


class _ChatWriter:
    def __init__(self) -> None:
        self.placeholder = _placeholder()
        self.reserve_calls = 0

    async def reserve_assistant_placeholder(self) -> AgentMessage:
        self.reserve_calls += 1
        return self.placeholder


class _SessionWriter:
    async def reserve_assistant_placeholder(self) -> None:
        return None


async def _segment(events: list[StreamEvent], writer) -> list:
    async def _gen():
        for event in events:
            yield event

    async def _run() -> list:
        return [event async for event in stream_segment(_gen(), writer)]

    return await _run()


def _provider_events() -> list[StreamEvent]:
    result = CompletionResult(content="Hello", model="m", input_tokens=3)
    return [
        StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
        StreamEvent(type=EventType.THINKING_BLOCK_START, block_id="t1"),
        StreamEvent(type=EventType.THINKING_BLOCK_DELTA, block_id="t1", delta="hmm"),
        StreamEvent(type=EventType.THINKING_BLOCK_END, block_id="t1"),
        StreamEvent(type=EventType.TEXT_BLOCK_START, block_id="x1"),
        StreamEvent(type=EventType.TEXT_BLOCK_DELTA, block_id="x1", delta="Hello"),
        StreamEvent(type=EventType.TEXT_BLOCK_END, block_id="x1"),
        StreamEvent(type=EventType.MODEL_CALL_END, model="m", input_tokens=3, result=result),
    ]


class TestStreamSegment:
    async def test_thinking_delta_reserves_placeholder(self) -> None:
        writer = _ChatWriter()
        out = await _segment(_provider_events(), writer)
        assert writer.reserve_calls == 1
        stored = [e for e in out[:-1] if e.type is EventType.MESSAGE_STORED]
        assert len(stored) == 1
        # Reservation happens on the thinking delta, before any text.
        types_before_stored = [e.type for e in out[: out.index(stored[0])]]
        assert EventType.TEXT_BLOCK_DELTA not in types_before_stored

    async def test_block_events_stamped_with_message_id_and_sequence(self) -> None:
        writer = _ChatWriter()
        out = await _segment(_provider_events(), writer)
        stamped = [
            e
            for e in out[:-1]
            if e.type
            not in (
                EventType.MESSAGE_STORED,
                EventType.MODEL_CALL_START,
                EventType.MODEL_CALL_END,
            )
            and e.message_id is not None
        ]
        sequences = [e.sequence for e in stamped]
        assert sequences == sorted(sequences)
        assert all(e.message_id == writer.placeholder.id for e in stamped)
        # THINKING_BLOCK_START arrives before reservation and stays unstamped.
        start = next(e for e in out if e.type is EventType.THINKING_BLOCK_START)
        assert start.message_id is None

    async def test_elapsed_ms_stamped_on_thinking_end(self) -> None:
        out = await _segment(_provider_events(), _ChatWriter())
        end = next(e for e in out if e.type is EventType.THINKING_BLOCK_END)
        assert end.elapsed_ms >= 0

    async def test_model_call_end_forwarded_without_result(self) -> None:
        out = await _segment(_provider_events(), _ChatWriter())
        forwarded = next(e for e in out if e.type is EventType.MODEL_CALL_END)
        assert forwarded.result is None
        assert forwarded.input_tokens == 3
        sentinel = out[-1]
        assert isinstance(sentinel, StreamSegmentResult)
        assert sentinel.completion is not None
        assert sentinel.completion.content == "Hello"

    async def test_session_writer_leaves_events_unstamped(self) -> None:
        out = await _segment(_provider_events(), _SessionWriter())
        assert not any(e.type is EventType.MESSAGE_STORED for e in out[:-1])
        deltas = [
            e
            for e in out[:-1]
            if e.type in (EventType.TEXT_BLOCK_DELTA, EventType.THINKING_BLOCK_DELTA)
        ]
        assert all(e.message_id is None and e.sequence == 0 for e in deltas)

    async def test_provider_error_captured_not_forwarded(self) -> None:
        events = [
            StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
            StreamEvent(type=EventType.ERROR, error="boom"),
        ]
        out = await _segment(events, _ChatWriter())
        assert not any(isinstance(e, StreamEvent) and e.type is EventType.ERROR for e in out[:-1])
        sentinel = out[-1]
        assert sentinel.error == "boom"
        assert sentinel.completion is None

    async def test_thinking_never_patches_placeholder_content(self) -> None:
        writer = _ChatWriter()
        await _segment(_provider_events(), writer)
        assert writer.placeholder.content == ""

    async def test_sentinel_carries_folded_thinking(self) -> None:
        out = await _segment(_provider_events(), _ChatWriter())
        sentinel = out[-1]
        assert len(sentinel.thinking) == 1
        block = sentinel.thinking[0]
        assert block["block_id"] == "t1"
        assert block["content"] == "hmm"
        assert block["elapsed_ms"] >= 0

    async def test_empty_thinking_blocks_not_folded(self) -> None:
        events = [
            StreamEvent(type=EventType.THINKING_BLOCK_START, block_id="t1"),
            StreamEvent(type=EventType.THINKING_BLOCK_END, block_id="t1"),
            StreamEvent(
                type=EventType.MODEL_CALL_END,
                model="m",
                result=CompletionResult(content="x", model="m"),
            ),
        ]
        out = await _segment(events, _SessionWriter())
        assert out[-1].thinking == []


class _StreamProvider:
    def __init__(self, events: list[StreamEvent]) -> None:
        self.name = "openai"
        self._events = events

    async def chat_completion(self, **_kwargs):
        async def stream():
            for event in self._events:
                yield event

        return stream()


class _Unavailable(Exception):
    status_code = 503


def _runtime_settings() -> ResolvedRuntimeSettings:
    return ResolvedRuntimeSettings(
        send_deadline_seconds=30,
        failover_enabled=True,
        resume_enabled=True,
        circuit_breaker_failure_threshold=5,
        circuit_breaker_recovery_seconds=60,
        display_currency="USD",
        personal_memory_bridge_enabled=True,
        default_provider_key_id=None,
        default_chat_model=None,
        image_max_resolution=None,
        image_max_quality=None,
    )


async def test_controlled_segment_fails_over_before_output() -> None:
    primary_key_id = generate_id()
    fallback_key_id = generate_id()
    failure = _Unavailable("unavailable")
    primary = _StreamProvider([
        StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
        StreamEvent(type=EventType.ERROR, error="unavailable", error_exception=failure),
    ])
    completion = CompletionResult(content="ok", model="m", input_tokens=4)
    fallback = _StreamProvider([
        StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
        StreamEvent(type=EventType.MODEL_CALL_END, model="m", result=completion),
    ])
    primary_key = MagicMock(id=primary_key_id, provider="openai")
    fallback_key = MagicMock(id=fallback_key_id, provider="openai")
    provider_ops = MagicMock()
    provider_ops.list_enabled_keys_for_provider = AsyncMock(return_value=[primary_key, fallback_key])
    provider_ops.get_provider_for_key = AsyncMock(return_value=(fallback, fallback_key))
    usage = RunUsageAccumulator()
    controller = ModelCallController(
        provider_ops=provider_ops,
        organization_id=generate_id(),
        target=ModelCallTarget(primary, primary_key_id, "m"),
        fallback_models=[],
        settings=_runtime_settings(),
        usage=usage,
        params_for_target=lambda _provider, _model: None,
    )
    events = [
        event
        async for event in controlled_stream_segment(
            controller=controller,
            writer=_SessionWriter(),
            messages=[],
            system=None,
            tools=None,
            cache_key="agent",
            safety_identifier="digest",
        )
    ]

    assert [event.type for event in events[:-1]] == [
        EventType.MODEL_CALL_START,
        EventType.FAILOVER,
        EventType.MODEL_CALL_START,
        EventType.MODEL_CALL_END,
    ]
    assert events[1].to_provider_key_id == str(fallback_key_id)
    assert [call.status for call in usage.calls] == ["error", "success"]


async def test_controlled_segment_does_not_fail_over_after_output() -> None:
    failure = _Unavailable("unavailable")
    primary = _StreamProvider([
        StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
        StreamEvent(type=EventType.TEXT_BLOCK_START, block_id="text-1"),
        StreamEvent(type=EventType.ERROR, error="unavailable", error_exception=failure),
    ])
    provider_ops = MagicMock()
    usage = RunUsageAccumulator()
    controller = ModelCallController(
        provider_ops=provider_ops,
        organization_id=generate_id(),
        target=ModelCallTarget(primary, generate_id(), "m"),
        fallback_models=[],
        settings=_runtime_settings(),
        usage=usage,
        params_for_target=lambda _provider, _model: None,
    )

    events = [
        event
        async for event in controlled_stream_segment(
            controller=controller,
            writer=_SessionWriter(),
            messages=[],
            system=None,
            tools=None,
            cache_key="agent",
            safety_identifier="digest",
        )
    ]

    assert [event.type for event in events[:-1]] == [
        EventType.MODEL_CALL_START,
        EventType.TEXT_BLOCK_START,
    ]
    assert isinstance(events[-1], StreamSegmentResult)
    assert events[-1].error == "unavailable"
    assert not any(event.type is EventType.FAILOVER for event in events[:-1])
    provider_ops.get_provider_for_key.assert_not_called()
    assert [call.status for call in usage.calls] == ["error"]
