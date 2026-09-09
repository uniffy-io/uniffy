"""Streaming tool-loop execution."""

from __future__ import annotations

from collections.abc import AsyncIterator
from uuid import UUID

from loguru import logger

from uniffy.core.database import SessionFactory
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    EventType,
    StreamEvent,
)
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.models.calls import ModelCallController
from uniffy.domains.agents.runtime.runs.segments import (
    StreamSegmentResult,
    controlled_stream_segment,
)
from uniffy.domains.agents.runtime.tooling import (
    MAX_LOAD_ONLY_ITERATIONS,
    MAX_TOOL_ITERATIONS,
    expand_loaded_schemas,
    gather_read_tool_results,
    is_load_only_turn,
    split_read_write,
)
from uniffy.domains.agents.runtime.writers import MessageWriter
from uniffy.domains.agents.tools.definitions import ToolResult
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import get_tool_registry

logger = logger.bind(component="agents.runtime.runs.tools")


class StreamingToolLoop:
    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory

    async def run(
        self,
        *,
        writer: MessageWriter,
        agent_id: UUID,
        system_prompt: str,
        tool_schemas: list[dict],
        llm_messages: list[dict],
        result: CompletionResult,
        executor: ToolExecutor,
        run_tool_calls: list[dict] | None,
        call_controller: ModelCallController,
        safety_identifier: str | None,
        pending_thinking: list[dict] | None,
        deferred_pool: dict[str, list[dict]] | None,
    ) -> AsyncIterator[StreamEvent]:
        work_iterations = 0
        load_iterations = 0
        while True:
            if is_load_only_turn(result.tool_calls):
                load_iterations += 1
            else:
                work_iterations += 1
            if work_iterations > MAX_TOOL_ITERATIONS or load_iterations > MAX_LOAD_ONLY_ITERATIONS:
                break
            logger.debug(
                "Stream tool loop iteration",
                iteration=work_iterations,
                tool_calls=len(result.tool_calls),
            )

            assistant_content: list[dict] = [*result.thinking_blocks]
            if result.content:
                assistant_content.append({"type": "text", "text": result.content})
            for tool_call in result.tool_calls:
                tool_use_block: dict = {
                    "type": "tool_use",
                    "id": tool_call.id,
                    "name": tool_call.name,
                    "input": tool_call.input,
                }
                if tool_call.metadata:
                    tool_use_block["metadata"] = tool_call.metadata
                assistant_content.append(tool_use_block)
            llm_messages.append({
                "role": "assistant",
                "content": assistant_content,
            })

            tool_call_message_ids: dict[str, UUID] = {}
            turn_traces: dict[str, dict] = {}
            for tool_call in result.tool_calls:
                stored = await writer.add_message(
                    role="assistant",
                    content=result.content,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    tool_args=tool_call.input,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_creation_input_tokens=result.cache_creation_input_tokens,
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    model=result.model,
                    thinking=pending_thinking,
                )
                pending_thinking = None
                tool_call_message_ids[tool_call.id] = stored.id
                trace = {"name": tool_call.name, "call_id": tool_call.id, "success": None}
                turn_traces[tool_call.id] = trace
                if run_tool_calls is not None:
                    run_tool_calls.append(trace)
                yield StreamEvent(
                    type=EventType.TOOL_RESULT_START,
                    tool_call_id=tool_call.id,
                    tool_name=tool_call.name,
                    tool_args=tool_call.input,
                    message_id=stored.id,
                )

            approval_store = get_approval_store()
            tool_registry = get_tool_registry()
            registry = executor.registry
            base_context = executor.context
            read_calls, write_calls = split_read_write(registry, result.tool_calls)
            read_results = await gather_read_tool_results(
                registry,
                base_context,
                read_calls,
                self._session_factory,
            )
            for call_id, tool_result in read_results.items():
                turn_traces[call_id]["success"] = tool_result.success

            results_content: dict[str, str] = {}
            turn_tool_results: dict[str, ToolResult] = dict(read_results)

            for tool_call in read_calls:
                tool_result = read_results[tool_call.id]
                content = tool_result.data if tool_result.success else f"Error: {tool_result.error}"
                stored_result = await writer.add_message(
                    role="tool",
                    content=content,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    tool_result=content,
                    tool_metadata=tool_result.metadata,
                )
                yield StreamEvent(
                    type=EventType.TOOL_RESULT_END,
                    tool_call_id=tool_call.id,
                    tool_name=tool_call.name,
                    success=tool_result.success,
                    tool_result=content,
                    message_id=stored_result.id,
                )
                results_content[tool_call.id] = content

            for tool_call in write_calls:
                if tool_registry.is_destructive(tool_call.name):
                    await approval_store.register(
                        writer.approval_scope_id,
                        tool_call.id,
                        tool_name=tool_call.name,
                        tool_args=tool_call.input,
                        actor_user_id=writer.approval_actor_user_id,
                        agent_id=writer.approval_agent_id,
                        channel_id=writer.approval_channel_id,
                        message_id=tool_call_message_ids.get(tool_call.id),
                    )
                    yield StreamEvent(
                        type=EventType.CONFIRMATION_REQUIRED,
                        tool_call_id=tool_call.id,
                        tool_name=tool_call.name,
                        tool_args=tool_call.input,
                        description=(
                            f"The agent wants to perform a destructive action: {tool_call.name}"
                        ),
                        message_id=tool_call_message_ids.get(tool_call.id),
                    )
                    approved = await approval_store.wait_for_response(
                        writer.approval_scope_id,
                        tool_call.id,
                        timeout=120.0,
                    )
                    if not approved:
                        turn_traces[tool_call.id]["success"] = False
                        rejection = "Action was rejected by the user or timed out."
                        stored_result = await writer.add_message(
                            role="tool",
                            content=rejection,
                            tool_name=tool_call.name,
                            tool_call_id=tool_call.id,
                            tool_result=rejection,
                        )
                        yield StreamEvent(
                            type=EventType.TOOL_RESULT_END,
                            tool_call_id=tool_call.id,
                            tool_name=tool_call.name,
                            success=False,
                            tool_result=rejection,
                            message_id=stored_result.id,
                        )
                        results_content[tool_call.id] = rejection
                        continue

                tool_result = await executor.execute(tool_call)
                turn_traces[tool_call.id]["success"] = tool_result.success
                turn_tool_results[tool_call.id] = tool_result
                content = tool_result.data if tool_result.success else f"Error: {tool_result.error}"
                stored_result = await writer.add_message(
                    role="tool",
                    content=content,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    tool_result=content,
                    tool_metadata=tool_result.metadata,
                )
                yield StreamEvent(
                    type=EventType.TOOL_RESULT_END,
                    tool_call_id=tool_call.id,
                    tool_name=tool_call.name,
                    success=tool_result.success,
                    tool_result=content,
                    message_id=stored_result.id,
                )
                results_content[tool_call.id] = content

            llm_messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_call.id,
                        "tool_name": tool_call.name,
                        "content": results_content[tool_call.id],
                    }
                    for tool_call in result.tool_calls
                ],
            })

            expand_loaded_schemas(tool_schemas, deferred_pool, turn_tool_results)

            stream_result: StreamSegmentResult | None = None
            async for event in controlled_stream_segment(
                controller=call_controller,
                writer=writer,
                messages=llm_messages,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_id),
                safety_identifier=safety_identifier,
            ):
                if isinstance(event, StreamSegmentResult):
                    stream_result = event
                else:
                    yield event

            if stream_result is None or (
                stream_result.completion is None and not stream_result.error
            ):
                yield StreamEvent(
                    type=EventType.ERROR,
                    error="No response from LLM during tool loop",
                )
                return

            if stream_result.error:
                logger.warning(
                    "Provider tool-loop stream failed",
                    provider=call_controller.target.provider_name,
                    model=call_controller.target.model,
                    error=stream_result.error,
                )
                yield StreamEvent(type=EventType.ERROR, error="Model provider request failed")
                return

            result = stream_result.completion
            if result is None:
                raise RuntimeError("stream terminal result missing completion")

            if result.stop_reason != CompletionStopReason.TOOL_USE or not result.tool_calls:
                if stream_result.placeholder_id is not None:
                    assistant_message = await writer.finalize_assistant_placeholder(
                        message_id=stream_result.placeholder_id,
                        content=result.content or "",
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        cache_creation_input_tokens=result.cache_creation_input_tokens,
                        cache_read_input_tokens=result.cache_read_input_tokens,
                        model=result.model,
                        thinking=stream_result.thinking or None,
                    )
                else:
                    assistant_message = await writer.add_message(
                        role="assistant",
                        content=result.content,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        cache_creation_input_tokens=result.cache_creation_input_tokens,
                        cache_read_input_tokens=result.cache_read_input_tokens,
                        model=result.model,
                        thinking=stream_result.thinking or None,
                    )
                yield StreamEvent(
                    type=EventType.DONE,
                    assistant_message=assistant_message,
                    model=result.model,
                )
                return

            if stream_result.placeholder_id is not None:
                await writer.finalize_assistant_placeholder(
                    message_id=stream_result.placeholder_id,
                    content=result.content or "",
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_creation_input_tokens=result.cache_creation_input_tokens,
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    model=result.model,
                    thinking=stream_result.thinking or None,
                )
            else:
                pending_thinking = stream_result.thinking or None

        yield StreamEvent(type=EventType.EXCEED_MAX_ITERS)
        yield StreamEvent(
            type=EventType.ERROR,
            error=f"Agent exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS})",
        )
