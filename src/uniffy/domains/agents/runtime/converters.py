"""Proto converters for runtime responses."""

from dataclasses import fields
from typing import Any
from uuid import UUID

from uniffy_proto.agents.v1.runtime_pb2 import (
    AgentStreamEvent,
    AgentUsageInfo,
    CronTaskUsage,
    DailyUsage,
    GetUsageStatsResponse,
    ModelUsage,
    ProviderKeyUsage,
    SendMessageResponse,
    StreamConfirmationRequiredEvent,
    StreamDoneEvent,
    StreamErrorEvent,
    StreamExceedMaxItersEvent,
    StreamFailoverEvent,
    StreamMessageStoredEvent,
    StreamModelCallEndEvent,
    StreamModelCallStartEvent,
    StreamReplyStartEvent,
    StreamTextBlockDeltaEvent,
    StreamTextBlockEndEvent,
    StreamTextBlockStartEvent,
    StreamThinkingBlockDeltaEvent,
    StreamThinkingBlockEndEvent,
    StreamThinkingBlockStartEvent,
    StreamToolCallDeltaEvent,
    StreamToolCallEndEvent,
    StreamToolCallStartEvent,
    StreamToolResultDeltaEvent,
    StreamToolResultEndEvent,
    StreamToolResultStartEvent,
    ToolUsage,
)

from uniffy.core.json_codec import dumps_str
from uniffy.core.models.agents.message import AgentMessage
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.sessions.converters import message_to_proto


def send_message_response_to_proto(
    *,
    user_message: AgentMessage,
    assistant_message: AgentMessage,
    model_used: str,
    skill_invocation: dict[str, str] | None = None,
) -> SendMessageResponse:
    """Convert runtime result to proto SendMessageResponse.

    Parameters
    ----------
    user_message : AgentMessage
        The stored user message.
    assistant_message : AgentMessage
        The stored assistant response.
    model_used : str
        The model that generated the response.

    Returns
    -------
    SendMessageResponse
        Proto message.

    """
    return SendMessageResponse(
        user_message=message_to_proto(user_message),
        assistant_message=message_to_proto(assistant_message, skill_invocation=skill_invocation),
        model_used=model_used,
    )


def _message_id_str(event: StreamEvent) -> str:
    return str(event.message_id) if event.message_id else ""


def _args_json(args: dict | None) -> str:
    return dumps_str(args) if args else "{}"


