"""Non-streaming provider and tool-loop execution."""

from __future__ import annotations

import time
from typing import Any, cast
from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SessionFactory
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.run_log import AgentRunStatus
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    CompletionStopReason,
    LLMProvider,
)
from uniffy.domains.agents.providers.catalog import resolve_request_params
from uniffy.domains.agents.runtime.models.calls import (
    ModelCallController,
    ModelCallTarget,
    safety_identifier,
)
from uniffy.domains.agents.runtime.runs.records import RunRecorder
from uniffy.domains.agents.runtime.runs.usage import RunUsageAccumulator
from uniffy.domains.agents.runtime.settings.operations import get_runtime_settings
from uniffy.domains.agents.runtime.tooling import (
    MAX_LOAD_ONLY_ITERATIONS,
    MAX_TOOL_ITERATIONS,
    expand_loaded_schemas,
    gather_read_tool_results,
    is_load_only_turn,
    split_read_write,
)
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.domains.agents.tools.definitions import ToolContext, ToolResult
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry

logger = logger.bind(component="agents.runtime.runs.complete")


async def recorded_completion(
    *,
    provider: LLMProvider,
    provider_key_id: UUID | None,
    model: str,
    usage: RunUsageAccumulator,
    messages: list[dict],
    system: str | None,
    tools: list[dict] | None,
    cache_key: str,
    params: dict | None,
    controller: ModelCallController | None = None,
    safety: str | None = None,
) -> CompletionResult:
    if controller is not None:
        return await controller.complete(
            messages=messages,
            system=system,
            tools=tools,
            cache_key=cache_key,
            safety_identifier=safety,
        )
    provider_name = getattr(provider, "name", type(provider).__name__.lower())
    try:
        result = await provider.chat_completion(
            messages=messages,
            model=model,
            system=system,
            tools=tools,
            cache_key=cache_key,
            params=params,
        )
    except Exception as exc:
        usage.record_failure(
            provider=provider_name,
            provider_key_id=provider_key_id,
            model=model,
            error=type(exc).__name__,
        )
        raise
    result = cast(CompletionResult, result)
    usage.record_result(
        provider=provider_name,
        provider_key_id=provider_key_id,
        result=result,
        model=model,
    )
    return result


class CompletionToolLoop:
    def __init__(
        self,
        session_operations: SessionOperations,
        session_factory: SessionFactory,
    ) -> None:
        self._session_operations = session_operations
        self._session_factory = session_factory

    async def run(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        agent_id: UUID,
        provider: LLMProvider,
        model: str,
        system_prompt: str,
        tool_schemas: list[dict],
        llm_messages: list[dict],
        result: CompletionResult,
        executor: ToolExecutor,
        run_tool_calls: list[dict] | None = None,
        run_usage: RunUsageAccumulator | None = None,
        provider_key_id: UUID | None = None,
        call_controller: ModelCallController | None = None,
        safety: str | None = None,
        model_params: dict | None = None,
        deferred_pool: dict[str, list[dict]] | None = None,
    ) -> CompletionResult:
        usage = run_usage or RunUsageAccumulator()
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
                "Tool loop iteration",
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

            for tool_call in result.tool_calls:
                await self._session_operations.add_message(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
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
                )
                if run_tool_calls is not None:
                    run_tool_calls.append({"name": tool_call.name, "call_id": tool_call.id})

            registry = executor.registry
            base_context = executor.context
            read_calls, write_calls = split_read_write(registry, result.tool_calls)
            tool_results: dict[str, ToolResult] = await gather_read_tool_results(
                registry,
                base_context,
                read_calls,
                self._session_factory,
            )
            for tool_call in write_calls:
                tool_results[tool_call.id] = await executor.execute(tool_call)

            tool_result_blocks: list[dict] = []
            for tool_call in result.tool_calls:
                tool_result = tool_results[tool_call.id]
                result_content = (
                    tool_result.data if tool_result.success else f"Error: {tool_result.error}"
                )
                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tool_call.id,
                    "tool_name": tool_call.name,
                    "content": result_content,
                })
                await self._session_operations.add_message(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    role="tool",
                    content=result_content,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    tool_result=result_content,
                )

            llm_messages.append({
                "role": "user",
                "content": tool_result_blocks,
            })
            expand_loaded_schemas(tool_schemas, deferred_pool, tool_results)

            result = await recorded_completion(
                provider=provider,
                provider_key_id=provider_key_id,
                usage=usage,
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_id),
                params=model_params,
                controller=call_controller,
                safety=safety,
            )
            if result.stop_reason != CompletionStopReason.TOOL_USE or not result.tool_calls:
                return result

        raise ValidationError(
            "tool_loop",
            f"Agent exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS})",
        )


