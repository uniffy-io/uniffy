"""Agents RPC handlers."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.agents.v1.agents_pb2 import (
    CreateAgentRequest,
    CreateAgentResponse,
    DeleteAgentAvatarRequest,
    DeleteAgentAvatarResponse,
    DeleteAgentRequest,
    DeleteAgentResponse,
    GetAgentRequest,
    GetAgentResponse,
    ListAgentsRequest,
    ListAgentsResponse,
    PreviewSystemPromptRequest,
    PreviewSystemPromptResponse,
    UpdateAgentRequest,
    UpdateAgentResponse,
    UploadAgentAvatarRequest,
    UploadAgentAvatarResponse,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.auth.permissions import resolve_effective_policy
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.converters.common_proto import (
    access_mode_from_proto,
    content_role_from_proto,
)
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import ContentType
from uniffy.db import open_session
from uniffy.domains.agents.agents.converters import agent_to_proto
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.runtime.prompt import (
    build_system_prompt,
    skill_passes_activation,
    to_skill_prompt_entry,
)
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.tags import Tag, TagOperations
from uniffy.domains.users.operations import UserOperations

logger = logger.bind(component="agents.agents.handlers")


async def _resolve_effective_policy(
    session: AsyncSession,
    organization_id: UUID,
    agent: Agent,
    checker: PermissionChecker | None = None,
):
    """Return the agent's effective ``(access_mode, baseline_role)`` for proto emission."""
    permission_checker = checker or PermissionChecker(session)
    default_mode, default_baseline = await permission_checker.get_org_defaults(
        organization_id, ContentType.AGENT,
    )
    return resolve_effective_policy(
        agent.access_mode, agent.baseline_role, default_mode, default_baseline,
    )


def _parse_tag_ids(raw_ids: list[str]) -> list[UUID]:
    """Parse a repeated string proto field into a list of UUIDs.

    Empty input returns an empty list. Invalid UUIDs raise
    ``INVALID_ARGUMENT`` so the client gets actionable feedback before
    the operation runs.
    """
    out: list[UUID] = []
    for raw in raw_ids or ():
        try:
            out.append(UUID(raw))
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid tag_id") from exc
    return out


async def _hydrate_agent_tags(
    session: AsyncSession,
    organization_id: UUID,
    agent_ids: list[UUID],
) -> dict[UUID, list[Tag]]:
    """Bulk-fetch unified-tag rows for a batch of agent ids.

    Single ``TagOperations.get_for_urns`` round-trip per request batch
    (no N+1). Returns a mapping keyed on agent id with an empty list
    for agents that have no tags.
    """
    if not agent_ids:
        return {}
    urn_to_id = {
        build_content_urn(ContentType.AGENT, aid): aid for aid in agent_ids
    }
    tag_ops = TagOperations(session)
    bulk = await tag_ops.get_for_urns(
        organization_id=organization_id,
        content_urns=list(urn_to_id),
    )
    return {aid: bulk.get(urn, []) for urn, aid in urn_to_id.items()}


def _parse_uuid(value: str, field: str) -> UUID:
    """Parse a UUID string or raise ``INVALID_ARGUMENT``."""
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, f"Invalid {field}: {exc}") from exc


