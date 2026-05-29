"""Core orchestration for agent runtime - send message flow."""

from __future__ import annotations

import asyncio
import base64
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, replace
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import SenderType as ChatSenderType
from uniffy.core.types import SubjectType
from uniffy.db.session import open_session
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.budget_alerts import check_and_fire_alerts
from uniffy.domains.agents.cache import (
    fetch_agent_prompt,
    fetch_agent_skills,
)
from uniffy.domains.agents.content_policy import check_user_message
from uniffy.domains.agents.currency import convert as convert_currency
from uniffy.domains.agents.currency import get_display_currency
from uniffy.domains.agents.pricing import compute_text_cost, get_pricing
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    DoneEvent,
    ErrorEvent,
    StreamEvent,
    TokenEvent,
    ToolCallEvent,
)
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.destinations import (
    ChatDestination,
    RuntimeDestination,
    SessionDestination,
)
from uniffy.domains.agents.runtime.file_loader import FileContext
from uniffy.domains.agents.runtime.model_resolver import resolve_model
from uniffy.domains.agents.runtime.prompt import (
    build_chat_context_section,
    build_system_prompt,
)
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
from uniffy.domains.agents.runtime.writers import (
    ChatChannelMessageWriter,
    MessageWriter,
    SessionMessageWriter,
)
from uniffy.domains.agents.sessions.operations import (
    FALLBACK_CONTEXT_WINDOW,
    SessionOperations,
    apply_emergency_truncation,
)
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.tools.definitions import ToolContext, ToolResult
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import ToolRegistry, get_tool_registry, to_api_name
from uniffy.domains.chat.sender_resolver import SenderResolver
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.operations import UserOperations

MAX_TOOL_ITERATIONS = 10
READ_TOOL_POOL_SIZE = 5


def _split_read_write(
    registry: ToolRegistry,
    tool_calls: list,
) -> tuple[list, list]:
    """Partition a turn's tool_calls into ``(reads, writes)``.

    Read-only tools (``ToolDefinition.read_only=True``) can fan out
    concurrently against fresh per-tool sessions. Everything else --
    including unknown / unregistered tools -- runs sequentially on the
    runtime's own session so transaction semantics are preserved.
    """
    reads: list = []
    writes: list = []
    for tc in tool_calls:
        td = registry.get(tc.name)
        if td is not None and td.read_only:
            reads.append(tc)
        else:
            writes.append(tc)
    return reads, writes


async def _execute_read_tool_isolated(
    registry: ToolRegistry,
    base_ctx: ToolContext,
    tc,
    semaphore: asyncio.Semaphore,
) -> ToolResult:
    """Run one read-only tool against a fresh ``AsyncSession``.

    Concurrent SQL on a single ``AsyncSession`` is unsafe (asyncpg
    serialises through one connection); so each task acquires its own
    session via ``open_session`` for the duration of the call. The
    semaphore caps in-flight session count per turn.
    """
    async with semaphore, open_session() as fresh_session:
        new_ctx = replace(base_ctx, session=fresh_session)
        executor = ToolExecutor(registry, new_ctx)
        return await executor.execute(tc)


async def _gather_read_tool_results(
    registry: ToolRegistry,
    base_ctx: ToolContext,
    read_calls: list,
) -> dict[str, ToolResult]:
    """Run read-only tool calls concurrently and key results by tool_use id."""
    if not read_calls:
        return {}
    semaphore = asyncio.Semaphore(READ_TOOL_POOL_SIZE)
    tasks = [
        _execute_read_tool_isolated(registry, base_ctx, tc, semaphore)
        for tc in read_calls
    ]
    raw = await asyncio.gather(*tasks, return_exceptions=True)
    results: dict[str, ToolResult] = {}
    for tc, res in zip(read_calls, raw, strict=True):
        if isinstance(res, BaseException):
            results[tc.id] = ToolResult(
                success=False,
                data="",
                error=f"Internal error executing {tc.name}: {res}",
            )
        else:
            results[tc.id] = res
    return results


def _file_context_to_content_block(
    f: FileContext,
    *,
    supports_vision: bool = True,
) -> dict:
    """Convert a FileContext to a provider-agnostic LLM content block.

    Image attachments fall back to a structured text note when
    ``supports_vision`` is False so the model can tell the user it
    cannot view images instead of hallucinating "no image attached".
    """
    media_type = f.media_type

    if media_type.startswith("image/"):
        if not supports_vision:
            return {
                "type": "text",
                "text": (
                    f"[Attached image: {f.filename} ({media_type}) - the current model "
                    f"does not support image input. The user attached this image but "
                    f"you cannot view it. Tell the user the current model is not "
                    f"vision-capable and ask them to describe the image or switch "
                    f"to a vision-capable model.]"
                ),
            }
        return {
            "type": "image",
            "media_type": media_type,
            "storage_key": f.storage_key,
        }

    if media_type == "application/pdf":
        return {
            "type": "document",
            "media_type": media_type,
            "storage_key": f.storage_key,
            "filename": f.filename,
        }

    if f.extracted_text:
        return {
            "type": "text",
            "text": (f"--- File: {f.filename} ---\n{f.extracted_text}\n--- End of {f.filename} ---"),
        }

    from uniffy.core.extraction import can_extract

    if can_extract(media_type):
        return {
            "type": "text_pending_extraction",
            "media_type": media_type,
            "storage_key": f.storage_key,
            "filename": f.filename,
        }

    return {
        "type": "text",
        "text": f"[Attached file: {f.filename} ({media_type}) - content not extractable]",
    }


async def _resolve_supports_vision(provider: object, model_id: str) -> bool:
    """Return True when the resolved model declares image-input support.

    Defaults to True when the model is not in the provider's catalog so
    unknown / newly-released models do not silently drop attachments;
    provider call errors surface upstream in that case.
    """
    try:
        available = await provider.get_available_models()  # type: ignore[attr-defined]
    except Exception:
        logger.exception("Failed to look up provider models for vision gating")
        return True
    for m in available:
        if m.id == model_id:
            return bool(getattr(m, "supports_vision", False))
    return True


def _file_urn(file_id: str) -> str:
    return f"urn:uniffy:content:FILE:{file_id}"


def _file_mention(f: FileContext) -> str:
    return f"[[[{f.filename}|{_file_urn(f.file_id)}]]]"


def _build_stored_content(
    content: str,
    files: list[FileContext] | None,
) -> str:
    """Enrich the user message with `[[[label|urn]]]` mentions and extracted text."""
    if not files:
        return content

    parts: list[str] = []
    for f in files:
        mention = _file_mention(f)
        if f.extracted_text:
            parts.append(
                f"{mention}\n"
                f"--- File: {f.filename} ---\n"
                f"{f.extracted_text}\n"
                f"--- End of {f.filename} ---"
            )
        else:
            parts.append(mention)

    if content.strip():
        parts.append(content)

    return "\n\n".join(parts)


