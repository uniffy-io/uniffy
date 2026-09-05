"""Unary session-message runtime use case."""

from uuid import UUID

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.database import SessionFactory
from uniffy.core.models.agents.message import AgentMessage
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.memories.recall import attach_to_trigger_turn
from uniffy.domains.agents.policy import check_user_message
from uniffy.domains.agents.providers.catalog import resolve_request_params
from uniffy.domains.agents.providers.operations import ProviderOperations
from uniffy.domains.agents.rules.resolution import resolve_enabled_rules
from uniffy.domains.agents.runtime.context.memory import MemoryContextBuilder
from uniffy.domains.agents.runtime.context.messages import (
    build_llm_messages,
    build_stored_content,
    resolve_pending_content_blocks,
    resolve_supports_vision,
)
from uniffy.domains.agents.runtime.destinations import SessionDestination
from uniffy.domains.agents.runtime.files import FileContext
from uniffy.domains.agents.runtime.images.config import (
    apply_image_tool_schema,
    resolve_image_config,
)
from uniffy.domains.agents.runtime.models.resolver import resolve_provider_and_model
from uniffy.domains.agents.runtime.models.window import resolve_context_window
from uniffy.domains.agents.runtime.prompt import build_system_prompt
from uniffy.domains.agents.runtime.runs.complete import CompletionRunner
from uniffy.domains.agents.runtime.runs.records import RunRecorder
from uniffy.domains.agents.runtime.skills import resolve_invoked_skill
from uniffy.domains.agents.runtime.tooling import (
    allowed_tool_names,
    resolve_tool_schemas,
)
from uniffy.domains.agents.sessions.operations import (
    SessionOperations,
    apply_emergency_truncation,
)
from uniffy.domains.agents.skills.jobs.contracts import SkillAnalysisDestination
from uniffy.domains.agents.skills.resolution import SkillSurface
from uniffy.domains.agents.tools.deferral import plan_tool_advertisement
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import get_tool_registry
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle
from uniffy.domains.integrations.advertisement import (
    filter_integration_tool_schemas,
    has_advertised_integration_tools,
)
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.operations import UserOperations

logger = logger.bind(component="agents.runtime.send")