def _map_domain_error(operation: str, exc: Exception) -> ConnectError:
    """Translate a domain exception into the matching ``ConnectError``."""
    if isinstance(exc, NotFoundError):
        return ConnectError(Code.NOT_FOUND, str(exc) or "Not found")
    if isinstance(exc, ValidationError):
        return ConnectError(Code.INVALID_ARGUMENT, str(exc))
    if isinstance(exc, PermissionDeniedError):
        return ConnectError(Code.PERMISSION_DENIED, str(exc) or "Access denied")
    logger.exception(f"Error in {operation}: {exc}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class AgentsHandlers:
    """RPC handlers for ``agents.v1.AgentsService``."""

    async def create_agent(
        self,
        request: CreateAgentRequest,
        ctx: RequestContext,
    ) -> CreateAgentResponse:
        """Create a new agent."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        soul_prompt = request.soul_prompt if request.HasField("soul_prompt") else ""
        primary_model = (
            request.primary_model if request.HasField("primary_model") else "claude-sonnet-4-6"
        )
        avatar_emoji = request.avatar_emoji if request.HasField("avatar_emoji") else ""
        theme_color = request.theme_color if request.HasField("theme_color") else ""
        is_default = request.is_default if request.HasField("is_default") else False

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        baseline_role = (
            content_role_from_proto(request.baseline_role) if request.baseline_role else None
        )

        group_ids = (
            [_parse_uuid(gid, "group_id") for gid in request.group_ids]
            if request.group_ids
            else None
        )
        image_model = request.image_model if request.HasField("image_model") else ""
        primary_provider_key_id = (
            _parse_uuid(request.primary_provider_key_id, "primary_provider_key_id")
            if request.HasField("primary_provider_key_id") and request.primary_provider_key_id
            else None
        )
        image_provider_key_id = (
            _parse_uuid(request.image_provider_key_id, "image_provider_key_id")
            if request.HasField("image_provider_key_id") and request.image_provider_key_id
            else None
        )
        prompt_id = (
            _parse_uuid(request.prompt_id, "prompt_id")
            if request.HasField("prompt_id") and request.prompt_id
            else None
        )
        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                agent = await ops.create_agent(
                    user_id=user_id,
                    organization_id=org_id,
                    name=request.name,
                    soul_prompt=soul_prompt,
                    primary_model=primary_model,
                    fallback_models=list(request.fallback_models),
                    avatar_emoji=avatar_emoji,
                    theme_color=theme_color,
                    is_default=is_default,
                    enabled_skills=list(request.enabled_skills),
                    access_mode=access_mode,
                    baseline_role=baseline_role,
                    group_ids=group_ids,
                    image_model=image_model,
                    primary_provider_key_id=primary_provider_key_id,
                    image_provider_key_id=image_provider_key_id,
                    prompt_id=prompt_id,
                    tag_ids=tag_ids or None,
                )
                user_role = await ops.resolve_role(user_id, org_id, agent)
                tags_by_id = await _hydrate_agent_tags(session, org_id, [agent.id])
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, agent,
                )
                return CreateAgentResponse(
                    agent=agent_to_proto(
                        agent,
                        user_role=user_role,
                        tags=tags_by_id.get(agent.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("create_agent", exc) from exc

    async def get_agent(
        self,
        request: GetAgentRequest,
        ctx: RequestContext,
    ) -> GetAgentResponse:
        """Get an agent by ID."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                agent = await ops.get_by_id(user_id, org_id, agent_id)
                user_role = await ops.resolve_role(user_id, org_id, agent)
                tags_by_id = await _hydrate_agent_tags(session, org_id, [agent.id])
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, agent,
                )
                return GetAgentResponse(
                    agent=agent_to_proto(
                        agent,
                        user_role=user_role,
                        tags=tags_by_id.get(agent.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("get_agent", exc) from exc

    async def list_agents(
        self,
        request: ListAgentsRequest,
        ctx: RequestContext,
    ) -> ListAgentsResponse:
        """List agents with filters and pagination."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")

        access_mode = access_mode_from_proto(request.access_mode) if request.access_mode else None
        personal_only = request.personal_only if request.HasField("personal_only") else False
        group_id = (
            _parse_uuid(request.group_id, "group_id") if request.HasField("group_id") else None
        )

        page = 1
        page_size = 100
        if request.HasField("pagination"):
            page = request.pagination.page or 1
            page_size = request.pagination.page_size or 100

        tag_ids = _parse_tag_ids(list(request.tag_ids))

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                agents, total = await ops.list_agents(
                    user_id=user_id,
                    organization_id=org_id,
                    access_mode=access_mode,
                    personal_only=personal_only,
                    group_id=group_id,
                    page=page,
                    page_size=page_size,
                    tag_ids=tag_ids or None,
                )
                total_pages = (total + page_size - 1) // page_size if page_size else 1
                roles = [await ops.resolve_role(user_id, org_id, a) for a in agents]
                tags_by_id = await _hydrate_agent_tags(
                    session, org_id, [a.id for a in agents]
                )
                checker = PermissionChecker(session)
                default_mode, default_baseline = await checker.get_org_defaults(
                    org_id, ContentType.AGENT,
                )
                proto_agents = []
                for a, r in zip(agents, roles, strict=True):
                    eff_mode, eff_baseline = resolve_effective_policy(
                        a.access_mode, a.baseline_role, default_mode, default_baseline,
                    )
                    proto_agents.append(
                        agent_to_proto(
                            a,
                            user_role=r,
                            tags=tags_by_id.get(a.id),
                            effective_access_mode=eff_mode,
                            effective_baseline_role=eff_baseline,
                        )
                    )
                return ListAgentsResponse(
                    agents=proto_agents,
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("list_agents", exc) from exc

    async def update_agent(
        self,
        request: UpdateAgentRequest,
        ctx: RequestContext,
    ) -> UpdateAgentResponse:
        """Update an agent configuration."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        name = request.name if request.HasField("name") else None
        soul_prompt = request.soul_prompt if request.HasField("soul_prompt") else None
        primary_model = request.primary_model if request.HasField("primary_model") else None
        avatar_emoji = request.avatar_emoji if request.HasField("avatar_emoji") else None
        theme_color = request.theme_color if request.HasField("theme_color") else None
        is_default = request.is_default if request.HasField("is_default") else None
        image_model = request.image_model if request.HasField("image_model") else None

        primary_provider_key_id = None
        clear_primary_provider_key = False
        if request.HasField("primary_provider_key_id"):
            if request.primary_provider_key_id:
                primary_provider_key_id = _parse_uuid(
                    request.primary_provider_key_id, "primary_provider_key_id"
                )
            else:
                clear_primary_provider_key = True

        image_provider_key_id = None
        clear_image_provider_key = False
        if request.HasField("image_provider_key_id"):
            if request.image_provider_key_id:
                image_provider_key_id = _parse_uuid(
                    request.image_provider_key_id, "image_provider_key_id"
                )
            else:
                clear_image_provider_key = True

        prompt_id = None
        clear_prompt = False
        if request.HasField("prompt_id"):
            if request.prompt_id:
                prompt_id = _parse_uuid(request.prompt_id, "prompt_id")
            else:
                clear_prompt = True
        if request.HasField("clear_prompt") and request.clear_prompt:
            clear_prompt = True

        fallback_models = list(request.fallback_models)
        enabled_skills = list(request.enabled_skills)
        enabled_tools = list(request.enabled_tools)

        tag_ids: list[UUID] | None = None
        if request.HasField("tag_ids"):
            tag_ids = _parse_tag_ids(list(request.tag_ids.ids))

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                agent = await ops.update_agent(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    name=name,
                    soul_prompt=soul_prompt,
                    primary_model=primary_model,
                    fallback_models=fallback_models,
                    avatar_emoji=avatar_emoji,
                    theme_color=theme_color,
                    is_default=is_default,
                    enabled_skills=enabled_skills,
                    enabled_tools=enabled_tools,
                    image_model=image_model,
                    primary_provider_key_id=primary_provider_key_id,
                    image_provider_key_id=image_provider_key_id,
                    clear_primary_provider_key=clear_primary_provider_key,
                    clear_image_provider_key=clear_image_provider_key,
                    prompt_id=prompt_id,
                    clear_prompt=clear_prompt,
                    tag_ids=tag_ids,
                )
                user_role = await ops.resolve_role(user_id, org_id, agent)
                tags_by_id = await _hydrate_agent_tags(session, org_id, [agent.id])
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, agent,
                )
                return UpdateAgentResponse(
                    agent=agent_to_proto(
                        agent,
                        user_role=user_role,
                        tags=tags_by_id.get(agent.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("update_agent", exc) from exc

    async def delete_agent(
        self,
        request: DeleteAgentRequest,
        ctx: RequestContext,
    ) -> DeleteAgentResponse:
        """Delete an agent."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                await ops.delete_agent(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )
                return DeleteAgentResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_agent", exc) from exc

    async def upload_agent_avatar(
        self,
        request: UploadAgentAvatarRequest,
        ctx: RequestContext,
    ) -> UploadAgentAvatarResponse:
        """Upload and set an agent avatar."""
        user_id = get_user_id_from_context(ctx)

        if not request.image_data:
            raise ConnectError(Code.INVALID_ARGUMENT, "Image data is required")
        if not request.filename:
            raise ConnectError(Code.INVALID_ARGUMENT, "Filename is required")

        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                agent = await ops.upload_avatar(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    image_data=request.image_data,
                    filename=request.filename,
                )
                user_role = await ops.resolve_role(user_id, org_id, agent)
                tags_by_id = await _hydrate_agent_tags(session, org_id, [agent.id])
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, agent,
                )
                return UploadAgentAvatarResponse(
                    agent=agent_to_proto(
                        agent,
                        user_role=user_role,
                        tags=tags_by_id.get(agent.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, str(exc)) from exc
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("upload_agent_avatar", exc) from exc

    async def delete_agent_avatar(
        self,
        request: DeleteAgentAvatarRequest,
        ctx: RequestContext,
    ) -> DeleteAgentAvatarResponse:
        """Delete an agent avatar."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        try:
            async with open_session() as session:
                ops = AgentOperations(session)
                agent = await ops.delete_avatar(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )
                user_role = await ops.resolve_role(user_id, org_id, agent)
                tags_by_id = await _hydrate_agent_tags(session, org_id, [agent.id])
                eff_mode, eff_baseline = await _resolve_effective_policy(
                    session, org_id, agent,
                )
                return DeleteAgentAvatarResponse(
                    agent=agent_to_proto(
                        agent,
                        user_role=user_role,
                        tags=tags_by_id.get(agent.id),
                        effective_access_mode=eff_mode,
                        effective_baseline_role=eff_baseline,
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("delete_agent_avatar", exc) from exc

    async def preview_system_prompt(
        self,
        request: PreviewSystemPromptRequest,
        ctx: RequestContext,
    ) -> PreviewSystemPromptResponse:
        """Assemble the runtime system prompt for an agent."""
        user_id = get_user_id_from_context(ctx)
        org_id = _parse_uuid(request.organization_id, "organization_id")
        agent_id = _parse_uuid(request.agent_id, "agent_id")

        try:
            async with open_session() as session:
                agent_ops = AgentOperations(session)
                org_ops = OrganizationOperations(session)
                user_ops = UserOperations(session)
                skill_ops = SkillOperations(session)

                agent = await agent_ops.get_by_id(user_id, org_id, agent_id)

                org = await org_ops.get_by_id(org_id)
                membership = await org_ops.require_org_member(user_id, org_id)
                user = await user_ops.get_by_id(user_id)
                role = membership.role
                user_role = role.value if hasattr(role, "value") else str(role)

                skills = await skill_ops.get_skills_for_agent(
                    organization_id=org_id,
                    enabled_skill_ids=agent.enabled_skills or [],
                )
                skill_entries = [
                    to_skill_prompt_entry(s)
                    for s in skills
                    if skill_passes_activation(
                        s, enabled_tools=agent.enabled_tools or [], surface="session"
                    )
                ]

                memory_context = await self._fetch_memory_context_for_preview(
                    session=session,
                    agent_id=agent_id,
                    user_id=user_id,
                    organization_id=org_id,
                )

                prompt_content = await self._resolve_prompt_for_preview(
                    session=session,
                    prompt_id=agent.prompt_id,
                )

                system_prompt = build_system_prompt(
                    agent_name=agent.name,
                    soul_prompt=agent.soul_prompt,
                    org_name=org.name,
                    user_name=user.full_name or user.username,
                    user_role=user_role,
                    enabled_tools=agent.enabled_tools or [],
                    skills=skill_entries or None,
                    memory_context=memory_context or None,
                    prompt_content=prompt_content,
                )

                return PreviewSystemPromptResponse(system_prompt=system_prompt)
        except ConnectError:
            raise
        except Exception as exc:
            raise _map_domain_error("preview_system_prompt", exc) from exc

    @staticmethod
    async def _fetch_memory_context_for_preview(
        *,
        session: AsyncSession,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        limit: int = 10,
    ) -> list[str]:
        """Fetch memory context strings for prompt preview."""
        try:
            result = await session.execute(
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
            logger.opt(exception=True).warning("Failed to fetch memory context for preview")
            return []

    @staticmethod
    async def _resolve_prompt_for_preview(
        *,
        session: AsyncSession,
        prompt_id: UUID | None,
    ) -> str | None:
        """Resolve prompt template content for preview."""
        if not prompt_id:
            return None
        try:
            from uniffy.domains.agents.prompts.operations import PromptOperations

            prompt_ops = PromptOperations(session)
            prompt = await prompt_ops.get_prompt_by_id(prompt_id)
            if prompt and prompt.content:
                return prompt.content
        except Exception:
            logger.opt(exception=True).warning("Failed to resolve prompt for preview")
        return None
