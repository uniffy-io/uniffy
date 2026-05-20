"""Proto converters for runtime responses."""

import json
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
    StreamFailoverEvent,
    StreamMessageStoredEvent,
    StreamTokenEvent,
    StreamToolCallEvent,
    StreamToolResultEvent,
    ToolUsage,
)

from uniffy.core.models.agents.message import AgentMessage
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeConfirmationRequiredEvent,
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeFailoverEvent,
    RuntimeMessageStoredEvent,
    RuntimeStreamEvent,
    RuntimeTokenEvent,
    RuntimeToolCallEvent,
    RuntimeToolResultEvent,
)
from uniffy.domains.agents.sessions.converters import message_to_proto


def send_message_response_to_proto(
    *,
    user_message: AgentMessage,
    assistant_message: AgentMessage,
    model_used: str,
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
        assistant_message=message_to_proto(assistant_message),
        model_used=model_used,
    )


def runtime_stream_event_to_proto(
    event: RuntimeStreamEvent,
) -> AgentStreamEvent:
    """Convert a domain runtime stream event to proto.

    Parameters
    ----------
    event : RuntimeStreamEvent
        Domain stream event.

    Returns
    -------
    AgentStreamEvent
        Proto event payload. The handler wraps this in the per-RPC
        response (StreamSendMessageResponse / RerunFromMessageResponse /
        SubscribeToRunResponse) and stamps ``run_id`` from the egress
        run state hash.

    Raises
    ------
    ValueError
        If the event type is unknown.

    """
    if isinstance(event, RuntimeTokenEvent):
        return AgentStreamEvent(token=StreamTokenEvent(text=event.text))

    if isinstance(event, RuntimeToolCallEvent):
        return AgentStreamEvent(
            tool_call=StreamToolCallEvent(
                tool_call_id=event.tool_call_id,
                tool_name=event.tool_name,
                tool_args_json=json.dumps(event.tool_args) if event.tool_args else "{}",
            ),
        )

    if isinstance(event, RuntimeToolResultEvent):
        return AgentStreamEvent(
            tool_result=StreamToolResultEvent(
                tool_call_id=event.tool_call_id,
                tool_name=event.tool_name,
                success=event.success,
                result=event.result,
            ),
        )

    if isinstance(event, RuntimeMessageStoredEvent):
        return AgentStreamEvent(
            message_stored=StreamMessageStoredEvent(
                message=message_to_proto(event.message),
            ),
        )

    if isinstance(event, RuntimeDoneEvent):
        return AgentStreamEvent(
            done=StreamDoneEvent(
                assistant_message=message_to_proto(event.assistant_message),
                model_used=event.model_used,
            ),
        )

    if isinstance(event, RuntimeConfirmationRequiredEvent):
        return AgentStreamEvent(
            confirmation_required=StreamConfirmationRequiredEvent(
                tool_call_id=event.tool_call_id,
                tool_name=event.tool_name,
                tool_args_json=json.dumps(event.tool_args) if event.tool_args else "{}",
                description=event.description,
            ),
        )

    if isinstance(event, RuntimeFailoverEvent):
        return AgentStreamEvent(
            failover=StreamFailoverEvent(
                from_provider_key_id=event.from_provider_key_id,
                to_provider_key_id=event.to_provider_key_id,
                to_model=event.to_model,
                reason=event.reason,
                attempt=event.attempt,
            ),
        )

    if isinstance(event, RuntimeErrorEvent):
        return AgentStreamEvent(error=StreamErrorEvent(message=event.error))

    raise ValueError(f"Unknown runtime stream event type: {type(event)}")


_EVENT_TYPE_TOKEN = "token"
_EVENT_TYPE_TOOL_CALL = "tool_call"
_EVENT_TYPE_TOOL_RESULT = "tool_result"
_EVENT_TYPE_MESSAGE_STORED = "message_stored"
_EVENT_TYPE_DONE = "done"
_EVENT_TYPE_CONFIRMATION_REQUIRED = "confirmation_required"
_EVENT_TYPE_FAILOVER = "failover"
_EVENT_TYPE_ERROR = "error"


def _message_to_jsonable(message: AgentMessage) -> dict[str, Any]:
    """Serialise an ``AgentMessage`` row into a JSON-safe dict."""
    return message.model_dump(mode="json")


def _message_from_jsonable(data: dict[str, Any]) -> AgentMessage:
    """Reconstruct an ``AgentMessage`` from its JSON-safe dict."""
    return AgentMessage.model_validate(data)


