"""Agent agents RPC handlers - thin layer delegating to operations."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.agents.v1.agents_pb2 import (
    AgentResponse,
    CreateAgentRequest,
    DeleteAgentAvatarRequest,
    DeleteAgentRequest,
    DeleteAgentResponse,
    GetAgentRequest,
    ListAgentsRequest,
    ListAgentsResponse,
    PreviewSystemPromptRequest,
    PreviewSystemPromptResponse,
    UpdateAgentRequest,
    UploadAgentAvatarRequest,
)
from uniffy_proto.common.v1.common_pb2 import PaginationResponse

from uniffy.core.converters.common_proto import visibility_from_proto
from uniffy.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.core.types import VisibilityScope
from uniffy.db import get_async_session
from uniffy.domains.agents.agents.converters import agent_to_proto
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.runtime.prompt import build_system_prompt
from uniffy.domains.agents.skills.operations import SkillOperations
from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.users.operations import UserOperations


class AgentsHandlers:
    """RPC handlers for agents service."""

    async def create_agent(
        self,
        request: CreateAgentRequest,
        ctx: RequestContext,
    ) -> AgentResponse:
        """Handle create_agent RPC call.

        Parameters
        ----------
        request : CreateAgentRequest
            The request with agent details.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        AgentResponse
            The created agent.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        soul_prompt = request.soul_prompt if request.HasField("soul_prompt") else ""
        primary_model = (
            request.primary_model if request.HasField("primary_model") else "claude-sonnet-4-6"
        )
        avatar_emoji = request.avatar_emoji if request.HasField("avatar_emoji") else ""
        theme_color = request.theme_color if request.HasField("theme_color") else ""
        is_default = request.is_default if request.HasField("is_default") else False
        visibility = (
            visibility_from_proto(request.visibility)
            if request.HasField("visibility")
            else VisibilityScope.ORGANIZATION
        )
        group_ids = [UUID(gid) for gid in request.group_ids] if request.group_ids else None
        image_model = request.image_model if request.HasField("image_model") else ""
        primary_provider_key_id = (
            UUID(request.primary_provider_key_id)
            if request.HasField("primary_provider_key_id") and request.primary_provider_key_id
            else None
        )
        image_provider_key_id = (
            UUID(request.image_provider_key_id)
            if request.HasField("image_provider_key_id") and request.image_provider_key_id
            else None
        )
        prompt_id = (
            UUID(request.prompt_id) if request.HasField("prompt_id") and request.prompt_id else None
        )

        try:
            async for session in get_async_session():
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
                    visibility=visibility,
                    group_ids=group_ids,
                    image_model=image_model,
                    primary_provider_key_id=primary_provider_key_id,
                    image_provider_key_id=image_provider_key_id,
                    prompt_id=prompt_id,
                )
                return AgentResponse(agent=agent_to_proto(agent))

        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error creating agent: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def get_agent(
        self,
        request: GetAgentRequest,
        ctx: RequestContext,
    ) -> AgentResponse:
        """Handle get_agent RPC call.

        Parameters
        ----------
        request : GetAgentRequest
            The request with agent ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        AgentResponse
            The agent.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = AgentOperations(session)
                agent = await ops.get_by_id(user_id, org_id, agent_id)
                return AgentResponse(agent=agent_to_proto(agent))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error getting agent: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def list_agents(
        self,
        request: ListAgentsRequest,
        ctx: RequestContext,
    ) -> ListAgentsResponse:
        """Handle list_agents RPC call.

        Parameters
        ----------
        request : ListAgentsRequest
            The request with organization ID and pagination.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        ListAgentsResponse
            Paginated list of agents.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization ID format")

        visibility = (
            visibility_from_proto(request.visibility) if request.HasField("visibility") else None
        )
        personal_only = request.personal_only if request.HasField("personal_only") else False
        group_id = UUID(request.group_id) if request.HasField("group_id") else None

        page = 1
        page_size = 100
        if request.HasField("pagination"):
            page = request.pagination.page or 1
            page_size = request.pagination.page_size or 100

        try:
            async for session in get_async_session():
                ops = AgentOperations(session)
                agents, total = await ops.list_agents(
                    user_id=user_id,
                    organization_id=org_id,
                    visibility=visibility,
                    personal_only=personal_only,
                    group_id=group_id,
                    page=page,
                    page_size=page_size,
                )
                total_pages = (total + page_size - 1) // page_size if page_size else 1
                return ListAgentsResponse(
                    agents=[agent_to_proto(a) for a in agents],
                    pagination=PaginationResponse(
                        page=page,
                        page_size=page_size,
                        total_count=total,
                        total_pages=total_pages,
                    ),
                )

        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error listing agents: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def update_agent(
        self,
        request: UpdateAgentRequest,
        ctx: RequestContext,
    ) -> AgentResponse:
        """Handle update_agent RPC call.

        Parameters
        ----------
        request : UpdateAgentRequest
            The request with updated fields.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        AgentResponse
            The updated agent.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        name = request.name if request.HasField("name") else None
        soul_prompt = request.soul_prompt if request.HasField("soul_prompt") else None
        primary_model = request.primary_model if request.HasField("primary_model") else None
        avatar_emoji = request.avatar_emoji if request.HasField("avatar_emoji") else None
        theme_color = request.theme_color if request.HasField("theme_color") else None
        is_default = request.is_default if request.HasField("is_default") else None
        visibility = (
            visibility_from_proto(request.visibility) if request.HasField("visibility") else None
        )
        group_ids = [UUID(gid) for gid in request.group_ids] if request.group_ids else None
        image_model = request.image_model if request.HasField("image_model") else None

        # Provider key fields: empty string means "clear", absent means "no change"
        primary_provider_key_id = None
        clear_primary_provider_key = False
        if request.HasField("primary_provider_key_id"):
            if request.primary_provider_key_id:
                primary_provider_key_id = UUID(request.primary_provider_key_id)
            else:
                clear_primary_provider_key = True

        image_provider_key_id = None
        clear_image_provider_key = False
        if request.HasField("image_provider_key_id"):
            if request.image_provider_key_id:
                image_provider_key_id = UUID(request.image_provider_key_id)
            else:
                clear_image_provider_key = True

        prompt_id = None
        clear_prompt = False
        if request.HasField("prompt_id"):
            if request.prompt_id:
                prompt_id = UUID(request.prompt_id)
            else:
                clear_prompt = True
        if request.HasField("clear_prompt") and request.clear_prompt:
            clear_prompt = True

        # Repeated fields: protobuf cannot distinguish "not sent" from "sent empty"
        # (both are []). The frontend always sends the full list when updating these
        # fields, so we pass through whatever is received. An empty list means
        # "clear all", not "no change".
        fallback_models = list(request.fallback_models)
        enabled_skills = list(request.enabled_skills)
        enabled_tools = list(request.enabled_tools)

        try:
            async for session in get_async_session():
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
                    visibility=visibility,
                    group_ids=group_ids,
                    image_model=image_model,
                    primary_provider_key_id=primary_provider_key_id,
                    image_provider_key_id=image_provider_key_id,
                    clear_primary_provider_key=clear_primary_provider_key,
                    clear_image_provider_key=clear_image_provider_key,
                    prompt_id=prompt_id,
                    clear_prompt=clear_prompt,
                )
                return AgentResponse(agent=agent_to_proto(agent))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except ValidationError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error updating agent: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_agent(
        self,
        request: DeleteAgentRequest,
        ctx: RequestContext,
    ) -> DeleteAgentResponse:
        """Handle delete_agent RPC call.

        Parameters
        ----------
        request : DeleteAgentRequest
            The request with agent ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        DeleteAgentResponse
            Success response.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = AgentOperations(session)
                await ops.delete_agent(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )
                return DeleteAgentResponse(success=True)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting agent: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def upload_agent_avatar(
        self,
        request: UploadAgentAvatarRequest,
        ctx: RequestContext,
    ) -> AgentResponse:
        """Handle upload_agent_avatar RPC call.

        Parameters
        ----------
        request : UploadAgentAvatarRequest
            The request with image data.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        AgentResponse
            The updated agent.

        """
        user_id = get_user_id_from_context(ctx)

        if not request.image_data:
            raise ConnectError(Code.INVALID_ARGUMENT, "Image data is required")
        if not request.filename:
            raise ConnectError(Code.INVALID_ARGUMENT, "Filename is required")

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = AgentOperations(session)
                agent = await ops.upload_avatar(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                    image_data=request.image_data,
                    filename=request.filename,
                )
                return AgentResponse(agent=agent_to_proto(agent))

        except ValueError as e:
            raise ConnectError(Code.INVALID_ARGUMENT, str(e))
        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error uploading agent avatar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def delete_agent_avatar(
        self,
        request: DeleteAgentAvatarRequest,
        ctx: RequestContext,
    ) -> AgentResponse:
        """Handle delete_agent_avatar RPC call.

        Parameters
        ----------
        request : DeleteAgentAvatarRequest
            The request with agent ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        AgentResponse
            The updated agent.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                ops = AgentOperations(session)
                agent = await ops.delete_avatar(
                    user_id=user_id,
                    organization_id=org_id,
                    agent_id=agent_id,
                )
                return AgentResponse(agent=agent_to_proto(agent))

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error deleting agent avatar: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    async def preview_system_prompt(
        self,
        request: PreviewSystemPromptRequest,
        ctx: RequestContext,
    ) -> PreviewSystemPromptResponse:
        """Handle preview_system_prompt RPC call.

        Assembles the full system prompt for an agent as it would appear
        at runtime, including skills, tools, memories, and user context.

        Parameters
        ----------
        request : PreviewSystemPromptRequest
            The request with agent ID.
        ctx : RequestContext
            RPC request context.

        Returns
        -------
        PreviewSystemPromptResponse
            The assembled system prompt text.

        """
        user_id = get_user_id_from_context(ctx)

        try:
            org_id = UUID(request.organization_id)
            agent_id = UUID(request.agent_id)
        except ValueError:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid ID format")

        try:
            async for session in get_async_session():
                agent_ops = AgentOperations(session)
                org_ops = OrganizationOperations(session)
                user_ops = UserOperations(session)
                skill_ops = SkillOperations(session)

                # Load agent (with permission check)
                agent = await agent_ops.get_by_id(user_id, org_id, agent_id)

                # Load org and user context
                org = await org_ops.get_by_id(org_id)
                membership = await org_ops.require_org_member(user_id, org_id)
                user = await user_ops.get_by_id(user_id)
                role = membership.role
                user_role = role.value if hasattr(role, "value") else str(role)

                # Fetch skill contents
                skills = await skill_ops.get_skills_for_agent(
                    organization_id=org_id,
                    enabled_skill_ids=agent.enabled_skills or [],
                )
                skill_contents = [s.content for s in skills if s.content]

                # Fetch memory context
                memory_context = await self._fetch_memory_context_for_preview(
                    session=session,
                    agent_id=agent_id,
                    user_id=user_id,
                    organization_id=org_id,
                )

                # Resolve prompt template
                prompt_content = await self._resolve_prompt_for_preview(
                    session=session,
                    prompt_id=agent.prompt_id,
                )

                # Assemble the prompt
                system_prompt = build_system_prompt(
                    agent_name=agent.name,
                    soul_prompt=agent.soul_prompt,
                    org_name=org.name,
                    user_name=user.full_name or user.username,
                    user_role=user_role,
                    enabled_tools=agent.enabled_tools or [],
                    skill_contents=skill_contents or None,
                    memory_context=memory_context or None,
                    prompt_content=prompt_content,
                )

                return PreviewSystemPromptResponse(system_prompt=system_prompt)

        except NotFoundError:
            raise ConnectError(Code.NOT_FOUND, "Agent not found")
        except PermissionDeniedError as e:
            raise ConnectError(Code.PERMISSION_DENIED, str(e))
        except ConnectError:
            raise
        except Exception as e:
            logger.error(f"Error previewing system prompt: {e}", exc_info=True)
            raise ConnectError(Code.INTERNAL, "Internal server error")

    @staticmethod
    async def _fetch_memory_context_for_preview(
        *,
        session: AsyncSession,
        agent_id: UUID,
        user_id: UUID,
        organization_id: UUID,
        limit: int = 10,
    ) -> list[str]:
        """Fetch memory context for prompt preview.

        Parameters
        ----------
        session : AsyncSession
            Database session.
        agent_id : UUID
            Agent ID.
        user_id : UUID
            User ID.
        organization_id : UUID
            Organization ID.
        limit : int
            Max memories to include.

        Returns
        -------
        list[str]
            Formatted memory strings.

        """
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
            logger.warning("Failed to fetch memory context for preview", exc_info=True)
            return []

    @staticmethod
    async def _resolve_prompt_for_preview(
        *,
        session: AsyncSession,
        prompt_id: UUID | None,
    ) -> str | None:
        """Resolve prompt template content for preview.

        Parameters
        ----------
        session : AsyncSession
            Database session.
        prompt_id : UUID | None
            Prompt template ID.

        Returns
        -------
        str | None
            Prompt content, or None if no template set.

        """
        if not prompt_id:
            return None
        try:
            from uniffy.domains.agents.prompts.operations import PromptOperations

            prompt_ops = PromptOperations(session)
            prompt = await prompt_ops.get_prompt_by_id(prompt_id)
            if prompt and prompt.content:
                return prompt.content
        except Exception:
            logger.warning("Failed to resolve prompt for preview", exc_info=True)
        return None
