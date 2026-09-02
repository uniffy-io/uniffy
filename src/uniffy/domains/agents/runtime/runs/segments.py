"""Provider stream control and runtime event enrichment."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field, replace
from uuid import UUID

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    StreamEvent,
)
from uniffy.domains.agents.runtime.models.calls import (
    CircuitOpenError,
    FailoverTransition,
    ModelCallController,
)
from uniffy.domains.agents.runtime.writers import MessageWriter

BLOCK_EVENT_TYPES = frozenset({
    EventType.TEXT_BLOCK_START,
    EventType.TEXT_BLOCK_DELTA,
    EventType.TEXT_BLOCK_END,
    EventType.THINKING_BLOCK_START,
    EventType.THINKING_BLOCK_DELTA,
    EventType.THINKING_BLOCK_END,
    EventType.TOOL_CALL_START,
    EventType.TOOL_CALL_DELTA,
    EventType.TOOL_CALL_END,
})


@dataclass(slots=True)
class StreamSegmentResult:
    completion: CompletionResult | None
    error: str | None
    error_exception: BaseException | None
    placeholder_id: UUID | None
    started_output: bool = False
    thinking: list[dict] = field(default_factory=list)


def _failover_event(transition: FailoverTransition) -> StreamEvent:
    return StreamEvent(
        type=EventType.FAILOVER,
        from_provider_key_id=(
            str(transition.from_provider_key_id) if transition.from_provider_key_id else ""
        ),
        to_provider_key_id=(
            str(transition.to_provider_key_id) if transition.to_provider_key_id else ""
        ),
        to_model=transition.to_model,
        reason=transition.reason,
        attempt=transition.attempt,
    )


async def controlled_stream_segment(
    *,
    controller: ModelCallController,
    writer: MessageWriter,
    messages: list[dict],
    system: str | None,
    tools: list[dict] | None,
    cache_key: str,
    safety_identifier: str | None,
) -> AsyncIterator[StreamEvent | StreamSegmentResult]:
    while True:
        try:
            stream_iterator, transitions = await controller.open_stream(
                messages=messages,
                system=system,
                tools=tools,
                cache_key=cache_key,
                safety_identifier=safety_identifier,
            )
        except Exception as exc:
            transition = (
                None
                if isinstance(exc, CircuitOpenError)
                else await controller.record_failure_and_failover(exc)
            )
            if transition is not None:
                yield _failover_event(transition)
                continue
            yield StreamSegmentResult(
                completion=None,
                error=str(exc),
                error_exception=exc,
                placeholder_id=None,
            )
            return

        for transition in transitions:
            yield _failover_event(transition)

        result: StreamSegmentResult | None = None
        started_output = False
        try:
            async with asyncio.timeout(controller.remaining_seconds()):
                async for event in stream_segment(stream_iterator, writer):
                    if isinstance(event, StreamSegmentResult):
                        result = event
                    else:
                        if event.type in BLOCK_EVENT_TYPES:
                            started_output = True
                        yield event
        except Exception as exc:
            result = StreamSegmentResult(
                completion=None,
                error=str(exc),
                error_exception=exc,
                placeholder_id=None,
                started_output=started_output,
            )

        if result is None:
            result = StreamSegmentResult(
                completion=None,
                error="stream ended without a terminal result",
                error_exception=None,
                placeholder_id=None,
                started_output=started_output,
            )
        if result.completion is not None:
            controller.record_result(result.completion)
            yield result
            return

        failure = result.error_exception or RuntimeError(result.error or "provider stream failed")
        transition = await controller.record_failure_and_failover(
            failure,
            allow_failover=not (started_output or result.started_output),
        )
        if transition is None:
            yield result
            return
        yield _failover_event(transition)


async def stream_segment(
    stream_iterator: AsyncIterator[StreamEvent],
    writer: MessageWriter,
) -> AsyncIterator[StreamEvent | StreamSegmentResult]:
    completion: CompletionResult | None = None
    error: str | None = None
    error_exception: BaseException | None = None
    placeholder_id: UUID | None = None
    started_output = False
    sequence = 0
    thinking_started: dict[str, float] = {}
    thinking_folded: dict[str, dict] = {}

    async for event in stream_iterator:
        if event.type in BLOCK_EVENT_TYPES:
            started_output = True
        if event.type is EventType.THINKING_BLOCK_DELTA and event.block_id in thinking_folded:
            thinking_folded[event.block_id]["content"] += event.delta
        match event.type:
            case EventType.MODEL_CALL_END:
                completion = event.result
                yield replace(event, result=None)
                continue
            case EventType.ERROR:
                if error is None:
                    error = event.error
                    error_exception = event.error_exception
                continue
            case EventType.THINKING_BLOCK_START:
                thinking_started[event.block_id] = time.monotonic()
                thinking_folded[event.block_id] = {
                    "block_id": event.block_id,
                    "content": "",
                    "elapsed_ms": 0,
                }
            case EventType.TEXT_BLOCK_DELTA | EventType.THINKING_BLOCK_DELTA if (
                event.delta and placeholder_id is None
            ):
                placeholder = await writer.reserve_assistant_placeholder()
                if placeholder is not None:
                    placeholder_id = placeholder.id
                    yield StreamEvent(type=EventType.MESSAGE_STORED, message=placeholder)

        enriched = event
        if event.type in BLOCK_EVENT_TYPES:
            if placeholder_id is not None:
                sequence += 1
                enriched = replace(event, message_id=placeholder_id, sequence=sequence)
            if enriched.type is EventType.THINKING_BLOCK_END:
                started = thinking_started.pop(enriched.block_id, None)
                if started is not None:
                    enriched = replace(
                        enriched,
                        elapsed_ms=int((time.monotonic() - started) * 1000),
                    )
                if enriched.block_id in thinking_folded:
                    thinking_folded[enriched.block_id]["elapsed_ms"] = enriched.elapsed_ms
        yield enriched

    yield StreamSegmentResult(
        completion=completion,
        error=error,
        error_exception=error_exception,
        placeholder_id=placeholder_id,
        started_output=started_output,
        thinking=[block for block in thinking_folded.values() if block["content"]],
    )