class MessageSender:
    def __init__(
        self,
        session: AsyncSession,
        storage: ObjectStorage,
        search_indexer: SearchIndexer,
        session_factory: SessionFactory,
        call_lifecycle: ChannelCallLifecycle,
    ) -> None:
        self._session = session
        self._storage = storage
        self._search_indexer = search_indexer
        self._call_lifecycle = call_lifecycle
        self._org_operations = OrganizationOperations(session)
        self._user_operations = UserOperations(session, search_indexer)
        self._session_operations = SessionOperations(session)
        self._agent_operations = AgentOperations(session, search_indexer)
        self._provider_operations = ProviderOperations(session)
        self._memory = MemoryContextBuilder(session)
        recorder = RunRecorder(session)
        self._runner = CompletionRunner(
            session=session,
            session_operations=self._session_operations,
            session_factory=session_factory,
            provider_operations=self._provider_operations,
            recorder=recorder,
        )

    async def send(
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
        membership = await self._org_operations.require_org_member(
            user_id,
            organization_id,
        )
        agent_session = await self._session_operations.get_session(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )
        agent = await self._agent_operations.get_for_runtime(
            user_id,
            organization_id,
            agent_session.agent_id,
        )
        organization = await self._org_operations.get_by_id(organization_id)
        user = await self._user_operations.get_by_id(user_id)
        role = membership.role
        user_role = role.value if hasattr(role, "value") else str(role)

        provider, provider_key_id, model = await resolve_provider_and_model(
            self._session,
            self._provider_operations,
            organization_id=organization_id,
            agent=agent,
            model_override=agent_session.model_override,
        )

        enabled_tools: list[str] = agent.enabled_tools or []
        registry = get_tool_registry()
        tool_schemas = resolve_tool_schemas(registry, enabled_tools)
        image_config = await resolve_image_config(
            self._session,
            agent,
            organization_id=organization_id,
        )
        tool_schemas = apply_image_tool_schema(tool_schemas, image_config)
        tool_schemas = await filter_integration_tool_schemas(
            self._session,
            organization_id,
            tool_schemas,
        )
        external_note = has_advertised_integration_tools(tool_schemas)
        allowed_tools = allowed_tool_names(tool_schemas)
        invoked_entry = await resolve_invoked_skill(
            self._session,
            enabled_skill_ids=agent.enabled_skills or [],
            invoked_skill_id=invoked_skill_id,
            executable_tools=allowed_tools,
            surface=SkillSurface.SESSION,
            agent_id=agent.id,
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
        )
        loaded_tool_groups = list(agent_session.loaded_tool_groups or [])
        advertisement = plan_tool_advertisement(
            registry,
            tool_schemas,
            loaded_tool_groups,
        )
        tool_schemas = advertisement.tool_schemas or None
        deferred_pool = dict(advertisement.deferred)

        memory_scope = await self._memory.resolve_scope(
            destination=SessionDestination(session_id=session_id),
            user_id=user_id,
            organization_id=organization_id,
            session_kind=agent_session.kind,
        )
        memory_bridge = await self._memory.resolve_bridge(
            scope_ref=memory_scope,
            user_id=user_id,
            organization_id=organization_id,
        )
        memory_context = await self._memory.build_context(
            agent_id=agent_session.agent_id,
            organization_id=organization_id,
            scope_ref=memory_scope,
            bridge_ref=memory_bridge,
        )
        rules = await resolve_enabled_rules(
            self._session,
            organization_id=organization_id,
            agent_id=agent.id,
            enabled_rule_ids=agent.enabled_rules,
        )
        system_prompt = build_system_prompt(
            rules=rules,
            agent_name=agent.name,
            soul_prompt=agent.soul_prompt,
            org_name=organization.name,
            user_name=user.full_name or user.username,
            user_role=user_role,
            deferred_tools=advertisement.deferred_names() or None,
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

        context_window_tokens = await resolve_context_window(provider, model)
        token_budget = int(context_window_tokens * 0.65)
        await self._session_operations.enqueue_compaction_if_needed(
            session_id=session_id,
            token_budget=token_budget,
        )
        await self._session_operations.enqueue_skill_analysis(
            destination_kind=SkillAnalysisDestination.SESSION,
            destination_id=session_id,
            user_id=user_id,
            agent_id=agent.id,
            organization_id=organization_id,
        )
        context_messages, _ = await self._session_operations.get_session_context(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            token_budget=token_budget,
        )
        context_messages = apply_emergency_truncation(context_messages, token_budget)

        injection_flags = check_user_message(content)
        if injection_flags:
            logger.warning(
                "Prompt injection flags in send_message",
                flags=injection_flags,
                user_id=str(user_id),
                session_id=str(session_id),
            )

        supports_vision = await resolve_supports_vision(provider, model)
        llm_messages = build_llm_messages(
            context_messages,
            content,
            files=files,
            supports_vision=supports_vision,
        )
        await resolve_pending_content_blocks(self._storage, llm_messages)
        recall_block = await self._memory.build_recall(
            agent_id=agent_session.agent_id,
            organization_id=organization_id,
            scope_ref=memory_scope,
            context_messages=context_messages,
            content=content,
        )
        recall_promoted = bool(recall_block and attach_to_trigger_turn(llm_messages, recall_block))

        user_message = await self._session_operations.add_message(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            role="user",
            content=build_stored_content(content, files),
            file_ids=[file.file_id for file in files] if files else None,
            invoked_skill_name=invoked_entry.display_name if invoked_entry else None,
        )
        tool_context = ToolContext(
            session=self._session,
            user_id=user_id,
            organization_id=organization_id,
            storage=self._storage,
            search_indexer=self._search_indexer,
            call_lifecycle=self._call_lifecycle,
            agent_id=agent_session.agent_id,
            session_id=session_id,
            user_timezone=user_timezone,
            memory_scope=memory_scope,
            memory_bridge_scope=memory_bridge,
            memory_recall_promoted=recall_promoted,
            is_test_session=agent_session.is_test,
            image_params=image_config.params if image_config else {},
            image_max_resolution=image_config.max_resolution if image_config else None,
            image_max_quality=image_config.max_quality if image_config else None,
            integration_connections=agent.integration_connections or {},
            deferred_tool_groups=advertisement.deferred_names(),
            loaded_tool_groups=loaded_tool_groups,
            allowed_tools=allowed_tools,
        )
        assistant_message, model_used = await self._runner.run(
            user_id=user_id,
            organization_id=organization_id,
            session_id=session_id,
            agent_id=agent_session.agent_id,
            provider=provider,
            provider_key_id=provider_key_id,
            model=model,
            fallback_models=list(agent.fallback_models or []),
            agent_model_params=agent.model_params,
            request_params=request_params,
            system_prompt=system_prompt,
            tool_schemas=tool_schemas,
            llm_messages=llm_messages,
            registry=registry,
            tool_context=tool_context,
            deferred_pool=deferred_pool,
        )
        return user_message, assistant_message, model_used
