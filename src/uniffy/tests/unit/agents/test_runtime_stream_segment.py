"""Unit tests for the runtime stream-segment enrichment.

Pins the contract between provider block events and what the runtime
forwards: placeholder reservation on the first non-empty thinking OR
text delta, message_id + monotonic sequence stamping, elapsed_ms on
THINKING_BLOCK_END, CompletionResult stripping on MODEL_CALL_END, and
ERROR capture (not forwarded).
"""

from datetime import UTC, datetime

from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.types import generate_id
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    StreamEvent,
)
from uniffy.domains.agents.runtime.operations import (
    RuntimeOperations,
    _StreamSegmentResult,
)


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
        ops = object.__new__(RuntimeOperations)
        return [e async for e in ops._stream_segment(_gen(), writer)]

    return await _run()


def _provider_events() -> list[StreamEvent]:
    result = CompletionResult(content="Hello", model="m", input_tokens=3)
    return [
        StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
        StreamEvent(type=EventType.THINKING_BLOCK_START, block_id="t1"),
        StreamEvent(
            type=EventType.THINKING_BLOCK_DELTA, block_id="t1", delta="hmm"
        ),
        StreamEvent(type=EventType.THINKING_BLOCK_END, block_id="t1"),
        StreamEvent(type=EventType.TEXT_BLOCK_START, block_id="x1"),
        StreamEvent(type=EventType.TEXT_BLOCK_DELTA, block_id="x1", delta="Hello"),
        StreamEvent(type=EventType.TEXT_BLOCK_END, block_id="x1"),
        StreamEvent(
            type=EventType.MODEL_CALL_END, model="m", input_tokens=3, result=result
        ),
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
        assert isinstance(sentinel, _StreamSegmentResult)
        assert sentinel.completion is not None
        assert sentinel.completion.content == "Hello"

    async def test_session_writer_leaves_events_unstamped(self) -> None:
        out = await _segment(_provider_events(), _SessionWriter())
        assert not any(
            e.type is EventType.MESSAGE_STORED for e in out[:-1]
        )
        deltas = [
            e
            for e in out[:-1]
            if e.type
            in (EventType.TEXT_BLOCK_DELTA, EventType.THINKING_BLOCK_DELTA)
        ]
        assert all(e.message_id is None and e.sequence == 0 for e in deltas)

    async def test_provider_error_captured_not_forwarded(self) -> None:
        events = [
            StreamEvent(type=EventType.MODEL_CALL_START, model="m"),
            StreamEvent(type=EventType.ERROR, error="boom"),
        ]
        out = await _segment(events, _ChatWriter())
        assert not any(
            isinstance(e, StreamEvent) and e.type is EventType.ERROR
            for e in out[:-1]
        )
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
