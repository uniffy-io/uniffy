"""Proto converters for runtime responses."""

import json

from uniffy.core.models.agents.message import AgentMessage
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeConfirmationRequiredEvent,
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeMessageStoredEvent,
    RuntimeStreamEvent,
    RuntimeTokenEvent,
    RuntimeToolCallEvent,
    RuntimeToolResultEvent,
)
from uniffy.domains.agents.sessions.converters import message_to_proto
from uniffy.gen.agents.v1.runtime_pb2 import (
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
    StreamMessageStoredEvent,
    StreamSendMessageEvent,
    StreamTokenEvent,
    StreamToolCallEvent,
    StreamToolResultEvent,
    ToolUsage,
)


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
) -> StreamSendMessageEvent:
    """Convert a domain runtime stream event to proto.

    Parameters
    ----------
    event : RuntimeStreamEvent
        Domain stream event.

    Returns
    -------
    StreamSendMessageEvent
        Proto stream event wrapper.

    Raises
    ------
    ValueError
        If the event type is unknown.

    """
    if isinstance(event, RuntimeTokenEvent):
        return StreamSendMessageEvent(
            token=StreamTokenEvent(text=event.text),
        )

    if isinstance(event, RuntimeToolCallEvent):
        return StreamSendMessageEvent(
            tool_call=StreamToolCallEvent(
                tool_call_id=event.tool_call_id,
                tool_name=event.tool_name,
                tool_args_json=json.dumps(event.tool_args) if event.tool_args else "{}",
            ),
        )

    if isinstance(event, RuntimeToolResultEvent):
        return StreamSendMessageEvent(
            tool_result=StreamToolResultEvent(
                tool_call_id=event.tool_call_id,
                tool_name=event.tool_name,
                success=event.success,
                result=event.result,
            ),
        )

    if isinstance(event, RuntimeMessageStoredEvent):
        return StreamSendMessageEvent(
            message_stored=StreamMessageStoredEvent(
                message=message_to_proto(event.message),
            ),
        )

    if isinstance(event, RuntimeDoneEvent):
        return StreamSendMessageEvent(
            done=StreamDoneEvent(
                assistant_message=message_to_proto(event.assistant_message),
                model_used=event.model_used,
            ),
        )

    if isinstance(event, RuntimeConfirmationRequiredEvent):
        return StreamSendMessageEvent(
            confirmation_required=StreamConfirmationRequiredEvent(
                tool_call_id=event.tool_call_id,
                tool_name=event.tool_name,
                tool_args_json=json.dumps(event.tool_args) if event.tool_args else "{}",
                description=event.description,
            ),
        )

    if isinstance(event, RuntimeErrorEvent):
        return StreamSendMessageEvent(
            error=StreamErrorEvent(message=event.error),
        )

    raise ValueError(f"Unknown runtime stream event type: {type(event)}")


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
        total_sessions=totals["total_sessions"],
        avg_duration_ms=totals["avg_duration_ms"],
        daily_usage=[
            DailyUsage(
                date=d["date"],
                runs=d["runs"],
                input_tokens=d["input_tokens"],
                output_tokens=d["output_tokens"],
            )
            for d in stats["daily_usage"]
        ],
        model_usage=[
            ModelUsage(
                model=m["model"],
                runs=m["runs"],
                input_tokens=m["input_tokens"],
                output_tokens=m["output_tokens"],
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