def runtime_stream_event_to_json(event: RuntimeStreamEvent) -> dict[str, Any]:
    """Serialise a runtime stream event into a JSON-safe envelope.

    The ``type`` field discriminates variants so the round-trip is
    self-describing without consulting Python class names. UUIDs and
    datetimes inside ``AgentMessage`` are serialised through pydantic's
    ``mode="json"``.
    """
    if isinstance(event, RuntimeTokenEvent):
        return {
            "type": _EVENT_TYPE_TOKEN,
            "text": event.text,
            "message_id": str(event.message_id) if event.message_id else None,
            "sequence": event.sequence,
        }

    if isinstance(event, RuntimeToolCallEvent):
        return {
            "type": _EVENT_TYPE_TOOL_CALL,
            "tool_call_id": event.tool_call_id,
            "tool_name": event.tool_name,
            "tool_args": event.tool_args,
            "message_id": str(event.message_id) if event.message_id else None,
        }

    if isinstance(event, RuntimeToolResultEvent):
        return {
            "type": _EVENT_TYPE_TOOL_RESULT,
            "tool_call_id": event.tool_call_id,
            "tool_name": event.tool_name,
            "success": event.success,
            "result": event.result,
            "message_id": str(event.message_id) if event.message_id else None,
        }

    if isinstance(event, RuntimeMessageStoredEvent):
        return {
            "type": _EVENT_TYPE_MESSAGE_STORED,
            "message": _message_to_jsonable(event.message),
        }

    if isinstance(event, RuntimeDoneEvent):
        return {
            "type": _EVENT_TYPE_DONE,
            "assistant_message": _message_to_jsonable(event.assistant_message),
            "model_used": event.model_used,
        }

    if isinstance(event, RuntimeConfirmationRequiredEvent):
        return {
            "type": _EVENT_TYPE_CONFIRMATION_REQUIRED,
            "tool_call_id": event.tool_call_id,
            "tool_name": event.tool_name,
            "tool_args": event.tool_args,
            "description": event.description,
            "request_id": str(event.request_id) if event.request_id else None,
            "message_id": str(event.message_id) if event.message_id else None,
        }

    if isinstance(event, RuntimeFailoverEvent):
        return {
            "type": _EVENT_TYPE_FAILOVER,
            "from_provider_key_id": event.from_provider_key_id,
            "to_provider_key_id": event.to_provider_key_id,
            "to_model": event.to_model,
            "reason": event.reason,
            "attempt": event.attempt,
        }

    if isinstance(event, RuntimeErrorEvent):
        return {"type": _EVENT_TYPE_ERROR, "error": event.error}

    raise ValueError(f"Unknown runtime stream event type: {type(event)}")


def runtime_stream_event_from_json(payload: dict[str, Any]) -> RuntimeStreamEvent:
    """Reverse of :func:`runtime_stream_event_to_json`.

    Raises ``ValueError`` on unknown / malformed envelopes; callers
    should treat that as a fatal stream-protocol bug, not a transient
    glitch.
    """
    event_type = payload.get("type")

    if event_type == _EVENT_TYPE_TOKEN:
        message_id = payload.get("message_id")
        return RuntimeTokenEvent(
            text=payload["text"],
            message_id=UUID(message_id) if message_id else None,
            sequence=int(payload.get("sequence", 0)),
        )

    if event_type == _EVENT_TYPE_TOOL_CALL:
        message_id = payload.get("message_id")
        return RuntimeToolCallEvent(
            tool_call_id=payload["tool_call_id"],
            tool_name=payload["tool_name"],
            tool_args=payload.get("tool_args") or {},
            message_id=UUID(message_id) if message_id else None,
        )

    if event_type == _EVENT_TYPE_TOOL_RESULT:
        message_id = payload.get("message_id")
        return RuntimeToolResultEvent(
            tool_call_id=payload["tool_call_id"],
            tool_name=payload["tool_name"],
            success=bool(payload["success"]),
            result=payload.get("result", ""),
            message_id=UUID(message_id) if message_id else None,
        )

    if event_type == _EVENT_TYPE_MESSAGE_STORED:
        return RuntimeMessageStoredEvent(
            message=_message_from_jsonable(payload["message"]),
        )

    if event_type == _EVENT_TYPE_DONE:
        return RuntimeDoneEvent(
            assistant_message=_message_from_jsonable(payload["assistant_message"]),
            model_used=payload["model_used"],
        )

    if event_type == _EVENT_TYPE_CONFIRMATION_REQUIRED:
        request_id = payload.get("request_id")
        message_id = payload.get("message_id")
        return RuntimeConfirmationRequiredEvent(
            tool_call_id=payload["tool_call_id"],
            tool_name=payload["tool_name"],
            tool_args=payload.get("tool_args") or {},
            description=payload.get("description", ""),
            request_id=UUID(request_id) if request_id else None,
            message_id=UUID(message_id) if message_id else None,
        )

    if event_type == _EVENT_TYPE_FAILOVER:
        return RuntimeFailoverEvent(
            from_provider_key_id=payload.get("from_provider_key_id", ""),
            to_provider_key_id=payload.get("to_provider_key_id", ""),
            to_model=payload.get("to_model", ""),
            reason=payload.get("reason", "other"),
            attempt=int(payload.get("attempt", 1)),
        )

    if event_type == _EVENT_TYPE_ERROR:
        return RuntimeErrorEvent(error=payload.get("error", ""))

    raise ValueError(f"Unknown runtime stream event type: {event_type!r}")


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
        total_sessions=totals["total_sessions"],
        avg_duration_ms=totals["avg_duration_ms"],
        total_cost=totals.get("total_cost", "0"),
        total_thinking_tokens=totals.get("total_thinking_tokens", 0),
        total_image_count=totals.get("total_image_count", 0),
        total_retries=totals.get("total_retries", 0),
        total_cancelled=totals.get("total_cancelled", 0),
        total_deadline_exceeded=totals.get("total_deadline_exceeded", 0),
        display_currency=stats.get("display_currency", "EUR"),
        daily_usage=[
            DailyUsage(
                date=d["date"],
                runs=d["runs"],
                input_tokens=d["input_tokens"],
                output_tokens=d["output_tokens"],
                cache_read_input_tokens=d["cache_read_input_tokens"],
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
            )
            for c in stats["cron_usage"]["per_task"]
        ],
        cron_total_runs=stats["cron_usage"]["totals"]["total_runs"],
        cron_total_successes=stats["cron_usage"]["totals"]["successes"],
        cron_total_failures=stats["cron_usage"]["totals"]["failures"],
        cron_total_input_tokens=stats["cron_usage"]["totals"]["input_tokens"],
        cron_total_output_tokens=stats["cron_usage"]["totals"]["output_tokens"],
    )
