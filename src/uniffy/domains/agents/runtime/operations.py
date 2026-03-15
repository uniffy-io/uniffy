"""Core orchestration for agent runtime - send message flow."""

from __future__ import annotations

import base64
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.valkey.rate_limit import check_agent_rate_limits
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.content_policy import check_user_message
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
from uniffy.domains.agents.runtime.model_resolver import resolve_model
from uniffy.domains.agents.runtime.prompt import build_system_prompt
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
from uniffy.domains.agents.sessions.operations import FALLBACK_CONTEXT_WINDOW, SessionOperations
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import get_tool_registry, to_api_name
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.operations import UserOperations

MAX_TOOL_ITERATIONS = 10


@dataclass
class FileContext:
    """Context for a file loaded from the database for LLM processing.

    Attributes
    ----------
    file_id : str
        UUID of the file.
    media_type : str
        MIME type of the file.
    filename : str
        Display filename.
    storage_key : str
        S3 storage key for downloading.
    extracted_text : str | None
        Pre-extracted text content (from worker pipeline).
    extraction_status : str
        Current extraction status.

    """

    file_id: str
    media_type: str
    filename: str
    storage_key: str
    extracted_text: str | None
    extraction_status: str


def _file_context_to_content_block(f: FileContext) -> dict:
    """Convert a FileContext to a canonical content block for LLM messages.

    Returns a provider-agnostic block that provider converters
    transform into their native format.

    - Images: ``{"type": "image", "media_type": ..., "storage_key": ...}``
    - PDFs: ``{"type": "document", "media_type": ..., "storage_key": ..., "filename": ...}``
    - Extractable text: ``{"type": "text", "text": "--- File: ... ---\\n..."}``
    - Unsupported: ``{"type": "text", "text": "[Attached file: ...]"}``

    Parameters
    ----------
    f : FileContext
        The file context to convert.

    Returns
    -------
    dict
        A canonical content block.

    """
    media_type = f.media_type

    if media_type.startswith("image/"):
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

    # Use extracted text if available, or indicate extraction pending
    if f.extracted_text:
        return {
            "type": "text",
            "text": (f"--- File: {f.filename} ---\n{f.extracted_text}\n--- End of {f.filename} ---"),
        }

    # Check if we can extract on-demand
    from uniffy.core.extraction import can_extract

    if can_extract(media_type):
        # Mark for on-demand extraction (handlers will download from S3)
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


def _file_urn(file_id: str) -> str:
    """Build a URN for a file ID."""
    return f"urn:uniffy:content:FILE:{file_id}"


def _file_mention(f: FileContext) -> str:
    """Build a mention chip string for a file."""
    return f"[[[{f.filename}|{_file_urn(f.file_id)}]]]"


def _build_stored_content(
    content: str,
    files: list[FileContext] | None,
) -> str:
    """Build the stored message content, enriching it with file text.

    Each attached file is referenced using the ``[[[label|urn]]]``
    mention syntax so the UI renders interactive file chips. For files
    with extracted text, the text is also embedded so the LLM retains
    context on subsequent turns.

    Parameters
    ----------
    content : str
        The user's original message text.
    files : list[FileContext] | None
        Attached files, if any.

    Returns
    -------
    str
        Enriched content with file mentions and extracted text.

    """
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

    Modifies the messages list in place. Handles:
    - ``type: "image"`` with ``storage_key``: downloads from S3, base64 encodes
    - ``type: "document"`` with ``storage_key``: downloads from S3, base64 encodes
    - ``type: "text_pending_extraction"``: downloads from S3, extracts text

    Parameters
    ----------
    messages : list[dict]
        LLM messages array. Modified in place.

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
    """Look up the context window size (in tokens) for a model.

    Parameters
    ----------
    provider : LLMProvider
        The active LLM provider.
    model : str
        The resolved model identifier.

    Returns
    -------
    int
        Context window size in tokens, or FALLBACK_CONTEXT_WINDOW if
        the model is not found in the catalog.

    """
    try:
        available = await provider.get_available_models()
        for m in available:
            if m.id == model:
                return m.context_window
    except Exception:
        pass
    return FALLBACK_CONTEXT_WINDOW