async def _resolve_pending_content_blocks(messages: list[dict]) -> None:
    """Resolve content blocks that need S3 downloads or on-demand extraction.

    Mutates `messages` in place: image/document blocks get base64 data,
    `text_pending_extraction` blocks become inline extracted text.
    """
    from uniffy.core.storage import get_s3_client

    s3 = get_s3_client()

    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            continue

        resolved: list[dict] = []
        for block in content:
            block_type = block.get("type", "")

            if block_type == "image" and "storage_key" in block:
                data = await s3.download_bytes(block["storage_key"])
                b64 = base64.b64encode(data).decode("ascii")
                resolved.append({
                    "type": "image",
                    "media_type": block["media_type"],
                    "data": b64,
                })

            elif block_type == "document" and "storage_key" in block:
                data = await s3.download_bytes(block["storage_key"])
                b64 = base64.b64encode(data).decode("ascii")
                resolved.append({
                    "type": "document",
                    "media_type": block["media_type"],
                    "data": b64,
                    "filename": block.get("filename", ""),
                })

            elif block_type == "text_pending_extraction":
                from uniffy.core.extraction import (
                    UnsupportedFormatError,
                    extract_text,
                )

                data = await s3.download_bytes(block["storage_key"])
                filename = block.get("filename", "file")
                try:
                    result = extract_text(
                        data,
                        block["media_type"],
                    )
                    resolved.append({
                        "type": "text",
                        "text": (
                            f"--- File: {filename} ---\n{result.text}\n--- End of {filename} ---"
                        ),
                    })
                except UnsupportedFormatError:
                    resolved.append({
                        "type": "text",
                        "text": (
                            f"[Attached file: {filename} "
                            f"({block['media_type']}) - content not extractable]"
                        ),
                    })

            else:
                resolved.append(block)

        msg["content"] = resolved


async def _get_model_context_window(provider, model: str) -> int:
    """Look up context-window tokens; falls back to `FALLBACK_CONTEXT_WINDOW`."""
    try:
        available = await provider.get_available_models()
        for m in available:
            if m.id == model:
                return m.context_window
    except Exception:
        pass
    return FALLBACK_CONTEXT_WINDOW