class CompletionRunner:
    def __init__(
        self,
        *,
        session: AsyncSession,
        session_operations: SessionOperations,
        session_factory: SessionFactory,
        provider_operations: Any,
        recorder: RunRecorder,
    ) -> None:
        self._session = session
        self._session_operations = session_operations
        self._provider_operations = provider_operations
        self._recorder = recorder
        self._tool_loop = CompletionToolLoop(session_operations, session_factory)

    async def run(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        agent_id: UUID,
        provider: LLMProvider,
        provider_key_id: UUID | None,
        model: str,
        fallback_models: list[str],
        agent_model_params: dict | None,
        request_params: dict | None,
        system_prompt: str,
        tool_schemas: list[dict] | None,
        llm_messages: list[dict],
        registry: ToolRegistry,
        tool_context: ToolContext,
        deferred_pool: dict[str, list[dict]],
    ) -> tuple[AgentMessage, str]:
        start_time = time.monotonic()
        run_tool_calls: list[dict] = []
        usage = RunUsageAccumulator()
        runtime_settings = await get_runtime_settings(
            self._session,
            organization_id,
        )
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
                    None,
                    provider_name,
                    target_model,
                )
            ),
        )
        safety = safety_identifier(organization_id=organization_id, user_id=user_id)
        tool_iterations = 0
        status: AgentRunStatus | str = AgentRunStatus.SUCCESS
        error: str | None = None

        try:
            result = await recorded_completion(
                provider=provider,
                provider_key_id=provider_key_id,
                usage=usage,
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_id),
                params=request_params,
                controller=controller,
                safety=safety,
            )
            if (
                tool_schemas
                and result.stop_reason == CompletionStopReason.TOOL_USE
                and result.tool_calls
            ):
                result = await self._tool_loop.run(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    provider=provider,
                    model=model,
                    system_prompt=system_prompt,
                    tool_schemas=tool_schemas,
                    llm_messages=llm_messages,
                    result=result,
                    executor=ToolExecutor(registry, tool_context),
                    run_tool_calls=run_tool_calls,
                    run_usage=usage,
                    provider_key_id=provider_key_id,
                    call_controller=controller,
                    safety=safety,
                    model_params=request_params,
                    deferred_pool=deferred_pool,
                )
                tool_iterations = len(run_tool_calls)
        except Exception as exc:
            status = AgentRunStatus.ERROR
            error = str(exc)
            await self._recorder.record(
                session_id=session_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                usage=usage,
                tool_calls=run_tool_calls or None,
                tool_iterations=tool_iterations,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                status=status,
                error=error,
                provider_key_id=provider_key_id,
            )
            raise

        assistant_message = await self._session_operations.add_message(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            role="assistant",
            content=result.content,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            cache_creation_input_tokens=result.cache_creation_input_tokens,
            cache_read_input_tokens=result.cache_read_input_tokens,
            model=result.model,
        )
        await self._recorder.record(
            session_id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
            model=result.model,
            usage=usage,
            tool_calls=run_tool_calls or None,
            tool_iterations=tool_iterations,
            duration_ms=int((time.monotonic() - start_time) * 1000),
            status=status,
            error=error,
            provider_key_id=provider_key_id,
        )
        return assistant_message, result.model
