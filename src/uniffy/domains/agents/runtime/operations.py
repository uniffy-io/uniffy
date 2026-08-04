"""Core orchestration for agent runtime - send message flow."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, replace
from dataclasses import field as dataclass_field
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.channel_binding import AgentChannelBinding
from uniffy.core.models.agents.memory import MemoryScope
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.models.agents.run_log import AgentRunLog
from uniffy.core.models.chat.channel import ChannelType, ChatChannel
from uniffy.core.models.chat.channel_member import ChatChannelMember
from uniffy.core.models.chat.message import SenderType as ChatSenderType
from uniffy.core.types import SubjectType
from uniffy.db.session import open_session
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.budget_alerts import check_and_fire_alerts
from uniffy.domains.agents.cache import (
    fetch_agent_skills,
    fetch_memory_index,
)
from uniffy.domains.agents.content_policy import check_user_message
from uniffy.domains.agents.currency import convert as convert_currency
from uniffy.domains.agents.currency import get_display_currency
from uniffy.domains.agents.memories.bridge import is_personal_bridge_enabled
from uniffy.domains.agents.memories.recall import (
    attach_recall_block,
    build_memory_recall,
    build_recall_query,
    render_recall_block,
)
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.pricing import PRICING_CURRENCY
from uniffy.domains.agents.providers.base import (
    CompletionResult,
    EventType,
    StreamEvent,
)
from uniffy.domains.agents.providers.catalog import resolve_request_params
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.runtime.approvals import get_approval_store
from uniffy.domains.agents.runtime.destinations import (
    ChatDestination,
    RuntimeDestination,
    SessionDestination,
)
from uniffy.domains.agents.runtime.file_loader import FileContext
from uniffy.domains.agents.runtime.image_config import (
    apply_image_tool_schema,
    resolve_image_config,
)
from uniffy.domains.agents.runtime.model_calls import (
    CircuitOpenError,
    FailoverTransition,
    ModelCallController,
    ModelCallTarget,
)
from uniffy.domains.agents.runtime.model_resolver import resolve_provider_and_model
from uniffy.domains.agents.runtime.prompt import (
    SKILL_VIEW_TOOL,
    MemoryScopeBlock,
    SkillPromptEntry,
    build_chat_context_section,
    build_memory_block,
    build_system_prompt,
    skill_passes_activation,
    to_skill_prompt_entry,
)
from uniffy.domains.agents.runtime.run_usage import RunUsageAccumulator
from uniffy.domains.agents.runtime.settings import get_runtime_settings
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
from uniffy.domains.agents.skills.usage import record_skill_event, record_skill_injections
from uniffy.domains.agents.tools.deferral import (
    LOAD_GROUP_TOOL,
    LOADED_GROUPS_METADATA_KEY,
    plan_tool_advertisement,
)
from uniffy.domains.agents.tools.definitions import ToolContext, ToolResult
from uniffy.domains.agents.tools.executor import ToolExecutor
from uniffy.domains.agents.tools.registry import (
    ToolRegistry,
    from_api_name,
    get_tool_registry,
    to_api_name,
)
from uniffy.domains.chat.sender_resolver import SenderResolver
from uniffy.domains.integrations.tool_gate import (
    filter_integration_tool_schemas,
    has_advertised_integration_tools,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.operations import UserOperations

logger = logger.bind(component="agents.runtime.operations")

MAX_TOOL_ITERATIONS = 10
# Turns whose only calls are tools.load_group don't consume the work budget;
# loads are idempotent per group, so this cap only guards a model stuck in a
# load-call loop.
MAX_LOAD_ONLY_ITERATIONS = 3
READ_TOOL_POOL_SIZE = 5


async def _recorded_completion(
    *,
    provider,
    provider_key_id: UUID | None,
    model: str,
    usage: RunUsageAccumulator,
    messages: list[dict],
    system: str | None,
    tools: list[dict] | None,
    cache_key: str,
    params: dict | None,
    controller: ModelCallController | None = None,
    safety_identifier: str | None = None,
) -> CompletionResult:
    if controller is not None:
        return await controller.complete(
            messages=messages,
            system=system,
            tools=tools,
            cache_key=cache_key,
            safety_identifier=safety_identifier,
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
    usage.record_result(
        provider=provider_name,
        provider_key_id=provider_key_id,
        result=result,
    )
    return result


def _safety_identifier(*, organization_id: UUID, user_id: UUID) -> str:
    value = f"uniffy:{organization_id}:{user_id}".encode()
    return hashlib.sha256(value).hexdigest()


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


def _resolve_tool_schemas(
    registry: ToolRegistry,
    enabled_tools: list[str],
    skill_entries: list[SkillPromptEntry],
    invoked_skill: SkillPromptEntry | None,
) -> list[dict] | None:
    """Build the LLM tool schemas, auto-appending view_skill when skills are advertised.

    view_skill is framework plumbing, not a user-selectable capability: it is
    absent from ``enabled_tools`` and the agent-builder catalog on purpose. The
    progressive-disclosure index instructs the model to load an advertised skill
    by calling view_skill, so the tool MUST reach the schema whenever any
    advertised (non-always-active, non-invoked) skill is present, or that
    instruction points at a tool the model does not have.
    """
    schemas = registry.get_anthropic_schemas(enabled_tools)
    invoked_id = invoked_skill.id if invoked_skill else None
    advertises = any(not entry.always_active and entry.id != invoked_id for entry in skill_entries)
    if advertises and SKILL_VIEW_TOOL not in enabled_tools:
        schemas.extend(registry.get_anthropic_schemas([SKILL_VIEW_TOOL]))
    return schemas or None


def _allowed_tool_names(tool_schemas: list[dict] | None) -> frozenset[str]:
    """Internal names of every tool this run may execute.

    Taken from the fully-resolved schema set (image swap + integration gate
    applied) rather than ``agent.enabled_tools``, so a tool whose integration
    connection is gone is not executable either. Deferral splits this set; it
    never widens it.
    """
    return frozenset(from_api_name(schema.get("name", "")) for schema in tool_schemas or [])


def _is_load_only_turn(tool_calls: list) -> bool:
    """True when every call in the turn is tools.load_group."""
    return bool(tool_calls) and all(from_api_name(tc.name) == LOAD_GROUP_TOOL for tc in tool_calls)


def _expand_loaded_schemas(
    tool_schemas: list[dict],
    deferred_pool: dict[str, list[dict]] | None,
    tool_results: dict[str, ToolResult],
) -> None:
    """Append schemas for groups a load_group call advertised this turn.

    Append-only, in load order: the advertised prefix stays byte-stable so the
    provider prompt cache is invalidated once per load, not per turn.
    """
    if not deferred_pool:
        return
    for res in tool_results.values():
        for group in (res.metadata or {}).get(LOADED_GROUPS_METADATA_KEY, []):
            tool_schemas.extend(deferred_pool.pop(group, []))


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
    tasks = [_execute_read_tool_isolated(registry, base_ctx, tc, semaphore) for tc in read_calls]
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
        invoked_skill_id: UUID | None = None,
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

        provider, provider_key_id, model = await resolve_provider_and_model(
            self._session,
            self._provider_ops,
            organization_id=organization_id,
            agent=agent,
            model_override=agent_session.model_override,
        )

        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()

        skills = await fetch_agent_skills(
            self._skill_ops,
            agent_id=agent.id,
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )
        active_skills = [
            s
            for s in skills
            if skill_passes_activation(s, enabled_tools=enabled_tools, surface="session")
        ]
        skill_entries = [to_skill_prompt_entry(s) for s in active_skills]
        await record_skill_injections(
            self._session,
            skills=active_skills,
            agent_id=agent.id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )
        invoked_entry = await self._resolve_invoked_skill(
            skills=skills,
            invoked_skill_id=invoked_skill_id,
            agent_id=agent.id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )
        tool_schemas = _resolve_tool_schemas(registry, enabled_tools, skill_entries, invoked_entry)
        image_config = await resolve_image_config(
            self._session, agent, organization_id=organization_id
        )
        tool_schemas = apply_image_tool_schema(tool_schemas, image_config)
        tool_schemas = await filter_integration_tool_schemas(
            self._session, organization_id, tool_schemas
        )
        # The external-content note keys off the full enabled set: a deferred
        # integration group can surface mid-run via tools.load_group.
        external_note = has_advertised_integration_tools(tool_schemas)
        allowed_tools = _allowed_tool_names(tool_schemas)
        loaded_tool_groups = list(agent_session.loaded_tool_groups or [])
        plan = plan_tool_advertisement(registry, tool_schemas, loaded_tool_groups)
        tool_schemas = plan.tool_schemas or None
        deferred_pool = dict(plan.deferred)

        memory_scope = await self._resolve_memory_scope(
            destination=SessionDestination(session_id=session_id),
            user_id=user_id,
            organization_id=organization_id,
            session_kind=agent_session.kind,
        )
        memory_bridge = await self._resolve_memory_bridge(
            scope_ref=memory_scope,
            user_id=user_id,
            organization_id=organization_id,
        )
        memory_context = await self._build_memory_context(
            agent_id=agent_session.agent_id,
            organization_id=organization_id,
            scope_ref=memory_scope,
            bridge_ref=memory_bridge,
        )

        system_prompt = build_system_prompt(
            agent_name=agent.name,
            soul_prompt=agent.soul_prompt,
            org_name=org.name,
            user_name=user.full_name or user.username,
            user_role=user_role,
            deferred_tools=plan.deferred_names() or None,
            skills=skill_entries or None,
            invoked_skill=invoked_entry,
            memory_context=memory_context,
            user_timezone=user_timezone,
            external_content_note=external_note,
        )

        request_params = resolve_request_params(
            agent.model_params,
            None,
            provider.name,
            model,
        )

        # 8b. Look up model context window for token-based compaction
        context_window_tokens = await _get_model_context_window(provider, model)
        token_budget = int(context_window_tokens * 0.65)

        # 8c. Schedule async compaction when over budget (no LLM call here).
        await self._session_ops.enqueue_compaction_if_needed(
            session_id=session_id,
            token_budget=token_budget,
        )

        # 8d. Queue a debounced skill-evolution analysis (worker gates on the
        # per-org opt-in and budget before doing any LLM work).
        await self._session_ops.enqueue_skill_analysis(
            destination_kind="session",
            destination_id=session_id,
            user_id=user_id,
            agent_id=agent.id,
            organization_id=organization_id,
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

        # 11c. Ephemeral query-conditioned recall on the trigger turn: rides
        # only llm_messages, never the stored row, so no turn re-quotes it.
        recall_block = await self._build_memory_recall_block(
            agent_id=agent_session.agent_id,
            organization_id=organization_id,
            scope_ref=memory_scope,
            context_messages=context_messages,
            content=content,
        )
        recall_promoted = bool(recall_block and attach_recall_block(llm_messages, recall_block))

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
            invoked_skill_name=invoked_entry.display_name if invoked_entry else None,
        )

        # 13. Call LLM (with tools if configured) and track timing
        start_time = time.monotonic()
        run_tool_calls: list[dict] = []
        run_usage = RunUsageAccumulator()
        runtime_settings = await get_runtime_settings(self._session, organization_id)
        call_controller = ModelCallController(
            provider_ops=self._provider_ops,
            organization_id=organization_id,
            target=ModelCallTarget(
                provider=provider,
                provider_key_id=provider_key_id,
                model=model,
            ),
            fallback_models=list(agent.fallback_models or []),
            settings=runtime_settings,
            usage=run_usage,
            params_for_target=lambda provider_name, target_model: (
                request_params
                if provider_name == provider.name and target_model == model
                else resolve_request_params(
                    agent.model_params,
                    None,
                    provider_name,
                    target_model,
                )
            ),
        )
        safety_identifier = _safety_identifier(
            organization_id=organization_id,
            user_id=user_id,
        )
        tool_iterations = 0
        run_status = "success"
        run_error: str | None = None

        try:
            result = await _recorded_completion(
                provider=provider,
                provider_key_id=provider_key_id,
                usage=run_usage,
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_session.agent_id),
                params=request_params,
                controller=call_controller,
                safety_identifier=safety_identifier,
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
                    memory_scope=memory_scope,
                    memory_bridge_scope=memory_bridge,
                    memory_recall_promoted=recall_promoted,
                    is_test_session=agent_session.is_test,
                    image_params=image_config.params if image_config else {},
                    image_max_resolution=(image_config.max_resolution if image_config else None),
                    image_max_quality=image_config.max_quality if image_config else None,
                    integration_connections=agent.integration_connections or {},
                    deferred_tool_groups=plan.deferred_names(),
                    loaded_tool_groups=loaded_tool_groups,
                    allowed_tools=allowed_tools,
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
                    run_usage=run_usage,
                    provider_key_id=provider_key_id,
                    call_controller=call_controller,
                    safety_identifier=safety_identifier,
                    model_params=request_params,
                    deferred_pool=deferred_pool,
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
                usage=run_usage,
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
            cache_creation_input_tokens=result.cache_creation_input_tokens,
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
            usage=run_usage,
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
        run_usage: RunUsageAccumulator | None = None,
        provider_key_id: UUID | None = None,
        call_controller: ModelCallController | None = None,
        safety_identifier: str | None = None,
        model_params: dict | None = None,
        deferred_pool: dict[str, list[dict]] | None = None,
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
        run_usage = run_usage or RunUsageAccumulator()
        work_iterations = 0
        load_iterations = 0
        while True:
            if _is_load_only_turn(result.tool_calls):
                load_iterations += 1
            else:
                work_iterations += 1
            if work_iterations > MAX_TOOL_ITERATIONS or (load_iterations > MAX_LOAD_ONLY_ITERATIONS):
                break
            logger.debug(
                "Tool loop iteration",
                iteration=work_iterations,
                tool_calls=len(result.tool_calls),
            )

            # Build assistant message content blocks. Provider thinking
            # blocks (signature included) MUST lead the turn when
            # continuing with tool results or the API rejects it; they
            # live only in this in-memory continuation, never in rows.
            assistant_content: list[dict] = [*result.thinking_blocks]
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
                    cache_creation_input_tokens=(result.cache_creation_input_tokens),
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

            _expand_loaded_schemas(tool_schemas, deferred_pool, tool_results)

            # Re-invoke LLM with updated conversation
            result = await _recorded_completion(
                provider=provider,
                provider_key_id=provider_key_id,
                usage=run_usage,
                messages=llm_messages,
                model=model,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_id),
                params=model_params,
                controller=call_controller,
                safety_identifier=safety_identifier,
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
    ) -> AsyncIterator[StreamEvent]:
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
        invoked_skill_id: UUID | None = None,
        rerun_anchor: AgentMessage | None = None,
    ) -> AsyncIterator[StreamEvent]:
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
        StreamEvent
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
        params_override: dict | None = None
        image_params_override: dict | None = None

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
            loaded_tool_groups = list(agent_session.loaded_tool_groups or [])
        else:
            agent_id = destination.agent_id
            loaded_tool_groups = []
            binding = (
                await self._session.execute(
                    select(AgentChannelBinding).where(
                        AgentChannelBinding.channel_id == destination.channel_id,
                        AgentChannelBinding.agent_id == destination.agent_id,
                    )
                )
            ).scalar_one_or_none()
            if binding is not None:
                model_override = binding.model_override
                params_override = binding.model_params_override
                image_params_override = binding.image_params_override
                loaded_tool_groups = list(binding.loaded_tool_groups or [])

        agent = await self._agent_ops.get_for_runtime(
            user_id,
            organization_id,
            agent_id,
        )

        org = await self._org_ops.get_by_id(organization_id)
        user = await self._user_ops.get_by_id(user_id)
        role = membership.role
        user_role = role.value if hasattr(role, "value") else str(role)

        provider, provider_key_id, model = await resolve_provider_and_model(
            self._session,
            self._provider_ops,
            organization_id=organization_id,
            agent=agent,
            model_override=model_override,
        )

        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()

        skills = await fetch_agent_skills(
            self._skill_ops,
            agent_id=agent.id,
            organization_id=organization_id,
            enabled_skill_ids=agent.enabled_skills or [],
        )
        skill_surface = "chat" if isinstance(destination, ChatDestination) else "session"
        active_skills = [
            s
            for s in skills
            if skill_passes_activation(s, enabled_tools=enabled_tools, surface=skill_surface)
        ]
        skill_entries = [to_skill_prompt_entry(s) for s in active_skills]
        await record_skill_injections(
            self._session,
            skills=active_skills,
            agent_id=agent.id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )
        invoked_entry = await self._resolve_invoked_skill(
            skills=skills,
            invoked_skill_id=invoked_skill_id,
            agent_id=agent.id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )
        tool_schemas = _resolve_tool_schemas(registry, enabled_tools, skill_entries, invoked_entry)
        image_config = await resolve_image_config(
            self._session,
            agent,
            organization_id=organization_id,
            override_params=image_params_override,
        )
        tool_schemas = apply_image_tool_schema(tool_schemas, image_config)
        tool_schemas = await filter_integration_tool_schemas(
            self._session, organization_id, tool_schemas
        )
        # The external-content note keys off the full enabled set: a deferred
        # integration group can surface mid-run via tools.load_group.
        external_note = has_advertised_integration_tools(tool_schemas)
        allowed_tools = _allowed_tool_names(tool_schemas)
        plan = plan_tool_advertisement(registry, tool_schemas, loaded_tool_groups)
        tool_schemas = plan.tool_schemas or None
        deferred_pool = dict(plan.deferred)

        memory_scope = await self._resolve_memory_scope(
            destination=destination,
            user_id=user_id,
            organization_id=organization_id,
            session_kind=agent_session.kind if agent_session else None,
        )
        memory_bridge = await self._resolve_memory_bridge(
            scope_ref=memory_scope,
            user_id=user_id,
            organization_id=organization_id,
        )
        memory_context = await self._build_memory_context(
            agent_id=agent_id,
            organization_id=organization_id,
            scope_ref=memory_scope,
            bridge_ref=memory_bridge,
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
            deferred_tools=plan.deferred_names() or None,
            skills=skill_entries or None,
            invoked_skill=invoked_entry,
            memory_context=memory_context,
            user_timezone=user_timezone,
            chat_context=chat_context_block,
            external_content_note=external_note,
        )

        request_params = resolve_request_params(
            agent.model_params,
            params_override,
            provider.name,
            model,
        )

        # Look up model context window for token-based compaction
        context_window_tokens = await _get_model_context_window(provider, model)
        token_budget = int(context_window_tokens * 0.65)

        # Schedule async compaction when over budget (no LLM call here).
        await writer.compact_if_needed(token_budget=token_budget)

        # Queue a debounced skill-evolution analysis. Covers both the agent
        # ChatView (session) and team-chat (channel) since both stream here;
        # the worker gates on the per-org opt-in and budget before any LLM call.
        if session_id is not None:
            await self._session_ops.enqueue_skill_analysis(
                destination_kind="session",
                destination_id=session_id,
                user_id=user_id,
                agent_id=agent.id,
                organization_id=organization_id,
            )
        elif channel_id is not None:
            await self._session_ops.enqueue_skill_analysis(
                destination_kind="channel",
                destination_id=channel_id,
                user_id=user_id,
                agent_id=agent.id,
                organization_id=organization_id,
            )

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

        # Ephemeral query-conditioned recall on the trigger turn: rides only
        # llm_messages, never a stored row and never the client stream. On the
        # rerun path the anchor is the newest user turn in context, so the
        # block lands on it via the same attach.
        recall_block = await self._build_memory_recall_block(
            agent_id=agent_id,
            organization_id=organization_id,
            scope_ref=memory_scope,
            context_messages=context_messages,
            content=content,
        )
        recall_promoted = bool(recall_block and attach_recall_block(llm_messages, recall_block))

        if rerun_anchor is None:
            # 11. Store user message with enriched content (file text baked in
            # so the LLM retains file context on subsequent turns).
            stored_content = _build_stored_content(content, files)
            user_message = await writer.add_message(
                role="user",
                content=stored_content,
                file_ids=[f.file_id for f in files] if files else None,
                invoked_skill_name=invoked_entry.display_name if invoked_entry else None,
            )
            yield StreamEvent(type=EventType.MESSAGE_STORED, message=user_message)
        else:
            # Re-run path: the anchor already lives in DB; emit it so the
            # client can reconcile the optimistic edit state.
            yield StreamEvent(type=EventType.MESSAGE_STORED, message=rerun_anchor)

        yield StreamEvent(type=EventType.REPLY_START)

        # 12. Call LLM with streaming and track timing
        start_time = time.monotonic()
        run_tool_calls: list[dict] = []
        run_usage = RunUsageAccumulator()
        runtime_settings = await get_runtime_settings(self._session, organization_id)
        call_controller = ModelCallController(
            provider_ops=self._provider_ops,
            organization_id=organization_id,
            target=ModelCallTarget(
                provider=provider,
                provider_key_id=provider_key_id,
                model=model,
            ),
            fallback_models=list(agent.fallback_models or []),
            settings=runtime_settings,
            usage=run_usage,
            params_for_target=lambda provider_name, target_model: (
                request_params
                if provider_name == provider.name and target_model == model
                else resolve_request_params(
                    agent.model_params,
                    params_override,
                    provider_name,
                    target_model,
                )
            ),
        )
        safety_identifier = _safety_identifier(
            organization_id=organization_id,
            user_id=user_id,
        )
        tool_iterations = 0

        # Forward tokens in real-time as they arrive from the provider.
        # `_stream_segment` lazily reserves a chat placeholder row on the
        # first token and tags every token with its message_id, letting
        # the chat translator publish AGENT_TOKEN_DELTA events.
        stream_result: _StreamSegmentResult | None = None
        async for event in self._controlled_stream_segment(
            controller=call_controller,
            writer=writer,
            messages=llm_messages,
            system=system_prompt,
            tools=tool_schemas,
            cache_key=str(agent_id),
            safety_identifier=safety_identifier,
        ):
            if isinstance(event, _StreamSegmentResult):
                stream_result = event
            else:
                yield event  # enriched block events + placeholder MESSAGE_STORED

        if stream_result is None or (stream_result.completion is None and not stream_result.error):
            await self._create_run_log(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                usage=run_usage,
                tool_calls=None,
                tool_iterations=0,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                status="error",
                error="No response from LLM",
                provider_key_id=provider_key_id,
            )
            yield StreamEvent(type=EventType.ERROR, error="No response from LLM")
            return

        if stream_result.error:
            logger.warning(
                "Provider stream failed",
                provider=call_controller.target.provider_name,
                model=call_controller.target.model,
                error=stream_result.error,
            )
            await self._create_run_log(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=model,
                usage=run_usage,
                tool_calls=None,
                tool_iterations=0,
                duration_ms=int((time.monotonic() - start_time) * 1000),
                status="error",
                error=stream_result.error,
                provider_key_id=provider_key_id,
            )
            yield StreamEvent(type=EventType.ERROR, error="Model provider request failed")
            return

        completion = stream_result.completion
        if completion is None:
            raise RuntimeError("stream terminal result missing completion")

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
                    cache_creation_input_tokens=(completion.cache_creation_input_tokens),
                    cache_read_input_tokens=completion.cache_read_input_tokens,
                    model=completion.model,
                    thinking=stream_result.thinking or None,
                )

            tool_ctx = ToolContext(
                session=self._session,
                user_id=user_id,
                organization_id=organization_id,
                agent_id=agent_id,
                session_id=session_id,
                user_timezone=user_timezone,
                memory_scope=memory_scope,
                memory_bridge_scope=memory_bridge,
                memory_recall_promoted=recall_promoted,
                is_test_session=agent_session.is_test if agent_session else False,
                image_params=image_config.params if image_config else {},
                image_max_resolution=(image_config.max_resolution if image_config else None),
                image_max_quality=image_config.max_quality if image_config else None,
                integration_connections=agent.integration_connections or {},
                channel_id=channel_id,
                deferred_tool_groups=plan.deferred_names(),
                loaded_tool_groups=loaded_tool_groups,
                allowed_tools=allowed_tools,
            )
            executor = ToolExecutor(registry, tool_ctx)

            terminal_error: str | None = None
            async for event in self._stream_tool_loop(
                writer=writer,
                agent_id=agent_id,
                system_prompt=system_prompt,
                tool_schemas=tool_schemas,
                llm_messages=llm_messages,
                result=completion,
                executor=executor,
                run_tool_calls=run_tool_calls,
                call_controller=call_controller,
                safety_identifier=safety_identifier,
                pending_thinking=(
                    stream_result.thinking if stream_result.placeholder_id is None else None
                ),
                deferred_pool=deferred_pool,
            ):
                if event.type is EventType.DONE:
                    # The tool loop yielded a done event with the final result;
                    # create run log and re-yield
                    tool_iterations = len(run_tool_calls)
                    await self._create_run_log(
                        session_id=session_id,
                        channel_id=channel_id,
                        agent_id=agent_id,
                        user_id=user_id,
                        organization_id=organization_id,
                        model=event.model,
                        usage=run_usage,
                        tool_calls=run_tool_calls or None,
                        tool_iterations=tool_iterations,
                        duration_ms=int((time.monotonic() - start_time) * 1000),
                        status="success",
                        error=None,
                        provider_key_id=provider_key_id,
                    )
                    yield event
                    return
                if event.type is EventType.ERROR:
                    terminal_error = event.error
                yield event

            await self._create_run_log(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=run_usage.last_model or model,
                usage=run_usage,
                tool_calls=run_tool_calls or None,
                tool_iterations=len(run_tool_calls),
                duration_ms=int((time.monotonic() - start_time) * 1000),
                status="error",
                error=terminal_error or "tool_loop_incomplete",
                provider_key_id=provider_key_id,
            )
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
                cache_creation_input_tokens=(completion.cache_creation_input_tokens),
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
                cache_creation_input_tokens=(completion.cache_creation_input_tokens),
                cache_read_input_tokens=completion.cache_read_input_tokens,
                model=completion.model,
                thinking=stream_result.thinking or None,
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
            usage=run_usage,
            tool_calls=None,
            tool_iterations=0,
            duration_ms=int((time.monotonic() - start_time) * 1000),
            status="success",
            error=None,
            provider_key_id=provider_key_id,
        )

        yield StreamEvent(
            type=EventType.DONE,
            assistant_message=assistant_message,
            model=completion.model,
        )

    async def _stream_tool_loop(
        self,
        *,
        writer: MessageWriter,
        agent_id: UUID,
        system_prompt: str,
        tool_schemas: list[dict],
        llm_messages: list[dict],
        result: CompletionResult,
        executor: ToolExecutor,
        run_tool_calls: list[dict] | None = None,
        call_controller: ModelCallController,
        safety_identifier: str | None,
        pending_thinking: list[dict] | None = None,
        deferred_pool: dict[str, list[dict]] | None = None,
    ) -> AsyncIterator[StreamEvent]:
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
        StreamEvent
            Tool call, tool result, token, and done events.

        Raises
        ------
        ValidationError
            If the loop exceeds MAX_TOOL_ITERATIONS.

        """
        work_iterations = 0
        load_iterations = 0
        while True:
            if _is_load_only_turn(result.tool_calls):
                load_iterations += 1
            else:
                work_iterations += 1
            if work_iterations > MAX_TOOL_ITERATIONS or (load_iterations > MAX_LOAD_ONLY_ITERATIONS):
                break
            logger.debug(
                "Stream tool loop iteration",
                iteration=work_iterations,
                tool_calls=len(result.tool_calls),
            )

            # Build assistant message content blocks. Provider thinking
            # blocks (signature included) MUST lead the turn when
            # continuing with tool results or the API rejects it; they
            # live only in this in-memory continuation, never in rows.
            assistant_content: list[dict] = [*result.thinking_blocks]
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

            # Store the assistant tool-call message(s) and yield tool call
            # events. The segment's folded thinking rides on the FIRST row
            # only (session destination; the chat destination persists it
            # on the narration placeholder instead).
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
                    cache_creation_input_tokens=(result.cache_creation_input_tokens),
                    cache_read_input_tokens=result.cache_read_input_tokens,
                    model=result.model,
                    thinking=pending_thinking,
                )
                pending_thinking = None
                tool_call_message_ids[tc.id] = stored.id
                # Track tool calls for run log
                if run_tool_calls is not None:
                    run_tool_calls.append({"name": tc.name, "call_id": tc.id})
                yield StreamEvent(
                    type=EventType.TOOL_RESULT_START,
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
            read_results = await _gather_read_tool_results(registry, base_ctx, read_calls)

            results_content: dict[str, str] = {}
            results_success: dict[str, bool] = {}
            turn_tool_results: dict[str, ToolResult] = dict(read_results)

            for tc in read_calls:
                res = read_results[tc.id]
                content = res.data if res.success else f"Error: {res.error}"
                stored_result = await writer.add_message(
                    role="tool",
                    content=content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_result=content,
                    tool_metadata=res.metadata,
                )
                yield StreamEvent(
                    type=EventType.TOOL_RESULT_END,
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    success=res.success,
                    tool_result=content,
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
                    yield StreamEvent(
                        type=EventType.CONFIRMATION_REQUIRED,
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
                        yield StreamEvent(
                            type=EventType.TOOL_RESULT_END,
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                            success=False,
                            tool_result=rejection,
                            message_id=stored_result.id,
                        )
                        results_content[tc.id] = rejection
                        results_success[tc.id] = False
                        continue

                tool_result = await executor.execute(tc)
                turn_tool_results[tc.id] = tool_result
                content = tool_result.data if tool_result.success else f"Error: {tool_result.error}"
                stored_result = await writer.add_message(
                    role="tool",
                    content=content,
                    tool_name=tc.name,
                    tool_call_id=tc.id,
                    tool_result=content,
                    tool_metadata=tool_result.metadata,
                )
                yield StreamEvent(
                    type=EventType.TOOL_RESULT_END,
                    tool_call_id=tc.id,
                    tool_name=tc.name,
                    success=tool_result.success,
                    tool_result=content,
                    message_id=stored_result.id,
                )
                results_content[tc.id] = content
                results_success[tc.id] = tool_result.success

                # A write tool may queue runtime events (e.g. a proposed skill
                # draft); forward them right after its result, then clear.
                while base_ctx.pending_events:
                    yield base_ctx.pending_events.pop(0)

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

            _expand_loaded_schemas(tool_schemas, deferred_pool, turn_tool_results)

            stream_result: _StreamSegmentResult | None = None
            async for event in self._controlled_stream_segment(
                controller=call_controller,
                writer=writer,
                messages=llm_messages,
                system=system_prompt,
                tools=tool_schemas,
                cache_key=str(agent_id),
                safety_identifier=safety_identifier,
            ):
                if isinstance(event, _StreamSegmentResult):
                    stream_result = event
                else:
                    yield event  # enriched block events + placeholder MESSAGE_STORED

            if stream_result is None or (
                stream_result.completion is None and not stream_result.error
            ):
                yield StreamEvent(
                    type=EventType.ERROR, error="No response from LLM during tool loop"
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

            # If the LLM is done (no more tool calls), settle the placeholder
            # (or write a fresh row when no streaming was used) and yield final.
            if result.stop_reason != "tool_use" or not result.tool_calls:
                if stream_result.placeholder_id is not None:
                    assistant_message = await writer.finalize_assistant_placeholder(
                        message_id=stream_result.placeholder_id,
                        content=result.content or "",
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                        cache_creation_input_tokens=(result.cache_creation_input_tokens),
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
                        cache_creation_input_tokens=(result.cache_creation_input_tokens),
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

            # Stream produced more tool_use after some narration. Settle the
            # placeholder so its `streaming` flag clears before the next
            # iteration's tool-call rows land underneath it.
            if stream_result.placeholder_id is not None:
                await writer.finalize_assistant_placeholder(
                    message_id=stream_result.placeholder_id,
                    content=result.content or "",
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                    cache_creation_input_tokens=(result.cache_creation_input_tokens),
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

    async def _controlled_stream_segment(
        self,
        *,
        controller: ModelCallController,
        writer: MessageWriter,
        messages: list[dict],
        system: str | None,
        tools: list[dict] | None,
        cache_key: str,
        safety_identifier: str | None,
    ) -> AsyncIterator[StreamEvent | _StreamSegmentResult]:
        while True:
            try:
                stream_iter, transitions = await controller.open_stream(
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
                yield _StreamSegmentResult(
                    completion=None,
                    error=str(exc),
                    error_exception=exc,
                    placeholder_id=None,
                )
                return

            for transition in transitions:
                yield _failover_event(transition)

            stream_result: _StreamSegmentResult | None = None
            started_output = False
            try:
                async with asyncio.timeout(controller.remaining_seconds()):
                    async for event in self._stream_segment(stream_iter, writer):
                        if isinstance(event, _StreamSegmentResult):
                            stream_result = event
                        else:
                            if event.type in _BLOCK_EVENT_TYPES:
                                started_output = True
                            yield event
            except Exception as exc:
                stream_result = _StreamSegmentResult(
                    completion=None,
                    error=str(exc),
                    error_exception=exc,
                    placeholder_id=None,
                    started_output=started_output,
                )

            if stream_result is None:
                stream_result = _StreamSegmentResult(
                    completion=None,
                    error="stream ended without a terminal result",
                    error_exception=None,
                    placeholder_id=None,
                    started_output=started_output,
                )
            if stream_result.completion is not None:
                controller.record_result(stream_result.completion)
                yield stream_result
                return

            failure = stream_result.error_exception or RuntimeError(
                stream_result.error or "provider stream failed"
            )
            transition = await controller.record_failure_and_failover(
                failure,
                allow_failover=not (started_output or stream_result.started_output),
            )
            if transition is None:
                yield stream_result
                return
            yield _failover_event(transition)

    async def _stream_segment(
        self,
        stream_iter: AsyncIterator[StreamEvent],
        writer: MessageWriter,
    ) -> AsyncIterator[StreamEvent | _StreamSegmentResult]:
        """Enrich public stream events while retaining terminal state for the runtime."""
        completion: CompletionResult | None = None
        error: str | None = None
        error_exception: BaseException | None = None
        placeholder_id: UUID | None = None
        started_output = False
        sequence = 0
        thinking_started: dict[str, float] = {}
        thinking_folded: dict[str, dict] = {}

        async for event in stream_iter:
            if event.type in _BLOCK_EVENT_TYPES:
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
            if event.type in _BLOCK_EVENT_TYPES:
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

        yield _StreamSegmentResult(
            completion=completion,
            error=error,
            error_exception=error_exception,
            placeholder_id=placeholder_id,
            started_output=started_output,
            thinking=[b for b in thinking_folded.values() if b["content"]],
        )

    async def _resolve_invoked_skill(
        self,
        *,
        skills: list,
        invoked_skill_id: UUID | None,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        session_id: UUID | None,
    ) -> SkillPromptEntry | None:
        """Force-resolve an on-demand invoked skill from the agent's own set.

        The access gate is set membership: only a skill already resolved for
        the agent (enabled + always-active) can be invoked, so a user cannot
        reach an arbitrary org skill by id. Returns the full-content entry and
        records the ``invoked=true`` usage row (the strongest evolution signal).
        """
        if invoked_skill_id is None:
            return None
        match = next((s for s in skills if s.id == invoked_skill_id), None)
        if match is None:
            logger.warning(f"Invoked skill {invoked_skill_id} not in agent's resolved set; ignoring")
            return None
        await record_skill_event(
            self._session,
            skill_id=match.id,
            skill_version=int(getattr(match, "latest_version_number", 0) or 0),
            agent_id=agent_id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            invoked=True,
            commit=False,
        )
        return to_skill_prompt_entry(match)

    async def _resolve_memory_scope(
        self,
        *,
        destination: RuntimeDestination,
        user_id: UUID,
        organization_id: UUID,
        session_kind: str | None = None,
    ) -> MemoryScopeRef:
        """Route the run to its audience scope; the whole memory model hangs on this.

        Personal scope is granted only when the surface audience is exactly
        the trigger user: direct/cron sessions and 1:1 agent DMs. Everything
        else is shared space and gets the shared subject's scope.
        """
        if isinstance(destination, SessionDestination):
            if session_kind in ("group", "global"):
                return MemoryScopeRef.session(destination.session_id)
            return MemoryScopeRef.user(user_id)

        from uniffy.domains.chat.cache import get_or_load_channel

        channel = await get_or_load_channel(self._session, destination.channel_id, organization_id)
        if (
            channel is not None
            and channel.is_agent_dm
            and channel.channel_type == ChannelType.DIRECT
        ):
            return MemoryScopeRef.user(user_id)
        return MemoryScopeRef.channel(destination.channel_id)

    _MEMORY_SCOPE_LABELS = {
        MemoryScope.USER: (
            "Personal memory for this user (private to them; kept with every assistant they talk to)"
        ),
        MemoryScope.CHANNEL: "Channel memory (shared with all members of this channel)",
        MemoryScope.SESSION: "Session memory (shared with participants of this session)",
        MemoryScope.ORG: ("Organization memory (curated by agent managers; visible to all members)"),
    }
    _MEMORY_AGENT_ORG_LABEL = (
        "Organization memory kept for you specifically (curated by agent managers)"
    )
    _MEMORY_BRIDGE_LABEL = (
        "Personal memory of the user who triggered this run (they opted in to "
        "using it in shared spaces; replies here are visible to others and may "
        "draw on it)"
    )

    async def _resolve_memory_bridge(
        self,
        *,
        scope_ref: MemoryScopeRef,
        user_id: UUID,
        organization_id: UUID,
    ) -> MemoryScopeRef | None:
        """Read-only widening of a shared-space run with the trigger user's
        personal memory; requires both the org gate and the user's opt-in."""
        if scope_ref.scope not in (MemoryScope.CHANNEL, MemoryScope.SESSION):
            return None
        try:
            settings = await get_runtime_settings(self._session, organization_id)
            if not settings.personal_memory_bridge_enabled:
                return None
            if not await is_personal_bridge_enabled(
                self._session, user_id=user_id, organization_id=organization_id
            ):
                return None
        except Exception:
            logger.opt(exception=True).warning("Memory bridge resolution failed")
            return None
        return MemoryScopeRef.user(user_id)

    async def _build_memory_context(
        self,
        *,
        agent_id: UUID,
        organization_id: UUID,
        scope_ref: MemoryScopeRef,
        bridge_ref: MemoryScopeRef | None = None,
    ) -> str | None:
        """Assemble the org tiers + surface (+ opted-in personal) memory blocks."""
        try:
            refs: list[tuple[MemoryScopeRef, str]] = [
                (MemoryScopeRef.org(), self._MEMORY_SCOPE_LABELS[MemoryScope.ORG]),
                (MemoryScopeRef.org(agent_id), self._MEMORY_AGENT_ORG_LABEL),
                (scope_ref, self._MEMORY_SCOPE_LABELS[scope_ref.scope]),
            ]
            if bridge_ref is not None:
                refs.append((bridge_ref, self._MEMORY_BRIDGE_LABEL))
            blocks: list[MemoryScopeBlock] = []
            for ref, label in refs:
                payload = await fetch_memory_index(
                    self._session,
                    organization_id=organization_id,
                    scope_ref=ref,
                )
                blocks.append(
                    MemoryScopeBlock(
                        label=label,
                        pinned=payload.get("pinned") or [],
                        index=payload.get("index") or [],
                        total=int(payload.get("total") or 0),
                    )
                )
            return build_memory_block(blocks)
        except Exception:
            logger.opt(exception=True).warning("Failed to build memory context")
            return None

    async def _build_memory_recall_block(
        self,
        *,
        agent_id: UUID,
        organization_id: UUID,
        scope_ref: MemoryScopeRef,
        context_messages: list,
        content: str,
    ) -> str | None:
        """Dynamic recall for the trigger turn: surface bucket + both org
        tiers, NEVER the bridge bucket (personal memory stays pull-only in
        shared spaces). Returns the rendered block or None.
        """
        query = build_recall_query(context_messages, content)
        if not query:
            return None
        recall = await build_memory_recall(
            self._session,
            organization_id=organization_id,
            refs=[scope_ref, MemoryScopeRef.org(), MemoryScopeRef.org(agent_id)],
            query=query,
        )
        if recall is None:
            return None
        return render_recall_block(recall)

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
            logger.opt(exception=True).warning(
                "Failed to build chat_context block; continuing without it"
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
        usage: RunUsageAccumulator,
        tool_calls: list[dict] | None,
        tool_iterations: int,
        duration_ms: int,
        status: str,
        error: str | None,
        provider_key_id: UUID | None = None,
        channel_id: UUID | None = None,
    ) -> None:
        """Persist one session- or channel-backed run for usage analytics."""
        cost, cost_currency = await self._compute_run_cost(
            organization_id=organization_id,
            usage=usage,
        )
        recorded_model = usage.last_model or model
        recorded_provider_key_id = usage.last_provider_key_id or provider_key_id
        try:
            run_log = AgentRunLog(
                session_id=session_id,
                channel_id=channel_id,
                agent_id=agent_id,
                user_id=user_id,
                organization_id=organization_id,
                model=recorded_model,
                provider_key_id=recorded_provider_key_id,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_creation_input_tokens=usage.cache_creation_input_tokens,
                cache_read_input_tokens=usage.cache_read_input_tokens,
                thinking_tokens=usage.thinking_tokens,
                tool_calls=tool_calls,
                model_calls=usage.to_list() or None,
                tool_iterations=tool_iterations,
                duration_ms=duration_ms,
                status=status,
                error=error,
                retry_count=usage.retry_count,
                failover_provider_key_ids=usage.failover_provider_key_ids or None,
                deadline_exceeded=usage.deadline_exceeded,
                cost=cost,
                cost_currency=cost_currency,
            )
            self._session.add(run_log)
            await self._session.commit()
        except Exception:
            logger.opt(exception=True).warning("Failed to create agent run log")
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
        usage: RunUsageAccumulator,
    ):
        """Keep token analytics writable when pricing or conversion is unavailable."""
        try:
            raw_cost = usage.cost_usd()
            if raw_cost is None:
                logger.warning(
                    "Skipping cost calculation: model call pricing is incomplete",
                    model_calls=[
                        {"provider": call.provider, "model": call.model} for call in usage.calls
                    ],
                )
                return None, None
            display_currency = await get_display_currency(self._session, organization_id)
            converted = await convert_currency(
                raw_cost,
                PRICING_CURRENCY,
                display_currency,
                self._session,
                organization_id,
            )
            return converted, display_currency
        except ValidationError as exc:
            logger.warning(f"Skipping cost calculation: {exc}")
            return None, None
        except Exception as exc:
            logger.exception(f"Cost calculation failed unexpectedly: {exc!r}")
            return None, None


_BLOCK_EVENT_TYPES = frozenset({
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
    error_exception: BaseException | None
    placeholder_id: UUID | None
    started_output: bool = False
    # Display-safe reasoning folded from the segment's thinking events:
    # [{block_id, content, elapsed_ms}], persisted onto the assistant row.
    thinking: list[dict] = dataclass_field(default_factory=list)