class RuntimeOperations:
    """Operations for agent runtime message execution."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._org_ops = OrganizationOperations(session)
        self._user_ops = UserOperations(session)
        self._session_ops = SessionOperations(session)
        self._agent_ops = AgentOperations(session)
        self._provider_ops = ProviderOperations(session)
        self._skill_ops = SkillOperations(session)

    async def send_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        content: str,
        files: list[FileContext] | None = None,
        user_timezone: str | None = None,
    ) -> tuple[AgentMessage, AgentMessage, str]:
        """Execute the full send-message flow with tool use loop."""
        membership = await self._org_ops.require_org_member(user_id, organization_id)

        agent_session = await self._session_ops.get_session(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )

        agent = await self._agent_ops.get_for_runtime(
            user_id,
            organization_id,
            agent_session.agent_id,
        )

        org = await self._org_ops.get_by_id(organization_id)
        user = await self._user_ops.get_by_id(user_id)
        role = membership.role
        user_role = role.value if hasattr(role, "value") else str(role)

        target_model = agent_session.model_override or agent.primary_model
        provider_key_id: UUID | None = None

        if agent.primary_provider_key_id:
            provider, pk = await self._provider_ops.get_provider_for_key(
                organization_id=organization_id,
                key_id=agent.primary_provider_key_id,
            )
            provider_key_id = pk.id
        else:
            resolved = await self._provider_ops.get_key_and_provider_for_model(
                organization_id=organization_id,
                model_id=target_model,
            )
            if resolved is None:
                raise NotFoundError(
                    "ProviderKey",
                    f"No configured provider has model '{target_model}' available",
                )
            provider, pk = resolved
            provider_key_id = pk.id

        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()
        tool_schemas = registry.get_anthropic_schemas(enabled_tools) or None

        skills = await fetch_agent_skills(
            self._skill_ops,
            agent_id=agent.id,
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )
        skill_contents = [s.content for s in skills if s.content]

        memory_context = await self._fetch_memory_context(
            agent_id=agent_session.agent_id,
            user_id=user_id,
            organization_id=organization_id,
        )

        prompt_content = await fetch_agent_prompt(
            self._session,
            agent_id=agent.id,
            prompt_id=agent.prompt_id,
        )

        system_prompt = build_system_prompt(
            agent_name=agent.name,
            soul_prompt=agent.soul_prompt,
            org_name=org.name,
            user_name=user.full_name or user.username,
            user_role=user_role,
            enabled_tools=enabled_tools,
            skill_contents=skill_contents or None,
            memory_context=memory_context or None,
            prompt_content=prompt_content,
            user_timezone=user_timezone,
        )

        # 8. Resolve model (needed for compaction)
        model = await resolve_model(
            session_model_override=agent_session.model_override,
            agent_primary_model=agent.primary_model,
            agent_fallback_models=agent.fallback_models or [],
            provider=provider,
        )

        # 8b. Look up model context window for token-based compaction
        context_window_tokens = await _get_model_context_window(provider, model)
        token_budget = int(context_window_tokens * 0.65)

        # 8c. Schedule async compaction when over budget (no LLM call here).
        await self._session_ops.enqueue_compaction_if_needed(
            session_id=session_id,
            token_budget=token_budget,
        )

        # 9. Load context, then apply emergency truncation when the worker
        # has not caught up and the active window is still over budget.
        context_messages, _ = await self._session_ops.get_session_context(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            token_budget=token_budget,
        )
        context_messages = apply_emergency_truncation(context_messages, token_budget)

        # 10. Content policy check (warn-only, never blocks)
        injection_flags = check_user_message(content)
        if injection_flags:
            logger.warning(
                "Prompt injection flags in send_message",
                flags=injection_flags,
                user_id=str(user_id),
                session_id=str(session_id),
            )

        # 11. Build LLM messages array from context
        supports_vision = await _resolve_supports_vision(provider, model)
        llm_messages = self._build_llm_messages(
            context_messages, content, files=files, supports_vision=supports_vision
        )

        # 11b. Resolve any content blocks that need S3 downloads
        await _resolve_pending_content_blocks(llm_messages)

        # 12. Store user message with enriched content (file text baked in
        # so the LLM retains file context on subsequent turns).
        stored_content = _build_stored_content(content, files)
        user_message = await self._session_ops.add_message(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            role="user",
            content=stored_content,
            file_ids=[f.file_id for f in files] if files else None,
        )

        # 13. Call LLM (with tools if configured) and track timing
        start_time = time.monotonic()
        run_tool_calls: list[dict] = []
        tool_iterations = 0
        run_status = "success"
        run_error: str | None = None

        try:
            result = await provider.chat_completion(
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_session.agent_id),
            )

            # 13. Agentic tool loop
            if tool_schemas and result.stop_reason == "tool_use" and result.tool_calls:
                tool_ctx = ToolContext(
                    session=self._session,
                    user_id=user_id,
                    organization_id=organization_id,
                    agent_id=agent_session.agent_id,
                    session_id=session_id,
                    user_timezone=user_timezone,
                )
                executor = ToolExecutor(registry, tool_ctx)

                result = await self._run_tool_loop(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    agent_id=agent_session.agent_id,
                    provider=provider,
                    model=model,
                    system_prompt=system_prompt,
                    tool_schemas=tool_schemas,
                    llm_messages=llm_messages,
                    result=result,
                    executor=executor,
                    run_tool_calls=run_tool_calls,
                )
                tool_iterations = len(run_tool_calls)

        except Exception as exc:
            run_status = "error"
            run_error = str(exc)
            duration_ms = int((time.monotonic() - start_time) * 1000)
            await self._create_run_log(
                session_id=session_id,
                agent_id=agent_session.agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                input_tokens=0,
                output_tokens=0,
                tool_calls=run_tool_calls or None,
                tool_iterations=tool_iterations,
                duration_ms=duration_ms,
                status=run_status,
                error=run_error,
                provider_key_id=provider_key_id,
            )
            raise

        # 14. Store final assistant message
        assistant_message = await self._session_ops.add_message(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            role="assistant",
            content=result.content,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            cache_read_input_tokens=result.cache_read_input_tokens,
            model=result.model,
        )

        # 15. Create run log
        duration_ms = int((time.monotonic() - start_time) * 1000)
        await self._create_run_log(
            session_id=session_id,
            agent_id=agent_session.agent_id,
            user_id=user_id,
            organization_id=organization_id,
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            cache_read_input_tokens=result.cache_read_input_tokens,
            tool_calls=run_tool_calls or None,
            tool_iterations=tool_iterations,
            duration_ms=duration_ms,
            status=run_status,
            error=run_error,
            provider_key_id=provider_key_id,
        )

        return user_message, assistant_message, result.model

    async def _run_tool_loop(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        agent_id: UUID,
        provider,
        model: str,
        system_prompt: str,
        tool_schemas: list[dict],
        llm_messages: list[dict],
        result: CompletionResult,
        executor: ToolExecutor,
        run_tool_calls: list[dict] | None = None,
    ) -> CompletionResult:
        """Run the tool-use loop until the LLM produces a final response.

        Each iteration:
        1. Store the assistant message with tool_use content blocks
        2. Execute each tool call and store tool result messages
        3. Rebuild the messages array with the new tool interactions
        4. Re-invoke the LLM

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session for storing messages.
        provider : LLMProvider
            The LLM provider to call.
        model : str
            Model identifier.
        system_prompt : str
            System prompt.
        tool_schemas : list[dict]
            Tool schemas for the LLM.
        llm_messages : list[dict]
            Current message history.
        result : CompletionResult
            Initial LLM result containing tool calls.
        executor : ToolExecutor
            Tool executor with user context.

        Returns
        -------
        CompletionResult
            The final LLM result (stop_reason != "tool_use").

        Raises
        ------
        ValidationError
            If the loop exceeds MAX_TOOL_ITERATIONS.

        """
        for iteration in range(MAX_TOOL_ITERATIONS):
            logger.debug(
                "Tool loop iteration",
                iteration=iteration + 1,
                tool_calls=len(result.tool_calls),
            )

            # Build assistant message content blocks (text + tool_use)
            assistant_content: list[dict] = []
            if result.content:
                assistant_content.append({"type": "text", "text": result.content})
            for tc in result.tool_calls:
                tool_use_block: dict = {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.input,
                }
                if tc.metadata:
                    tool_use_block["metadata"] = tc.metadata
                assistant_content.append(tool_use_block)

            # Append assistant message with tool_use blocks to LLM history
            llm_messages.append({
                "role": "assistant",
                "content": assistant_content,
            })

            # Store the assistant tool-call message(s) in the database
            for tc in result.tool_calls:
                await self._session_ops.add_message(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    role="assistant",
                    content=result.content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_args=tc.input,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    model=result.model,
                )
                # Track tool calls for run log
                if run_tool_calls is not None:
                    run_tool_calls.append({"name": tc.name, "call_id": tc.id})

            # Read-only tools fan out concurrently against fresh
            # AsyncSessions; write tools run sequentially on the
            # runtime's session to preserve transaction semantics.
            registry = executor.registry
            base_ctx = executor.context
            read_calls, write_calls = _split_read_write(registry, result.tool_calls)
            tool_results: dict[str, ToolResult] = await _gather_read_tool_results(
                registry, base_ctx, read_calls
            )
            for tc in write_calls:
                tool_results[tc.id] = await executor.execute(tc)

            tool_result_blocks: list[dict] = []
            for tc in result.tool_calls:
                tool_result = tool_results[tc.id]
                if tool_result.success:
                    result_content = tool_result.data
                else:
                    result_content = f"Error: {tool_result.error}"

                tool_result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "tool_name": tc.name,
                    "content": result_content,
                })

                await self._session_ops.add_message(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    role="tool",
                    content=result_content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_result=result_content,
                )

            # Append tool results as a user message (Anthropic API format)
            llm_messages.append({
                "role": "user",
                "content": tool_result_blocks,
            })

            # Re-invoke LLM with updated conversation
            result = await provider.chat_completion(
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_id),
            )

            # If the LLM is done (no more tool calls), exit the loop
            if result.stop_reason != "tool_use" or not result.tool_calls:
                return result

        raise ValidationError(
            "tool_loop",
            f"Agent exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS})",
        )

    def _build_llm_messages(
        self,
        context_messages: list[AgentMessage],
        new_content: str = "",
        *,
        files: list[FileContext] | None = None,
        append_new: bool = True,
        supports_vision: bool = True,
    ) -> list[dict]:
        """Build the LLM messages array from session context.

        Converts stored messages to a provider-agnostic message format.
        Handles regular messages, summary messages, and tool
        call/result message pairs.

        File content is stored in the message text at write time (see
        ``_build_stored_content``), so historical messages with file
        attachments already contain file context and need no extra
        loading.

        Parameters
        ----------
        context_messages : list[AgentMessage]
            Existing session context messages.
        new_content : str
            The new user message to append.
        files : list[FileContext] | None
            Optional files to include with the new user message.

        Returns
        -------
        list[dict]
            Messages in canonical format (provider converters map to native).

        """
        messages: list[dict] = []

        # Group consecutive assistant tool-call messages into a single
        # Anthropic assistant message with multiple content blocks.
        # Tool result messages become user messages with tool_result blocks.
        i = 0
        while i < len(context_messages):
            msg = context_messages[i]

            if msg.role == "summary":
                messages.append({
                    "role": "user",
                    "content": f"[Previous conversation summary]\n{msg.content}",
                })
                i += 1

            elif msg.role == "assistant" and msg.tool_call_id:
                # Collect consecutive assistant messages with tool calls
                # into a single assistant message with content blocks
                content_blocks: list[dict] = []
                tool_call_ids: list[str] = []

                while (
                    i < len(context_messages)
                    and context_messages[i].role == "assistant"
                    and context_messages[i].tool_call_id
                ):
                    tc_msg = context_messages[i]
                    # Add text content only once (from the first message)
                    if not content_blocks and tc_msg.content:
                        content_blocks.append({"type": "text", "text": tc_msg.content})
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc_msg.tool_call_id,
                        "name": to_api_name(tc_msg.tool_name or ""),
                        "input": tc_msg.tool_args or {},
                    })
                    tool_call_ids.append(tc_msg.tool_call_id)
                    i += 1

                messages.append({
                    "role": "assistant",
                    "content": content_blocks,
                })

                # Collect the corresponding tool result messages
                tool_result_blocks: list[dict] = []
                matched_ids: set[str] = set()
                while (
                    i < len(context_messages)
                    and context_messages[i].role == "tool"
                    and context_messages[i].tool_call_id in tool_call_ids
                ):
                    tr_msg = context_messages[i]
                    tr_block: dict = {
                        "type": "tool_result",
                        "tool_use_id": tr_msg.tool_call_id,
                        "content": tr_msg.tool_result or tr_msg.content or "",
                    }
                    if tr_msg.tool_name:
                        tr_block["tool_name"] = tr_msg.tool_name
                    tool_result_blocks.append(tr_block)
                    matched_ids.add(tr_msg.tool_call_id)
                    i += 1

                # Synthesize error results for any orphaned tool calls
                # (e.g. from a previous run that crashed mid-tool-loop)
                for tc_id in tool_call_ids:
                    if tc_id not in matched_ids:
                        tool_result_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": tc_id,
                            "content": "Error: tool execution was interrupted.",
                            "is_error": True,
                        })

                messages.append({
                    "role": "user",
                    "content": tool_result_blocks,
                })

            elif msg.role in ("user", "assistant"):
                messages.append({
                    "role": msg.role,
                    "content": msg.content or "",
                })
                i += 1

            else:
                # Skip system, tool messages not paired with assistant, etc.
                i += 1

        if not append_new:
            return messages

        # Append the new user message (with optional file attachments)
        if files:
            content_blocks: list[dict] = []
            for f in files:
                block = _file_context_to_content_block(f, supports_vision=supports_vision)
                content_blocks.append(block)
            if new_content.strip():
                content_blocks.append({"type": "text", "text": new_content})
            messages.append({
                "role": "user",
                "content": content_blocks,
            })
        else:
            messages.append({
                "role": "user",
                "content": new_content,
            })

        return messages

    async def stream_rerun_from_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        message_id: UUID,
        user_timezone: str | None = None,
    ) -> AsyncIterator[RuntimeStreamEvent]:
        """Re-run the agent from an existing edited user message.

        The anchor must be a non-invalidated user-role row whose
        downstream has already been invalidated (typically by EditMessage).
        Streams events in the same shape as ``stream_send_message`` but
        does not create a new user message - the anchor already lives in
        DB and is loaded into context via the normal window-function query.
        """
        msg, agent_session = await self._session_ops.load_message(
            user_id=user_id,
            organization_id=organization_id,
            message_id=message_id,
        )
        if msg.role != "user":
            raise ValidationError("role", "rerun is only supported on user messages")
        if msg.is_invalidated:
            raise ValidationError("message", "cannot rerun an invalidated message")

        async for event in self.stream_send_message(
            user_id=user_id,
            organization_id=organization_id,
            destination=SessionDestination(session_id=agent_session.id),
            content="",
            files=None,
            user_timezone=user_timezone,
            rerun_anchor=msg,
        ):
            yield event

    async def stream_send_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        destination: RuntimeDestination,
        content: str,
        files: list[FileContext] | None = None,
        user_timezone: str | None = None,
        rerun_anchor: AgentMessage | None = None,
    ) -> AsyncIterator[RuntimeStreamEvent]:
        """Execute the send-message flow with streaming token output.

        Same setup as send_message (verify org, get session, agent, provider,
        tools, prompt, context, resolve model) but yields streaming events
        as the LLM generates tokens and executes tools.

        Parameters
        ----------
        user_id : UUID
            The user sending the message.
        organization_id : UUID
            Organization context.
        destination : RuntimeDestination
            Explicit `SessionDestination` (direct-agent runs) or
            `ChatDestination` (chat-triggered runs).
        content : str
            The user's message content.

        Yields
        ------
        RuntimeStreamEvent
            Stream events: tokens, tool calls, tool results, stored messages,
            done, or error.

        Raises
        ------
        NotFoundError
            If session, agent, or provider key not found.
        PermissionDeniedError
            If user cannot access the session.
        ValidationError
            If no model can be resolved or tool loop exceeds max iterations.

        """
        writer: MessageWriter
        session_id: UUID | None = None
        agent_session = None
        model_override: str | None = None

        channel_id: UUID | None = None
        if isinstance(destination, SessionDestination):
            session_id = destination.session_id
            writer = SessionMessageWriter(
                session_ops=self._session_ops,
                user_id=user_id,
                organization_id=organization_id,
                session_id=session_id,
            )
        else:
            session_id = None
            channel_id = destination.channel_id
            writer = ChatChannelMessageWriter(
                session=self._session,
                user_id=user_id,
                organization_id=organization_id,
                channel_id=destination.channel_id,
                agent_id=destination.agent_id,
                trigger_message_id=destination.trigger_message_id,
                thread_root_id=destination.thread_root_id,
            )

        # 1-10: Same setup as send_message
        membership = await self._org_ops.require_org_member(user_id, organization_id)

        # Rate limits enforced by the handler preflight; runtime is a no-op here
        if isinstance(destination, SessionDestination):
            agent_session = await self._session_ops.get_session(
                user_id=user_id,
                organization_id=organization_id,
                session_id=destination.session_id,
            )
            agent_id = agent_session.agent_id
            model_override = agent_session.model_override
        else:
            agent_id = destination.agent_id

        agent = await self._agent_ops.get_for_runtime(
            user_id,
            organization_id,
            agent_id,
        )

        org = await self._org_ops.get_by_id(organization_id)
        user = await self._user_ops.get_by_id(user_id)
        role = membership.role
        user_role = role.value if hasattr(role, "value") else str(role)

        target_model = model_override or agent.primary_model
        provider_key_id: UUID | None = None

        if agent.primary_provider_key_id:
            provider, pk = await self._provider_ops.get_provider_for_key(
                organization_id=organization_id,
                key_id=agent.primary_provider_key_id,
            )
            provider_key_id = pk.id
        else:
            resolved = await self._provider_ops.get_key_and_provider_for_model(
                organization_id=organization_id,
                model_id=target_model,
            )
            if resolved is None:
                raise NotFoundError(
                    "ProviderKey",
                    f"No configured provider has model '{target_model}' available",
                )
            provider, pk = resolved
            provider_key_id = pk.id

        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()
        tool_schemas = registry.get_anthropic_schemas(enabled_tools) or None

        skills = await fetch_agent_skills(
            self._skill_ops,
            agent_id=agent.id,
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )
        skill_contents = [s.content for s in skills if s.content]

        memory_context = await self._fetch_memory_context(
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
        )

        prompt_content = await fetch_agent_prompt(
            self._session,
            agent_id=agent.id,
            prompt_id=agent.prompt_id,
        )

        chat_context_block: str | None = None
        if isinstance(destination, ChatDestination):
            chat_context_block = await self._build_chat_context_for_destination(
                destination=destination,
                trigger_user_name=user.full_name or user.username or "",
                current_agent_name=agent.name,
            )

        system_prompt = build_system_prompt(
            agent_name=agent.name,
            soul_prompt=agent.soul_prompt,
            org_name=org.name,
            user_name=user.full_name or user.username,
            user_role=user_role,
            enabled_tools=enabled_tools,
            skill_contents=skill_contents or None,
            memory_context=memory_context or None,
            prompt_content=prompt_content,
            user_timezone=user_timezone,
            chat_context=chat_context_block,
        )

        model = await resolve_model(
            session_model_override=model_override,
            agent_primary_model=agent.primary_model,
            agent_fallback_models=agent.fallback_models or [],
            provider=provider,
        )

        # Look up model context window for token-based compaction
        context_window_tokens = await _get_model_context_window(provider, model)
        token_budget = int(context_window_tokens * 0.65)

        # Schedule async compaction when over budget (no LLM call here).
        await writer.compact_if_needed(token_budget=token_budget)

        context_messages, _ = await writer.load_context_messages(
            token_budget=token_budget,
        )
        context_messages = apply_emergency_truncation(context_messages, token_budget)

        # 10b. Content policy check (warn-only, never blocks)
        if rerun_anchor is None:
            injection_flags = check_user_message(content)
            if injection_flags:
                logger.warning(
                    "Prompt injection flags in stream_send_message",
                    flags=injection_flags,
                    user_id=str(user_id),
                    session_id=str(session_id),
                )

        supports_vision = await _resolve_supports_vision(provider, model)
        llm_messages = self._build_llm_messages(
            context_messages,
            content,
            files=files,
            append_new=rerun_anchor is None,
            supports_vision=supports_vision,
        )

        # Resolve any content blocks that need S3 downloads
        await _resolve_pending_content_blocks(llm_messages)

        if rerun_anchor is None:
            # 11. Store user message with enriched content (file text baked in
            # so the LLM retains file context on subsequent turns).
            stored_content = _build_stored_content(content, files)
            user_message = await writer.add_message(
                role="user",
                content=stored_content,
                file_ids=[f.file_id for f in files] if files else None,
            )
            yield RuntimeMessageStoredEvent(message=user_message)
        else:
            # Re-run path: the anchor already lives in DB; emit it so the
            # client can reconcile the optimistic edit state.
            yield RuntimeMessageStoredEvent(message=rerun_anchor)

        # 12. Call LLM with streaming and track timing
        start_time = time.monotonic()
        run_tool_calls: list[dict] = []
        tool_iterations = 0

        stream_iter = await provider.chat_completion(
            messages=llm_messages,
            model=model,
            system=system_prompt,
            tools=tool_schemas,
            stream=True,
            cache_key=str(agent_id),
        )

        # Forward tokens in real-time as they arrive from the provider.
        # `_stream_segment` lazily reserves a chat placeholder row on the
        # first token and tags every token with its message_id, letting
        # the chat translator publish AGENT_TOKEN_DELTA events.
        stream_result: _StreamSegmentResult | None = None
        async for event in self._stream_segment(stream_iter, writer):
            if isinstance(event, _StreamSegmentResult):
                stream_result = event
            else:
                yield event  # RuntimeTokenEvent / RuntimeMessageStoredEvent

        if stream_result is None or (stream_result.completion is None and not stream_result.error):
            await self._create_run_log(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                input_tokens=0,
                output_tokens=0,
                tool_calls=None,
                tool_iterations=0,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                status="error",
                error="No response from LLM",
                provider_key_id=provider_key_id,
            )
            yield RuntimeErrorEvent(error="No response from LLM")
            return

        if stream_result.error:
            await self._create_run_log(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                input_tokens=0,
                output_tokens=0,
                tool_calls=None,
                tool_iterations=0,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                status="error",
                error=stream_result.error,
                provider_key_id=provider_key_id,
            )
            yield RuntimeErrorEvent(error=stream_result.error)
            return

        completion = stream_result.completion

        # 13. Streaming tool loop
        has_tool_use = (
            tool_schemas and completion.stop_reason == "tool_use" and completion.tool_calls
        )
        if has_tool_use:
            # Stream produced tool_use; the placeholder we reserved (if
            # any) holds the model's narration text. Settle it in place
            # so its `streaming` flag clears -- it stays in the channel
            # as the "let me check..." preamble before the tool cards.
            if stream_result.placeholder_id is not None:
                await writer.finalize_assistant_placeholder(
                    message_id=stream_result.placeholder_id,
                    content=completion.content or "",
                    input_tokens=completion.input_tokens,
                    output_tokens=completion.output_tokens,
                    cache_read_input_tokens=completion.cache_read_input_tokens,
                    model=completion.model,
                )

            tool_ctx = ToolContext(
                session=self._session,
                user_id=user_id,
                organization_id=organization_id,
                agent_id=agent_id,
                session_id=session_id,
                user_timezone=user_timezone,
            )
            executor = ToolExecutor(registry, tool_ctx)

            async for event in self._stream_tool_loop(
                writer=writer,
                provider=provider,
                model=model,
                agent_id=agent_id,
                system_prompt=system_prompt,
                tool_schemas=tool_schemas,
                llm_messages=llm_messages,
                result=completion,
                executor=executor,
                run_tool_calls=run_tool_calls,
            ):
                if isinstance(event, RuntimeDoneEvent):
                    # The tool loop yielded a done event with the final result;
                    # create run log and re-yield
                    tool_iterations = len(run_tool_calls)
                    msg = event.assistant_message
                    await self._create_run_log(
                        session_id=session_id,
                        channel_id=channel_id,
                        agent_id=agent_id,
                        user_id=user_id,
                        organization_id=organization_id,
                        model=event.model_used,
                        input_tokens=msg.input_tokens if msg else 0,
                        output_tokens=msg.output_tokens if msg else 0,
                        cache_read_input_tokens=(
                            msg.cache_read_input_tokens if msg else 0
                        ),
                        tool_calls=run_tool_calls or None,
                        tool_iterations=tool_iterations,
                        duration_ms=int((time.monotonic() - start_time) * 1000),
                        status="success",
                        error=None,
                        provider_key_id=provider_key_id,
                    )
                    yield event
                    return
                yield event

            # If we got here, the tool loop raised ValidationError (max iterations)
            return

        # 14. Store final assistant message (no tool use). When the chat
        # writer reserved a placeholder during streaming we finalize it
        # in place so the row id stays stable; otherwise fall back to a
        # fresh insert (session path / empty stream).
        if stream_result.placeholder_id is not None:
            assistant_message = await writer.finalize_assistant_placeholder(
                message_id=stream_result.placeholder_id,
                content=completion.content or "",
                input_tokens=completion.input_tokens,
                output_tokens=completion.output_tokens,
                cache_read_input_tokens=completion.cache_read_input_tokens,
                model=completion.model,
            )
        else:
            assistant_message = await writer.add_message(
                role="assistant",
                content=completion.content,
                input_tokens=completion.input_tokens,
                output_tokens=completion.output_tokens,
                cache_read_input_tokens=completion.cache_read_input_tokens,
                model=completion.model,
            )

        # 15. Create run log for non-tool-use path. Both session and chat
        # destinations are logged; the writer's destination is recorded
        # via either `session_id` or `channel_id`.
        await self._create_run_log(
            session_id=session_id,
            channel_id=channel_id,
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
            model=completion.model,
            input_tokens=completion.input_tokens,
            output_tokens=completion.output_tokens,
            cache_read_input_tokens=completion.cache_read_input_tokens,
            tool_calls=None,
            tool_iterations=0,
            duration_ms=int((time.monotonic() - start_time) * 1000),
            status="success",
            error=None,
            provider_key_id=provider_key_id,
        )

        yield RuntimeDoneEvent(
            assistant_message=assistant_message,
            model_used=completion.model,
        )

    async def _stream_tool_loop(
        self,
        *,
        writer: MessageWriter,
        provider,
        model: str,
        agent_id: UUID,
        system_prompt: str,
        tool_schemas: list[dict],
        llm_messages: list[dict],
        result: CompletionResult,
        executor: ToolExecutor,
        run_tool_calls: list[dict] | None = None,
    ) -> AsyncIterator[RuntimeStreamEvent]:
        """Run the streaming tool-use loop until the LLM produces a final response.

        Same logic as _run_tool_loop but yields streaming events and uses
        streaming LLM calls for each re-invocation. Message persistence and
        approval keying both go through the supplied `MessageWriter`.

        Parameters
        ----------
        writer : MessageWriter
            Destination-aware persistence shim.
        provider : LLMProvider
            The LLM provider to call.
        model : str
            Model identifier.
        system_prompt : str
            System prompt.
        tool_schemas : list[dict]
            Tool schemas for the LLM.
        llm_messages : list[dict]
            Current message history.
        result : CompletionResult
            Initial LLM result containing tool calls.
        executor : ToolExecutor
            Tool executor with user context.

        Yields
        ------
        RuntimeStreamEvent
            Tool call, tool result, token, and done events.

        Raises
        ------
        ValidationError
            If the loop exceeds MAX_TOOL_ITERATIONS.

        """
        for iteration in range(MAX_TOOL_ITERATIONS):
            logger.debug(
                "Stream tool loop iteration",
                iteration=iteration + 1,
                tool_calls=len(result.tool_calls),
            )

            # Build assistant message content blocks (text + tool_use)
            assistant_content: list[dict] = []
            if result.content:
                assistant_content.append({"type": "text", "text": result.content})
            for tc in result.tool_calls:
                tool_use_block: dict = {
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.input,
                }
                if tc.metadata:
                    tool_use_block["metadata"] = tc.metadata
                assistant_content.append(tool_use_block)

            # Append assistant message with tool_use blocks to LLM history
            llm_messages.append({
                "role": "assistant",
                "content": assistant_content,
            })

            # Store the assistant tool-call message(s) and yield tool call events
            tool_call_message_ids: dict[str, UUID] = {}
            for tc in result.tool_calls:
                stored = await writer.add_message(
                    role="assistant",
                    content=result.content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_args=tc.input,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    model=result.model,
                )
                tool_call_message_ids[tc.id] = stored.id
                # Track tool calls for run log
                if run_tool_calls is not None:
                    run_tool_calls.append({"name": tc.name, "call_id": tc.id})
                yield RuntimeToolCallEvent(
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    tool_args=tc.input,
                    message_id=stored.id,
                )

            approval_store = get_approval_store()
            tool_registry = get_tool_registry()
            registry = executor.registry
            base_ctx = executor.context

            read_calls, write_calls = _split_read_write(registry, result.tool_calls)
            read_results = await _gather_read_tool_results(
                registry, base_ctx, read_calls
            )

            results_content: dict[str, str] = {}
            results_success: dict[str, bool] = {}

            for tc in read_calls:
                res = read_results[tc.id]
                content = res.data if res.success else f"Error: {res.error}"
                stored_result = await writer.add_message(
                    role="tool",
                    content=content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_result=content,
                )
                yield RuntimeToolResultEvent(
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    success=res.success,
                    result=content,
                    message_id=stored_result.id,
                )
                results_content[tc.id] = content
                results_success[tc.id] = res.success

            for tc in write_calls:
                if tool_registry.is_destructive(tc.name):
                    await approval_store.register(
                        writer.approval_scope_id,
                        tc.id,
                        tool_name=tc.name,
                        tool_args=tc.input,
                        actor_user_id=writer.approval_actor_user_id,
                        agent_id=writer.approval_agent_id,
                        channel_id=writer.approval_channel_id,
                        message_id=tool_call_message_ids.get(tc.id),
                    )
                    desc = f"The agent wants to perform a destructive action: {tc.name}"
                    yield RuntimeConfirmationRequiredEvent(
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        tool_args=tc.input,
                        description=desc,
                        message_id=tool_call_message_ids.get(tc.id),
                    )
                    approved = await approval_store.wait_for_response(
                        writer.approval_scope_id,
                        tc.id,
                        timeout=120.0,
                    )
                    if not approved:
                        rejection = "Action was rejected by the user or timed out."
                        stored_result = await writer.add_message(
                            role="tool",
                            content=rejection,
                            tool_name=tc.name,
                            tool_call_id=tc.id,
                            tool_result=rejection,
                        )
                        yield RuntimeToolResultEvent(
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                            success=False,
                            result=rejection,
                            message_id=stored_result.id,
                        )
                        results_content[tc.id] = rejection
                        results_success[tc.id] = False
                        continue

                tool_result = await executor.execute(tc)
                content = (
                    tool_result.data if tool_result.success
                    else f"Error: {tool_result.error}"
                )
                stored_result = await writer.add_message(
                    role="tool",
                    content=content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_result=content,
                )
                yield RuntimeToolResultEvent(
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    success=tool_result.success,
                    result=content,
                    message_id=stored_result.id,
                )
                results_content[tc.id] = content
                results_success[tc.id] = tool_result.success

            tool_result_blocks: list[dict] = [
                {
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "tool_name": tc.name,
                    "content": results_content[tc.id],
                }
                for tc in result.tool_calls
            ]
            llm_messages.append({
                "role": "user",
                "content": tool_result_blocks,
            })

            # Re-invoke LLM with streaming
            stream_iter = await provider.chat_completion(
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                stream=True,
                cache_key=str(agent_id),
            )

            stream_result: _StreamSegmentResult | None = None
            async for event in self._stream_segment(stream_iter, writer):
                if isinstance(event, _StreamSegmentResult):
                    stream_result = event
                else:
                    yield event  # Forward tokens (with placeholder id) + RuntimeMessageStoredEvent

            if stream_result is None or (
                stream_result.completion is None and not stream_result.error
            ):
                yield RuntimeErrorEvent(error="No response from LLM during tool loop")
                return

            if stream_result.error:
                yield RuntimeErrorEvent(error=stream_result.error)
                return

            result = stream_result.completion

            # If the LLM is done (no more tool calls), settle the placeholder
            # (or write a fresh row when no streaming was used) and yield final.
            if result.stop_reason != "tool_use" or not result.tool_calls:
                if stream_result.placeholder_id is not None:
                    assistant_message = await writer.finalize_assistant_placeholder(
                        message_id=stream_result.placeholder_id,
                        content=result.content or "",
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        cache_read_input_tokens=result.cache_read_input_tokens,
                        model=result.model,
                    )
                else:
                    assistant_message = await writer.add_message(
                        role="assistant",
                        content=result.content,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        cache_read_input_tokens=result.cache_read_input_tokens,
                        model=result.model,
                    )
                yield RuntimeDoneEvent(
                    assistant_message=assistant_message,
                    model_used=result.model,
                )
                return

            # Stream produced more tool_use after some narration. Settle the
            # placeholder so its `streaming` flag clears before the next
            # iteration's tool-call rows land underneath it.
            if stream_result.placeholder_id is not None:
                await writer.finalize_assistant_placeholder(
                    message_id=stream_result.placeholder_id,
                    content=result.content or "",
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    model=result.model,
                )

        raise ValidationError(
            "tool_loop",
            f"Agent exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS})",
        )

    async def _stream_segment(
        self,
        stream_iter: AsyncIterator[StreamEvent],
        writer: MessageWriter,
    ) -> AsyncIterator[RuntimeStreamEvent | _StreamSegmentResult]:
        """Forward provider stream and lazily reserve an assistant placeholder.

        On the first non-empty token, asks the writer for an in-flight
        assistant row (`reserve_assistant_placeholder`). If the writer
        supports it (chat destination), every subsequent
        `RuntimeTokenEvent` carries that placeholder's `message_id` plus
        a monotonic `sequence` so the chat translator can publish
        `AGENT_TOKEN_DELTA` events keyed to a real DB row. The
        placeholder envelope is also yielded as a
        `RuntimeMessageStoredEvent` so the translator can fan an
        empty-content `MESSAGE_CREATED` to clients before the deltas
        arrive.

        At the end yields a `_StreamSegmentResult` sentinel carrying the
        completion / error and the placeholder id (if one was reserved)
        so the caller can finalize.
        """
        completion: CompletionResult | None = None
        error: str | None = None
        placeholder_id: UUID | None = None
        sequence = 0

        async for event in self._forward_provider_stream(stream_iter):
            if isinstance(event, _StreamResult):
                completion = event.completion
                error = event.error
                continue

            if isinstance(event, RuntimeTokenEvent) and event.text:
                if placeholder_id is None:
                    placeholder = await writer.reserve_assistant_placeholder()
                    if placeholder is not None:
                        placeholder_id = placeholder.id
                        yield RuntimeMessageStoredEvent(message=placeholder)
                if placeholder_id is not None:
                    sequence += 1
                    yield RuntimeTokenEvent(
                        text=event.text,
                        message_id=placeholder_id,
                        sequence=sequence,
                    )
                    continue

            yield event

        yield _StreamSegmentResult(
            completion=completion,
            error=error,
            placeholder_id=placeholder_id,
        )

    async def _forward_provider_stream(
        self,
        stream_iter: AsyncIterator[StreamEvent],
    ) -> AsyncIterator[RuntimeTokenEvent | _StreamResult]:
        """Forward provider stream events in real-time.

        Yields ``RuntimeTokenEvent`` immediately as each token arrives
        from the LLM provider, giving the client true streaming output.
        At the end, yields a ``_StreamResult`` sentinel carrying the
        ``CompletionResult`` (with token counts, stop reason, tool calls)
        or an error string.

        Parameters
        ----------
        stream_iter : AsyncIterator[StreamEvent]
            The provider streaming iterator.

        Yields
        ------
        RuntimeTokenEvent
            Text token forwarded in real-time.
        _StreamResult
            Final sentinel with completion or error (always the last item).

        """
        completion: CompletionResult | None = None
        error: str | None = None

        async for event in stream_iter:
            if isinstance(event, TokenEvent):
                yield RuntimeTokenEvent(text=event.text)
            elif isinstance(event, ToolCallEvent):
                pass  # Tool calls are captured in the DoneEvent result
            elif isinstance(event, DoneEvent):
                completion = event.result
            elif isinstance(event, ErrorEvent):
                error = event.error

        yield _StreamResult(completion=completion, error=error)

    async def _fetch_memory_context(
        self,
        *,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        limit: int = 10,
    ) -> list[str]:
        """Fetch relevant memories to include in the system prompt.

        Returns the most important memories for the given agent-user pair,
        formatted as strings for inclusion in the prompt.

        Parameters
        ----------
        agent_id : UUID
            Agent ID to fetch memories for.
        user_id : UUID
            User ID to fetch memories for.
        organization_id : UUID
            Organization context.
        limit : int
            Maximum number of memories to include.

        Returns
        -------
        list[str]
            Formatted memory strings.

        """
        try:
            result = await self._session.execute(
                select(AgentMemory)
                .where(
                    AgentMemory.agent_id == agent_id,
                    AgentMemory.user_id == user_id,
                    AgentMemory.organization_id == organization_id,
                )
                .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
                .limit(limit)
            )
            memories = list(result.scalars().all())

            if not memories:
                return []

            return [f"[{m.category}] {m.key}: {m.content}" for m in memories]
        except Exception:
            logger.warning("Failed to fetch memory context", exc_info=True)
            return []

    async def _build_chat_context_for_destination(
        self,
        *,
        destination: ChatDestination,
        trigger_user_name: str,
        current_agent_name: str,
    ) -> str | None:
        """Assemble the chat-channel orientation block.

        Loads channel metadata, channel members, and resolves user/agent
        display names into two name lists that feed `build_chat_context_section`.
        Returns None on any failure; the prompt still builds without the
        block rather than hard-erroring in production.
        """
        try:
            channel = await self._session.get(ChatChannel, destination.channel_id)
            if channel is None:
                return None

            member_rows = (
                (
                    await self._session.execute(
                        select(ChatChannelMember).where(
                            ChatChannelMember.channel_id == destination.channel_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

            resolver = SenderResolver(self._session)
            refs: list[tuple[ChatSenderType, UUID]] = []
            for m in member_rows:
                if m.subject_type == SubjectType.USER:
                    refs.append((ChatSenderType.USER, m.subject_id))
                elif m.subject_type == SubjectType.AGENT:
                    refs.append((ChatSenderType.AGENT, m.subject_id))
            resolved = await resolver.resolve_many(refs) if refs else {}

            user_names: list[str] = []
            agent_names: list[str] = []
            for m in member_rows:
                info = resolved.get(m.subject_id)
                if not info:
                    continue
                if m.subject_type == SubjectType.USER:
                    user_names.append(info.display_name)
                elif m.subject_type == SubjectType.AGENT:
                    if info.id == destination.agent_id:
                        continue
                    agent_names.append(info.display_name)

            channel_type_value = (
                channel.channel_type.value
                if hasattr(channel.channel_type, "value")
                else str(channel.channel_type)
            )

            return build_chat_context_section(
                channel_type=channel_type_value,
                channel_name=channel.name or "",
                channel_description=channel.description or None,
                participant_users=user_names,
                participant_agents=agent_names,
                trigger_user_name=trigger_user_name or "the requester",
                trigger_rule=destination.trigger_rule,
                in_thread=destination.thread_root_id is not None,
            )
        except Exception:
            logger.warning(
                "Failed to build chat_context block; continuing without it",
                exc_info=True,
            )
            return None

    async def _create_run_log(
        self,
        *,
        session_id: UUID | None,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cache_read_input_tokens: int = 0,
        tool_calls: list[dict] | None,
        tool_iterations: int,
        duration_ms: int,
        status: str,
        error: str | None,
        provider_key_id: UUID | None = None,
        channel_id: UUID | None = None,
    ) -> None:
        """Create an AgentRunLog entry for observability.

        Either `session_id` (session-backed runs) or `channel_id`
        (chat-triggered runs) is set; both populate the same usage
        analytics aggregation. The chat path leaves `session_id` NULL.
        """
        cost, cost_currency = await self._compute_run_cost(
            organization_id=organization_id,
            model=model,
            provider_key_id=provider_key_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cache_read_input_tokens,
        )
        try:
            run_log = AgentRunLog(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                provider_key_id=provider_key_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_input_tokens=cache_read_input_tokens,
                tool_calls=tool_calls,
                tool_iterations=tool_iterations,
                duration_ms=duration_ms,
                status=status,
                error=error,
                cost=cost,
                cost_currency=cost_currency,
            )
            self._session.add(run_log)
            await self._session.commit()
        except Exception:
            logger.warning("Failed to create agent run log", exc_info=True)
            return

        if cost is not None:
            await check_and_fire_alerts(
                self._session,
                organization_id=organization_id,
                run_cost=cost,
                run_image_count=0,
            )

    async def _compute_run_cost(
        self,
        *,
        organization_id: UUID,
        model: str,
        provider_key_id: UUID | None,
        input_tokens: int,
        output_tokens: int,
        cache_read_input_tokens: int,
    ):
        """Look up pricing, compute cost, convert to the org's display currency.

        Returns ``(cost, cost_currency)`` on success or ``(None, None)`` when
        any step (provider lookup, pricing row, currency rate) is missing.
        Failures are logged but never raise - cost stays null and the run
        log still gets written for token analytics.
        """
        try:
            provider: str | None = None
            if provider_key_id is not None:
                provider = (
                    await self._session.execute(
                        select(ProviderKey.provider).where(ProviderKey.id == provider_key_id)
                    )
                ).scalar_one_or_none()
            if provider is None:
                logger.warning(
                    "Skipping cost calculation: provider not resolvable",
                    model=model,
                    provider_key_id=str(provider_key_id) if provider_key_id else None,
                )
                return None, None

            pricing = await get_pricing(self._session, provider=provider, model=model)
            if pricing is None:
                logger.warning(
                    "Skipping cost calculation: no pricing row",
                    provider=provider,
                    model=model,
                )
                return None, None

            raw_cost = compute_text_cost(
                pricing,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_input_tokens=cache_read_input_tokens,
            )
            display_currency = await get_display_currency(self._session, organization_id)
            converted = await convert_currency(
                raw_cost,
                pricing.currency,
                display_currency,
                self._session,
                organization_id,
            )
            return converted, display_currency
        except ValidationError as exc:
            logger.warning(f"Skipping cost calculation: {exc}")
            return None, None
        except Exception:
            logger.warning("Cost calculation failed unexpectedly", exc_info=True)
            return None, None


@dataclass
class _StreamResult:
    """Sentinel yielded at the end of a forwarded provider stream.

    After all real-time token events have been yielded, this dataclass
    carries the final CompletionResult (or error) so the caller can
    inspect the stop reason and decide whether to enter the tool loop.
    """

    completion: CompletionResult | None
    error: str | None


@dataclass
class _StreamSegmentResult:
    """Sentinel for `_stream_segment`. Adds the in-flight placeholder id.

    `placeholder_id` is set when the writer supplied a chat-row anchor
    for AGENT_TOKEN_DELTA fan-out. The caller uses it to call
    `writer.finalize_assistant_placeholder` once the stop reason is
    known.
    """

    completion: CompletionResult | None
    error: str | None
    placeholder_id: UUID | None