class RuntimeOperations:
    """Operations for agent runtime message execution.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

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
        """Execute the full send-message flow with tool use loop.

        1. Verify org membership
        2. Get session and agent config
        3. Build system prompt (with tool descriptions)
        4. Get conversation context
        5. Resolve model
        6. Store user message
        7. Call LLM (with tool schemas if agent has tools)
        8. Loop: if LLM requests tools, execute them, store messages, re-invoke
        9. Store final assistant message
        10. Return both messages and the model used

        Parameters
        ----------
        user_id : UUID
            The user sending the message.
        organization_id : UUID
            Organization context.
        session_id : UUID
            Session to send message in.
        content : str
            The user's message content.

        Returns
        -------
        tuple[AgentMessage, AgentMessage, str]
            (user_message, assistant_message, model_used).

        Raises
        ------
        NotFoundError
            If session, agent, or provider key not found.
        PermissionDeniedError
            If user cannot access the session.
        ValidationError
            If no model can be resolved or tool loop exceeds max iterations.

        """
        # 1. Verify org membership
        membership = await self._org_ops.require_org_member(user_id, organization_id)

        # 1b. Check rate limits
        await check_agent_rate_limits(
            user_id=str(user_id),
            organization_id=str(organization_id),
        )

        # 2. Get session
        agent_session = await self._session_ops.get_session(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )

        # 3. Get agent config
        agent = await self._agent_ops.get_by_id(
            user_id,
            organization_id,
            agent_session.agent_id,
        )

        # 4. Get org name and user info for prompt context
        org = await self._org_ops.get_by_id(organization_id)
        user = await self._user_ops.get_by_id(user_id)
        role = membership.role
        user_role = role.value if hasattr(role, "value") else str(role)

        # 5. Determine target model and get the correct provider
        target_model = agent_session.model_override or agent.primary_model
        provider_key_id: UUID | None = None

        if agent.primary_provider_key_id:
            provider, pk = await self._provider_ops.get_provider_for_key(
                organization_id=organization_id,
                key_id=agent.primary_provider_key_id,
            )
            provider_key_id = pk.id
        else:
            provider = await self._provider_ops.get_provider_for_model(
                organization_id=organization_id,
                model_id=target_model,
            )

        # 6. Resolve tool registry and schemas
        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()
        tool_schemas = registry.get_anthropic_schemas(enabled_tools) or None

        # 6b. Fetch skill contents for the agent
        skills = await self._skill_ops.get_skills_for_agent(
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )
        skill_contents = [s.content for s in skills if s.content]

        # 6c. Fetch relevant memories for context
        memory_context = await self._fetch_memory_context(
            agent_id=agent_session.agent_id,
            user_id=user_id,
            organization_id=organization_id,
        )

        # 6d. Resolve prompt template if set on agent
        prompt_content = await self._resolve_prompt_content(agent.prompt_id)

        # 7. Build system prompt (includes tool descriptions when tools enabled)
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

        # 8c. Compact session if estimated token usage exceeds budget
        await self._session_ops.compact_session_if_needed(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            provider=provider,
            model=model,
            context_window_tokens=context_window_tokens,
        )

        # 9. Get session context (existing messages, after compaction)
        context_messages, _ = await self._session_ops.get_session_context(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            token_budget=token_budget,
        )

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
        llm_messages = self._build_llm_messages(context_messages, content, files=files)

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
                    model=result.model,
                )
                # Track tool calls for run log
                if run_tool_calls is not None:
                    run_tool_calls.append({"name": tc.name, "call_id": tc.id})

            # Execute each tool call and collect results
            tool_result_blocks: list[dict] = []
            for tc in result.tool_calls:
                tool_result = await executor.execute(tc)

                # Build content string for the tool result
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

                # Store tool result message in the database
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
        new_content: str,
        *,
        files: list[FileContext] | None = None,
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

        # Append the new user message (with optional file attachments)
        if files:
            content_blocks: list[dict] = []
            for f in files:
                block = _file_context_to_content_block(f)
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

    async def stream_send_message(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        content: str,
        files: list[FileContext] | None = None,
        user_timezone: str | None = None,
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
        session_id : UUID
            Session to send message in.
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
        # 1-10: Same setup as send_message
        membership = await self._org_ops.require_org_member(user_id, organization_id)

        # 1b. Check rate limits
        await check_agent_rate_limits(
            user_id=str(user_id),
            organization_id=str(organization_id),
        )

        agent_session = await self._session_ops.get_session(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )

        agent = await self._agent_ops.get_by_id(
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
            provider = await self._provider_ops.get_provider_for_model(
                organization_id=organization_id,
                model_id=target_model,
            )

        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()
        tool_schemas = registry.get_anthropic_schemas(enabled_tools) or None

        skills = await self._skill_ops.get_skills_for_agent(
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )
        skill_contents = [s.content for s in skills if s.content]

        memory_context = await self._fetch_memory_context(
            agent_id=agent_session.agent_id,
            user_id=user_id,
            organization_id=organization_id,
        )

        prompt_content = await self._resolve_prompt_content(agent.prompt_id)

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

        model = await resolve_model(
            session_model_override=agent_session.model_override,
            agent_primary_model=agent.primary_model,
            agent_fallback_models=agent.fallback_models or [],
            provider=provider,
        )

        # Look up model context window for token-based compaction
        context_window_tokens = await _get_model_context_window(provider, model)
        token_budget = int(context_window_tokens * 0.65)

        # Compact session if estimated token usage exceeds budget
        await self._session_ops.compact_session_if_needed(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            provider=provider,
            model=model,
            context_window_tokens=context_window_tokens,
        )

        context_messages, _ = await self._session_ops.get_session_context(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            token_budget=token_budget,
        )

        # 10b. Content policy check (warn-only, never blocks)
        injection_flags = check_user_message(content)
        if injection_flags:
            logger.warning(
                "Prompt injection flags in stream_send_message",
                flags=injection_flags,
                user_id=str(user_id),
                session_id=str(session_id),
            )

        llm_messages = self._build_llm_messages(context_messages, content, files=files)

        # Resolve any content blocks that need S3 downloads
        await _resolve_pending_content_blocks(llm_messages)

        # 11. Store user message with enriched content (file text baked in
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
        yield RuntimeMessageStoredEvent(message=user_message)

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
        )

        # Forward tokens in real-time as they arrive from the provider
        stream_result: _StreamResult | None = None
        async for event in self._forward_provider_stream(stream_iter):
            if isinstance(event, _StreamResult):
                stream_result = event
            else:
                yield event  # RuntimeTokenEvent forwarded immediately

        if stream_result is None or (stream_result.completion is None and not stream_result.error):
            await self._create_run_log(
                session_id=session_id,
                agent_id=agent_session.agent_id,
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
                agent_id=agent_session.agent_id,
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
            tool_ctx = ToolContext(
                session=self._session,
                user_id=user_id,
                organization_id=organization_id,
                agent_id=agent_session.agent_id,
                session_id=session_id,
                user_timezone=user_timezone,
            )
            executor = ToolExecutor(registry, tool_ctx)

            async for event in self._stream_tool_loop(
                user_id=user_id,
                organization_id=organization_id,
                session_id=session_id,
                provider=provider,
                model=model,
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
                        agent_id=agent_session.agent_id,
                        user_id=user_id,
                        organization_id=organization_id,
                        model=event.model_used,
                        input_tokens=msg.input_tokens if msg else 0,
                        output_tokens=msg.output_tokens if msg else 0,
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

        # 14. Store final assistant message (no tool use)
        assistant_message = await self._session_ops.add_message(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            role="assistant",
            content=completion.content,
            input_tokens=completion.input_tokens,
            output_tokens=completion.output_tokens,
            model=completion.model,
        )

        # 15. Create run log for non-tool-use path
        await self._create_run_log(
            session_id=session_id,
            agent_id=agent_session.agent_id,
            user_id=user_id,
            organization_id=organization_id,
            model=completion.model,
            input_tokens=completion.input_tokens,
            output_tokens=completion.output_tokens,
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
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID,
        provider,
        model: str,
        system_prompt: str,
        tool_schemas: list[dict],
        llm_messages: list[dict],
        result: CompletionResult,
        executor: ToolExecutor,
        run_tool_calls: list[dict] | None = None,
    ) -> AsyncIterator[RuntimeStreamEvent]:
        """Run the streaming tool-use loop until the LLM produces a final response.

        Same logic as _run_tool_loop but yields streaming events and uses
        streaming LLM calls for each re-invocation.

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
                    model=result.model,
                )
                # Track tool calls for run log
                if run_tool_calls is not None:
                    run_tool_calls.append({"name": tc.name, "call_id": tc.id})
                yield RuntimeToolCallEvent(
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    tool_args=tc.input,
                )

            # Execute each tool call, yield results, and collect for LLM
            tool_result_blocks: list[dict] = []
            approval_store = get_approval_store()
            tool_registry = get_tool_registry()

            for tc in result.tool_calls:
                # Check if this tool is destructive and needs confirmation
                if tool_registry.is_destructive(tc.name):
                    # Register pending approval and yield confirmation event
                    approval_store.register(session_id, tc.id)
                    desc = f"The agent wants to perform a destructive action: {tc.name}"
                    yield RuntimeConfirmationRequiredEvent(
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        tool_args=tc.input,
                        description=desc,
                    )

                    # Wait for user response (timeout: 120s)
                    approved = await approval_store.wait_for_response(
                        session_id,
                        tc.id,
                        timeout=120.0,
                    )

                    if not approved:
                        result_content = "Action was rejected by the user or timed out."
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
                        yield RuntimeToolResultEvent(
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                            success=False,
                            result=result_content,
                        )
                        continue

                tool_result = await executor.execute(tc)

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

                # Store tool result message
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

                yield RuntimeToolResultEvent(
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    success=tool_result.success,
                    result=result_content,
                )

            # Append tool results as a user message (Anthropic API format)
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
            )

            stream_result: _StreamResult | None = None
            async for event in self._forward_provider_stream(stream_iter):
                if isinstance(event, _StreamResult):
                    stream_result = event
                else:
                    yield event  # Forward tokens in real-time

            if stream_result is None or (
                stream_result.completion is None and not stream_result.error
            ):
                yield RuntimeErrorEvent(error="No response from LLM during tool loop")
                return

            if stream_result.error:
                yield RuntimeErrorEvent(error=stream_result.error)
                return

            result = stream_result.completion

            # If the LLM is done (no more tool calls), store and yield final
            if result.stop_reason != "tool_use" or not result.tool_calls:
                assistant_message = await self._session_ops.add_message(
                    user_id=user_id,
                    organization_id=organization_id,
                    session_id=session_id,
                    role="assistant",
                    content=result.content,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    model=result.model,
                )
                yield RuntimeDoneEvent(
                    assistant_message=assistant_message,
                    model_used=result.model,
                )
                return

        raise ValidationError(
            "tool_loop",
            f"Agent exceeded maximum tool iterations ({MAX_TOOL_ITERATIONS})",
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

    async def _resolve_prompt_content(
        self,
        prompt_id: UUID | None,
    ) -> str | None:
        """Resolve prompt template content for an agent.

        Parameters
        ----------
        prompt_id : UUID | None
            The prompt template ID from the agent config.

        Returns
        -------
        str | None
            Prompt content if a template is set, None otherwise.

        """
        if not prompt_id:
            return None
        try:
            from uniffy.domains.agents.prompts.operations import PromptOperations

            prompt_ops = PromptOperations(self._session)
            prompt = await prompt_ops.get_prompt_by_id(prompt_id)
            if prompt and prompt.content:
                return prompt.content
        except Exception:
            logger.warning("Failed to resolve prompt template", exc_info=True)
        return None

    async def _create_run_log(
        self,
        *,
        session_id: UUID,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        model: str,
        input_tokens: int,
        output_tokens: int,
        tool_calls: list[dict] | None,
        tool_iterations: int,
        duration_ms: int,
        status: str,
        error: str | None,
        provider_key_id: UUID | None = None,
    ) -> None:
        """Create an AgentRunLog entry for observability.

        Parameters
        ----------
        session_id : UUID
            Session this run belongs to.
        agent_id : UUID
            Agent that processed this run.
        user_id : UUID
            User who initiated the run.
        organization_id : UUID
            Organization context.
        model : str
            Model identifier used.
        input_tokens : int
            Total input tokens consumed.
        output_tokens : int
            Total output tokens produced.
        tool_calls : list[dict] | None
            List of tool calls made.
        tool_iterations : int
            Number of tool loop iterations.
        duration_ms : int
            Total duration in milliseconds.
        status : str
            Run outcome: "success", "error", or "timeout".
        error : str | None
            Error message if status is "error".
        provider_key_id : UUID | None
            Provider key used for this run.

        """
        try:
            run_log = AgentRunLog(
                session_id=session_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                provider_key_id=provider_key_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                tool_calls=tool_calls,
                tool_iterations=tool_iterations,
                duration_ms=duration_ms,
                status=status,
                error=error,
            )
            self._session.add(run_log)
            await self._session.commit()
        except Exception:
            logger.warning("Failed to create agent run log", exc_info=True)


@dataclass
class _StreamResult:
    """Sentinel yielded at the end of a forwarded provider stream.

    After all real-time token events have been yielded, this dataclass
    carries the final CompletionResult (or error) so the caller can
    inspect the stop reason and decide whether to enter the tool loop.
    """

    completion: CompletionResult | None
    error: str | None