def runtime_stream_event_to_proto(event: StreamEvent) -> AgentStreamEvent:
    """Convert a runtime stream event to proto.

    The handler wraps the result in the per-RPC response and stamps
    ``run_id`` from the egress run state hash. ``CompletionResult`` is
    runtime-internal and never crosses this boundary. Raises
    ``ValueError`` for events that must not reach the wire.
    """
    match event.type:
        case EventType.REPLY_START:
            return AgentStreamEvent(reply_start=StreamReplyStartEvent(role="assistant"))
        case EventType.MODEL_CALL_START:
            return AgentStreamEvent(model_call_start=StreamModelCallStartEvent(model=event.model))
        case EventType.MODEL_CALL_END:
            return AgentStreamEvent(
                model_call_end=StreamModelCallEndEvent(
                    model=event.model,
                    input_tokens=event.input_tokens,
                    output_tokens=event.output_tokens,
                    cache_creation_input_tokens=(event.cache_creation_input_tokens),
                    cache_read_input_tokens=event.cache_read_input_tokens,
                    thinking_tokens=event.thinking_tokens,
                )
            )
        case EventType.TEXT_BLOCK_START:
            return AgentStreamEvent(
                text_block_start=StreamTextBlockStartEvent(
                    block_id=event.block_id,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.TEXT_BLOCK_DELTA:
            return AgentStreamEvent(
                text_block_delta=StreamTextBlockDeltaEvent(
                    block_id=event.block_id,
                    delta=event.delta,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.TEXT_BLOCK_END:
            return AgentStreamEvent(
                text_block_end=StreamTextBlockEndEvent(
                    block_id=event.block_id,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.THINKING_BLOCK_START:
            return AgentStreamEvent(
                thinking_block_start=StreamThinkingBlockStartEvent(
                    block_id=event.block_id,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.THINKING_BLOCK_DELTA:
            return AgentStreamEvent(
                thinking_block_delta=StreamThinkingBlockDeltaEvent(
                    block_id=event.block_id,
                    delta=event.delta,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.THINKING_BLOCK_END:
            return AgentStreamEvent(
                thinking_block_end=StreamThinkingBlockEndEvent(
                    block_id=event.block_id,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                    elapsed_ms=event.elapsed_ms,
                )
            )
        case EventType.TOOL_CALL_START:
            return AgentStreamEvent(
                tool_call_start=StreamToolCallStartEvent(
                    block_id=event.block_id,
                    tool_call_id=event.tool_call_id,
                    tool_name=event.tool_name,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.TOOL_CALL_DELTA:
            return AgentStreamEvent(
                tool_call_delta=StreamToolCallDeltaEvent(
                    block_id=event.block_id,
                    tool_call_id=event.tool_call_id,
                    tool_name=event.tool_name,
                    delta=event.delta,
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.TOOL_CALL_END:
            return AgentStreamEvent(
                tool_call_end=StreamToolCallEndEvent(
                    block_id=event.block_id,
                    tool_call_id=event.tool_call_id,
                    tool_name=event.tool_name,
                    tool_args_json=_args_json(event.tool_args),
                    message_id=_message_id_str(event),
                    sequence=event.sequence,
                )
            )
        case EventType.TOOL_RESULT_START:
            return AgentStreamEvent(
                tool_result_start=StreamToolResultStartEvent(
                    tool_call_id=event.tool_call_id,
                    tool_name=event.tool_name,
                    tool_args_json=_args_json(event.tool_args),
                    message_id=_message_id_str(event),
                )
            )
        case EventType.TOOL_RESULT_DELTA:
            return AgentStreamEvent(
                tool_result_delta=StreamToolResultDeltaEvent(
                    tool_call_id=event.tool_call_id,
                    delta=event.delta,
                    message_id=_message_id_str(event),
                )
            )
        case EventType.TOOL_RESULT_END:
            return AgentStreamEvent(
                tool_result_end=StreamToolResultEndEvent(
                    tool_call_id=event.tool_call_id,
                    tool_name=event.tool_name,
                    success=event.success,
                    result=event.tool_result,
                    message_id=_message_id_str(event),
                )
            )
        case EventType.CONFIRMATION_REQUIRED:
            return AgentStreamEvent(
                confirmation_required=StreamConfirmationRequiredEvent(
                    tool_call_id=event.tool_call_id,
                    tool_name=event.tool_name,
                    tool_args_json=_args_json(event.tool_args),
                    description=event.description,
                )
            )
        case EventType.FAILOVER:
            return AgentStreamEvent(
                failover=StreamFailoverEvent(
                    from_provider_key_id=event.from_provider_key_id,
                    to_provider_key_id=event.to_provider_key_id,
                    to_model=event.to_model,
                    reason=event.reason,
                    attempt=event.attempt,
                )
            )
        case EventType.EXCEED_MAX_ITERS:
            return AgentStreamEvent(exceed_max_iters=StreamExceedMaxItersEvent())
        case EventType.MESSAGE_STORED:
            return AgentStreamEvent(
                message_stored=StreamMessageStoredEvent(message=message_to_proto(event.message))
            )
        case EventType.DONE:
            return AgentStreamEvent(
                done=StreamDoneEvent(
                    assistant_message=message_to_proto(
                        event.assistant_message, skill_invocation=event.skill_invocation
                    ),
                    model_used=event.model,
                )
            )
        case EventType.ERROR:
            return AgentStreamEvent(error=StreamErrorEvent(message=event.error))
        case _:
            raise ValueError(f"Event type not wire-mapped: {event.type!r}")


_STREAM_EVENT_FIELDS = {f.name: f for f in fields(StreamEvent)}
_UUID_FIELDS = frozenset({"message_id", "request_id"})
_MESSAGE_FIELDS = frozenset({"message", "assistant_message"})
# `result` (CompletionResult) is runtime-internal and never serialized.
_SKIPPED_FIELDS = frozenset({"type", "result", "error_exception"})


def runtime_stream_event_to_json(event: StreamEvent) -> dict[str, Any]:
    """Serialise a stream event into a sparse JSON-safe envelope.

    ``type`` discriminates; fields still at their dataclass default are
    omitted. UUIDs and datetimes inside ``AgentMessage`` rows serialise
    through pydantic's ``mode="json"``.
    """
    payload: dict[str, Any] = {"type": event.type.value}
    for name, spec in _STREAM_EVENT_FIELDS.items():
        if name in _SKIPPED_FIELDS:
            continue
        value = getattr(event, name)
        if value == spec.default:
            continue
        if name in _UUID_FIELDS:
            value = str(value)
        elif name in _MESSAGE_FIELDS:
            value = value.model_dump(mode="json")
        payload[name] = value
    return payload


def runtime_stream_event_from_json(payload: dict[str, Any]) -> StreamEvent:
    """Reverse of :func:`runtime_stream_event_to_json`.

    Raises ``ValueError`` on unknown / malformed envelopes; callers
    should treat that as a fatal stream-protocol bug, not a transient
    glitch.
    """
    try:
        event_type = EventType(payload["type"])
    except (KeyError, ValueError) as exc:
        raise ValueError(f"Unknown runtime stream event type: {payload.get('type')!r}") from exc

    kwargs: dict[str, Any] = {}
    for name, value in payload.items():
        if name == "type":  # noqa: PLR2004
            continue
        if name not in _STREAM_EVENT_FIELDS or name in _SKIPPED_FIELDS:
            raise ValueError(f"Unknown stream event field: {name!r}")
        if value is None:
            continue
        if name in _UUID_FIELDS:
            kwargs[name] = UUID(value)
        elif name in _MESSAGE_FIELDS:
            kwargs[name] = AgentMessage.model_validate(value)
        else:
            kwargs[name] = value
    return StreamEvent(type=event_type, **kwargs)


def usage_stats_to_proto(stats: dict) -> GetUsageStatsResponse:
    """Convert usage statistics dict to proto response.

    Parameters
    ----------
    stats : dict
        Usage statistics from UsageOperations.get_usage_stats().

    Returns
    -------
    GetUsageStatsResponse
        Proto usage stats response.

    """
    totals = stats["totals"]
    return GetUsageStatsResponse(
        total_runs=totals["total_runs"],
        total_input_tokens=totals["total_input_tokens"],
        total_output_tokens=totals["total_output_tokens"],
        total_cache_read_input_tokens=totals["total_cache_read_input_tokens"],
        total_cache_creation_input_tokens=totals["total_cache_creation_input_tokens"],
        total_sessions=totals["total_sessions"],
        avg_duration_ms=totals["avg_duration_ms"],
        total_cost=totals.get("total_cost", "0"),
        total_thinking_tokens=totals.get("total_thinking_tokens", 0),
        total_image_count=totals.get("total_image_count", 0),
        total_retries=totals.get("total_retries", 0),
        total_cancelled=totals.get("total_cancelled", 0),
        total_deadline_exceeded=totals.get("total_deadline_exceeded", 0),
        display_currency=stats.get("display_currency", "USD"),
        daily_usage=[
            DailyUsage(
                date=d["date"],
                runs=d["runs"],
                input_tokens=d["input_tokens"],
                output_tokens=d["output_tokens"],
                cache_read_input_tokens=d["cache_read_input_tokens"],
                cache_creation_input_tokens=d["cache_creation_input_tokens"],
                cost=d.get("cost", "0"),
                image_count=d.get("image_count", 0),
            )
            for d in stats["daily_usage"]
        ],
        model_usage=[
            ModelUsage(
                model=m["model"],
                runs=m["runs"],
                input_tokens=m["input_tokens"],
                output_tokens=m["output_tokens"],
                cost=m.get("cost", "0"),
                image_count=m.get("image_count", 0),
                cache_read_input_tokens=m["cache_read_input_tokens"],
                cache_creation_input_tokens=m["cache_creation_input_tokens"],
            )
            for m in stats["model_usage"]
        ],
        agent_usage=[
            AgentUsageInfo(
                agent_id=a["agent_id"],
                agent_name=a["agent_name"],
                runs=a["runs"],
                input_tokens=a["input_tokens"],
                output_tokens=a["output_tokens"],
                cache_read_input_tokens=a["cache_read_input_tokens"],
                cache_creation_input_tokens=a["cache_creation_input_tokens"],
            )
            for a in stats["agent_usage"]
        ],
        tool_usage=[
            ToolUsage(
                tool_name=t["tool_name"],
                call_count=t["call_count"],
            )
            for t in stats["tool_usage"]
        ],
        provider_key_usage=[
            ProviderKeyUsage(
                provider_key_id=p["provider_key_id"],
                key_label=p["key_label"],
                provider=p["provider"],
                runs=p["runs"],
                input_tokens=p["input_tokens"],
                output_tokens=p["output_tokens"],
                cache_read_input_tokens=p["cache_read_input_tokens"],
                cache_creation_input_tokens=p["cache_creation_input_tokens"],
            )
            for p in stats["provider_key_usage"]
        ],
        cron_usage=[
            CronTaskUsage(
                cron_task_id=c["cron_task_id"],
                task_name=c["task_name"],
                agent_name=c["agent_name"],
                total_runs=c["total_runs"],
                successes=c["successes"],
                failures=c["failures"],
                input_tokens=c["input_tokens"],
                output_tokens=c["output_tokens"],
                cache_read_input_tokens=c["cache_read_input_tokens"],
                cache_creation_input_tokens=c["cache_creation_input_tokens"],
            )
            for c in stats["cron_usage"]["per_task"]
        ],
        cron_total_runs=stats["cron_usage"]["totals"]["total_runs"],
        cron_total_successes=stats["cron_usage"]["totals"]["successes"],
        cron_total_failures=stats["cron_usage"]["totals"]["failures"],
        cron_total_input_tokens=stats["cron_usage"]["totals"]["input_tokens"],
        cron_total_output_tokens=stats["cron_usage"]["totals"]["output_tokens"],
        cron_total_cache_read_input_tokens=stats["cron_usage"]["totals"]["cache_read_input_tokens"],
        cron_total_cache_creation_input_tokens=stats["cron_usage"]["totals"][
            "cache_creation_input_tokens"
        ],
    )
