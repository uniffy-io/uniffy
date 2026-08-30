"""Streaming provider execution and terminal run accounting."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.run_log import AgentRunStatus
from uniffy.domains.agents.providers.base import (
    CompletionStopReason,
    EventType,
    LLMProvider,
    StreamEvent,
)
from uniffy.domains.agents.providers.catalog import resolve_request_params
from uniffy.domains.agents.runtime.models.calls import (
    ModelCallController,
    ModelCallTarget,
    safety_identifier,
)
from uniffy.domains.agents.runtime.runs.records import RunRecorder
from uniffy.domains.agents.runtime.runs.segments import (
    StreamSegmentResult,
    controlled_stream_segment,
)
from uniffy.domains.agents.runtime.runs.tools import StreamingToolLoop
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator
from uniffy.domains.agents.runtime.settings.operations import get_runtime_settings
from uniffy.domains.agents.runtime.writers import MessageWriter
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry

logger = logger.bind(component="agents.runtime.runs.stream")


class StreamingRunner:
    def __init__(
        self,
        *,
        session: AsyncSession,
        provider_operations: Any,
        recorder: RunRecorder,
        tool_loop: StreamingToolLoop,
    ) -> None:
        self._session = session
        self._provider_operations = provider_operations
        self._recorder = recorder
        self._tool_loop = tool_loop

    async def run(
        self,
        *,
        writer: MessageWriter,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID | None,
        channel_id: UUID | None,
        agent_id: UUID,
        provider: LLMProvider,
        provider_key_id: UUID | None,
        model: str,
        fallback_models: list[str],
        agent_model_params: dict | None,
        params_override: dict | None,
        request_params: dict | None,
        system_prompt: str,
        tool_schemas: list[dict] | None,
        llm_messages: list[dict],
        registry: ToolRegistry,
        tool_context: ToolContext,
        deferred_pool: dict[str, list[dict]],
    ) -> AsyncIterator[StreamEvent]:
        start_time = time.monotonic()
        run_tool_calls: list[dict] = []
        usage = RunUsageAccumulator()
        runtime_settings = await get_runtime_settings(self._session, organization_id)
        controller = ModelCallController(
            provider_ops=self._provider_operations,
            organization_id=organization_id,
            target=ModelCallTarget(provider, provider_key_id, model),
            fallback_models=fallback_models,
            settings=runtime_settings,
            usage=usage,
            params_for_target=lambda provider_name, target_model: (
                request_params
                if provider_name == provider.name and target_model == model
                else resolve_request_params(
                    agent_model_params,
                    params_override,
                    provider_name,
                    target_model,
                )
            ),
        )
        safety = safety_identifier(organization_id=organization_id, user_id=user_id)

        stream_result: StreamSegmentResult | None = None
        async for event in controlled_stream_segment(
            controller=controller,
            writer=writer,
            messages=llm_messages,
            system=system_prompt,
            tools=tool_schemas,
            cache_key=str(agent_id),
            safety_identifier=safety,
        ):
            if isinstance(event, StreamSegmentResult):
                stream_result = event
            else:
                yield event

        if stream_result is None or (stream_result.completion is None and not stream_result.error):
            await self._record_error(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                usage=usage,
                tool_calls=None,
                tool_iterations=0,
                start_time=start_time,
                error="No response from LLM",
                provider_key_id=provider_key_id,
            )
            yield StreamEvent(type=EventType.ERROR, error="No response from LLM")
            return

        if stream_result.error:
            logger.warning(
                "Provider stream failed",
                provider=controller.target.provider_name,
                model=controller.target.model,
                error=stream_result.error,
            )
            await self._record_error(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                usage=usage,
                tool_calls=None,
                tool_iterations=0,
                start_time=start_time,
                error=stream_result.error,
                provider_key_id=provider_key_id,
            )
            yield StreamEvent(type=EventType.ERROR, error="Model provider request failed")
            return

        completion = stream_result.completion
        if completion is None:
            raise RuntimeError("stream terminal result missing completion")

        has_tool_use = (
            tool_schemas
            and completion.stop_reason == CompletionStopReason.TOOL_USE
            and completion.tool_calls
        )
        if has_tool_use:
            if stream_result.placeholder_id is not None:
                await writer.finalize_assistant_placeholder(
                    message_id=stream_result.placeholder_id,
                    content=completion.content or "",
                    input_tokens=completion.input_tokens,
                    output_tokens=completion.output_tokens,
                    cache_creation_input_tokens=completion.cache_creation_input_tokens,
                    cache_read_input_tokens=completion.cache_read_input_tokens,
                    model=completion.model,
                    thinking=stream_result.thinking or None,
                )

            terminal_error: str | None = None
            async for event in self._tool_loop.run(
                writer=writer,
                agent_id=agent_id,
                system_prompt=system_prompt,
                tool_schemas=tool_schemas,
                llm_messages=llm_messages,
                result=completion,
                executor=ToolExecutor(registry, tool_context),
                run_tool_calls=run_tool_calls,
                call_controller=controller,
                safety_identifier=safety,
                pending_thinking=(
                    stream_result.thinking if stream_result.placeholder_id is None else None
                ),
                deferred_pool=deferred_pool,
            ):
                if event.type is EventType.DONE:
                    await self._recorder.record(
                        session_id=session_id,
                        channel_id=channel_id,
                        agent_id=agent_id,
                        user_id=user_id,
                        organization_id=organization_id,
                        model=event.model,
                        usage=usage,
                        tool_calls=run_tool_calls or None,
                        tool_iterations=len(run_tool_calls),
                        duration_ms=int((time.monotonic() - start_time) * 1000),
                        status=AgentRunStatus.SUCCESS,
                        error=None,
                        provider_key_id=provider_key_id,
                    )
                    yield event
                    return
                if event.type is EventType.ERROR:
                    terminal_error = event.error
                yield event

            await self._record_error(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=usage.last_model or model,
                usage=usage,
                tool_calls=run_tool_calls or None,
                tool_iterations=len(run_tool_calls),
                start_time=start_time,
                error=terminal_error or "tool_loop_incomplete",
                provider_key_id=provider_key_id,
            )
            return

        if stream_result.placeholder_id is not None:
            assistant_message = await writer.finalize_assistant_placeholder(
                message_id=stream_result.placeholder_id,
                content=completion.content or "",
                input_tokens=completion.input_tokens,
                output_tokens=completion.output_tokens,
                cache_creation_input_tokens=completion.cache_creation_input_tokens,
                cache_read_input_tokens=completion.cache_read_input_tokens,
                model=completion.model,
                thinking=stream_result.thinking or None,
            )
        else:
            assistant_message = await writer.add_message(
                role="assistant",
                content=completion.content,
                input_tokens=completion.input_tokens,
                output_tokens=completion.output_tokens,
                cache_creation_input_tokens=completion.cache_creation_input_tokens,
                cache_read_input_tokens=completion.cache_read_input_tokens,
                model=completion.model,
                thinking=stream_result.thinking or None,
            )

        await self._recorder.record(
            session_id=session_id,
            channel_id=channel_id,
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
            model=completion.model,
            usage=usage,
            tool_calls=None,
            tool_iterations=0,
            duration_ms=int((time.monotonic() - start_time) * 1000),
            status=AgentRunStatus.SUCCESS,
            error=None,
            provider_key_id=provider_key_id,
        )
        yield StreamEvent(
            type=EventType.DONE,
            assistant_message=assistant_message,
            model=completion.model,
        )

    async def _record_error(
        self,
        *,
        session_id: UUID | None,
        channel_id: UUID | None,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        model: str,
        usage: RunUsageAccumulator,
        tool_calls: list[dict] | None,
        tool_iterations: int,
        start_time: float,
        error: str,
        provider_key_id: UUID | None,
    ) -> None:
        await self._recorder.record(
            session_id=session_id,
            channel_id=channel_id,
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
            model=model,
            usage=usage,
            tool_calls=tool_calls,
            tool_iterations=tool_iterations,
            duration_ms=int((time.monotonic() - start_time) * 1000),
            status=AgentRunStatus.ERROR,
            error=error,
            provider_key_id=provider_key_id,
        )
