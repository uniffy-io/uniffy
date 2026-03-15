"""Business logic for agent configuration management."""

from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from uniffy.core.avatars import delete_avatar as s3_delete_avatar
from uniffy.core.avatars import upload_avatar as s3_upload_avatar
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.errors import ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import ContentType, VisibilityScope
from uniffy.domains.agents.audit import create_audit_log
from uniffy.domains.agents.content_policy import check_admin_content


class AgentOperations(BaseContentOperations[Agent]):
    """Operations for managing agent configurations.

    Extends BaseContentOperations to provide automatic permission
    checking, search indexing, and soft-delete for agents.

    Parameters
    ----------
    session : AsyncSession
        Database session.

    """

    content_type = ContentType.AGENT
    model_class = Agent

    def _build_search_keywords(self, model: Agent) -> str:
        """Build search keywords from agent name and soul prompt.

        Parameters
        ----------
        model : Agent
            The agent model.

        Returns
        -------
        str
            Keywords string for search indexing.

        """
        parts = [model.name]
        if model.soul_prompt:
            parts.append(model.soul_prompt[:500])
        return " ".join(parts)

    def _get_search_title(self, model: Agent) -> str:
        """Get agent name as search title.

        Parameters
        ----------
        model : Agent
            The agent model.

        Returns
        -------
        str
            The agent name.

        """
        return model.name

    def _get_url_path(self, model: Agent) -> str:
        """Get frontend URL path for the agent.

        Parameters
        ----------
        model : Agent
            The agent model.

        Returns
        -------
        str
            URL path.

        """
        return f"/agents/{model.id}"

    def _get_search_description(self, model: Agent) -> str | None:
        """Get truncated soul prompt as search description.

        Parameters
        ----------
        model : Agent
            The agent model.

        Returns
        -------
        str | None
            First 200 chars of soul prompt, or None.

        """
        return model.soul_prompt[:200] if model.soul_prompt else None

    async def create_agent(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        name: str,
        soul_prompt: str = "",
        primary_model: str = "claude-sonnet-4-6",
        fallback_models: list[str] | None = None,
        avatar_emoji: str = "",
        theme_color: str = "",
        is_default: bool = False,
        enabled_skills: list[str] | None = None,
        visibility: VisibilityScope = VisibilityScope.ORGANIZATION,
        group_ids: list[UUID] | None = None,
        image_model: str = "",
        primary_provider_key_id: UUID | None = None,
        image_provider_key_id: UUID | None = None,
        prompt_id: UUID | None = None,
    ) -> Agent:
        """Create a new agent configuration.

        Parameters
        ----------
        user_id : UUID
            The user creating the agent.
        organization_id : UUID
            Organization context.
        name : str
            Agent display name.
        soul_prompt : str
            Personality and instruction text.
        primary_model : str
            Default model identifier.
        fallback_models : list[str] | None
            Ordered fallback model list.
        avatar_emoji : str
            Emoji avatar.
        theme_color : str
            Theme color string.
        is_default : bool
            Whether this is the org's default agent.
        enabled_skills : list[str] | None
            List of skill IDs to enable.
        visibility : VisibilityScope
            Visibility scope for the agent.
        group_ids : list[UUID] | None
            Group IDs when visibility is GROUP.
        image_model : str
            Image generation model identifier (empty = disabled).
        primary_provider_key_id : UUID | None
            Provider key for the primary model.
        image_provider_key_id : UUID | None
            Provider key for the image model.
        prompt_id : UUID | None
            Prompt template to use.

        Returns
        -------
        Agent
            The created agent.

        Raises
        ------
        ValidationError
            If name is empty.

        """
        if not name or not name.strip():
            raise ValidationError("name", "Agent name cannot be empty")

        # Content policy check on soul_prompt (warn-only)
        if soul_prompt:
            check_admin_content(soul_prompt, "soul_prompt")

        if is_default:
            await self._clear_existing_default(organization_id)

        # Default to the bundled prompt template when none is specified
        if prompt_id is None:
            prompt_id = await self._get_default_bundled_prompt_id()

        agent = Agent(
            name=name.strip(),
            soul_prompt=soul_prompt,
            primary_model=primary_model,
            fallback_models=fallback_models or [],
            enabled_tools=[
                "memory.save",
                "memory.recall",
                "memory.list",
                "memory.forget",
            ],
            enabled_skills=enabled_skills or [],
            avatar_emoji=avatar_emoji,
            theme_color=theme_color,
            is_default=is_default,
            visibility=visibility,
            image_model=image_model,
            primary_provider_key_id=primary_provider_key_id,
            image_provider_key_id=image_provider_key_id,
            prompt_id=prompt_id,
        )

        agent = await self.create(user_id, organization_id, agent, group_ids)

        await create_audit_log(
            self.session,
            organization_id=organization_id,
            user_id=user_id,
            action="agent.create",
            resource_type="agent",
            resource_id=agent.id,
            details={"name": agent.name},
        )
        await self.session.commit()

        return agent

    async def list_agents(
        self,
        user_id: UUID,
        organization_id: UUID,
        visibility: VisibilityScope | None = None,
        personal_only: bool = False,
        group_id: UUID | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Agent], int]:
        """List agents with filters and permission checking.

        Parameters
        ----------
        user_id : UUID
            User requesting the list.
        organization_id : UUID
            Organization context.
        visibility : VisibilityScope | None
            Filter by visibility scope.
        personal_only : bool
            Only return agents owned by the user with PRIVATE visibility.
        group_id : UUID | None
            Filter by group membership.
        page : int
            Page number (1-based).
        page_size : int
            Items per page.

        Returns
        -------
        tuple[list[Agent], int]
            List of agents and total count.

        """
        query = select(Agent).where(
            Agent.organization_id == organization_id,
            Agent.is_deleted == False,  # noqa: E712
        )

        # Apply visibility/access filter
        if personal_only:
            personal_filter = self.access_query.build_personal_filter(
                user_id=user_id,
                owner_id_column=Agent.owner_id,
                visibility_column=Agent.visibility,
            )
            query = query.where(personal_filter)
        elif group_id:
            group_filter = self.access_query.build_group_filter(
                group_id=group_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Agent.id,
                visibility_column=Agent.visibility,
            )
            query = query.where(group_filter)
        else:
            access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Agent.id,
                owner_id_column=Agent.owner_id,
                visibility_column=Agent.visibility,
            )
            query = query.where(access_filter)

        if visibility:
            query = query.where(Agent.visibility == visibility)

        # Count total
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        # Sort and paginate
        query = query.order_by(Agent.updated_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        agents = list(result.scalars().all())

        return agents, total

    async def update_agent(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        name: str | None = None,
        soul_prompt: str | None = None,
        primary_model: str | None = None,
        fallback_models: list[str] | None = None,
        avatar_emoji: str | None = None,
        theme_color: str | None = None,
        is_default: bool | None = None,
        enabled_skills: list[str] | None = None,
        enabled_tools: list[str] | None = None,
        visibility: VisibilityScope | None = None,
        group_ids: list[UUID] | None = None,
        image_model: str | None = None,
        primary_provider_key_id: UUID | None = None,
        image_provider_key_id: UUID | None = None,
        clear_primary_provider_key: bool = False,
        clear_image_provider_key: bool = False,
        prompt_id: UUID | None = None,
        clear_prompt: bool = False,
    ) -> Agent:
        """Update an agent configuration.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent to update.
        name : str | None
            New name (None = no change).
        soul_prompt : str | None
            New soul prompt (None = no change).
        primary_model : str | None
            New primary model (None = no change).
        fallback_models : list[str] | None
            New fallback models (None = no change).
        avatar_emoji : str | None
            New avatar emoji (None = no change).
        theme_color : str | None
            New theme color (None = no change).
        is_default : bool | None
            New default status (None = no change).
        enabled_skills : list[str] | None
            New enabled skills list (None = no change).
        enabled_tools : list[str] | None
            New enabled tools list (None = no change).
        visibility : VisibilityScope | None
            New visibility (None = no change).
        group_ids : list[UUID] | None
            New group IDs for GROUP visibility.
        image_model : str | None
            New image model (None = no change).
        primary_provider_key_id : UUID | None
            New provider key for the primary model (None = no change).
        image_provider_key_id : UUID | None
            New provider key for the image model (None = no change).
        clear_primary_provider_key : bool
            Set to True to clear the primary provider key.
        clear_image_provider_key : bool
            Set to True to clear the image provider key.
        prompt_id : UUID | None
            New prompt template (None = no change).
        clear_prompt : bool
            Set to True to clear the prompt template.

        Returns
        -------
        Agent
            The updated agent.

        Raises
        ------
        ValidationError
            If name is empty.

        """
        if name is not None and not name.strip():
            raise ValidationError("name", "Agent name cannot be empty")

        if name is not None:
            name = name.strip()

        # Handle is_default: need to clear other defaults first
        if is_default is not None:
            agent = await self.get_by_id(user_id, organization_id, agent_id)
            if is_default and not agent.is_default:
                await self._clear_existing_default(organization_id)

        # Handle group links for GROUP visibility changes
        if visibility is not None and group_ids is not None:
            await self._remove_group_links(agent_id)
            if visibility == VisibilityScope.GROUP and group_ids:
                await self._create_group_links(
                    agent_id,
                    group_ids,
                    user_id,
                    organization_id,
                )

        # Build updates dict, filtering None values
        updates: dict[str, Any] = {}
        if name is not None:
            updates["name"] = name
        if soul_prompt is not None:
            updates["soul_prompt"] = soul_prompt
        if primary_model is not None:
            updates["primary_model"] = primary_model
        if fallback_models is not None:
            updates["fallback_models"] = fallback_models
        if avatar_emoji is not None:
            updates["avatar_emoji"] = avatar_emoji
        if theme_color is not None:
            updates["theme_color"] = theme_color
        if is_default is not None:
            updates["is_default"] = is_default
        if enabled_skills is not None:
            updates["enabled_skills"] = enabled_skills
        if enabled_tools is not None:
            updates["enabled_tools"] = enabled_tools
        if visibility is not None:
            updates["visibility"] = visibility
        if image_model is not None:
            updates["image_model"] = image_model
        if primary_provider_key_id is not None:
            updates["primary_provider_key_id"] = primary_provider_key_id
        if image_provider_key_id is not None:
            updates["image_provider_key_id"] = image_provider_key_id
        if prompt_id is not None:
            updates["prompt_id"] = prompt_id

        # Content policy check on soul_prompt (warn-only)
        if "soul_prompt" in updates:
            check_admin_content(updates["soul_prompt"], "soul_prompt")

        agent = await self.update(user_id, organization_id, agent_id, **updates)

        # Nullable field clears must be handled after self.update()
        # because BaseContentOperations.update() skips None values
        # (it uses None to mean "no change").
        needs_commit = False
        if clear_primary_provider_key:
            agent.primary_provider_key_id = None
            needs_commit = True
        if clear_image_provider_key:
            agent.image_provider_key_id = None
            needs_commit = True
        if clear_prompt:
            agent.prompt_id = None
            needs_commit = True

        # Audit log for security-relevant field changes
        audit_fields = {
            k: v
            for k, v in updates.items()
            if k
            in {
                "soul_prompt",
                "primary_model",
                "fallback_models",
                "enabled_tools",
                "enabled_skills",
                "visibility",
                "primary_provider_key_id",
                "image_provider_key_id",
                "prompt_id",
            }
        }
        if clear_primary_provider_key:
            audit_fields["primary_provider_key_id"] = None
        if clear_image_provider_key:
            audit_fields["image_provider_key_id"] = None
        if clear_prompt:
            audit_fields["prompt_id"] = None

        if audit_fields:
            serializable = {}
            for k, v in audit_fields.items():
                if isinstance(v, UUID):
                    serializable[k] = str(v)
                elif k == "soul_prompt" and isinstance(v, str) and len(v) > 200:
                    serializable[k] = v[:200] + "..."
                else:
                    serializable[k] = v
            await create_audit_log(
                self.session,
                organization_id=organization_id,
                user_id=user_id,
                action="agent.update",
                resource_type="agent",
                resource_id=agent_id,
                details={"changes": serializable},
            )
            needs_commit = True

        if needs_commit:
            await self.session.commit()
            await self.session.refresh(agent)

        return agent

    async def upload_avatar(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        image_data: bytes,
        filename: str,
    ) -> Agent:
        """Upload and set agent avatar.

        Validates, resizes to 3 sizes (sm/md/lg), uploads to S3, and updates agent record.
        Deletes any existing avatar before setting the new one.

        Parameters
        ----------
        user_id : UUID
            The requesting user (for permission check).
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent to update.
        image_data : bytes
            Raw image bytes.
        filename : str
            Original filename for MIME type detection.

        Returns
        -------
        Agent
            Updated agent.

        Raises
        ------
        ValueError
            If image validation fails.

        """
        agent = await self.get_by_id(user_id, organization_id, agent_id)
        await self._require_edit(user_id, organization_id, agent)

        # Delete old avatar from S3 if exists
        if agent.avatar_key:
            await s3_delete_avatar(agent.avatar_key)

        # Upload new avatar
        avatar_key = await s3_upload_avatar(
            agent_id,
            image_data,
            filename,
            prefix="agent-avatars",
        )
        agent.avatar_key = avatar_key

        await self.session.commit()
        await self.session.refresh(agent)
        return agent

    async def delete_avatar(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> Agent:
        """Delete agent avatar.

        Removes avatar images from S3 and clears the avatar_key on the agent.

        Parameters
        ----------
        user_id : UUID
            The requesting user (for permission check).
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent to update.

        Returns
        -------
        Agent
            Updated agent.

        """
        agent = await self.get_by_id(user_id, organization_id, agent_id)
        await self._require_edit(user_id, organization_id, agent)

        if agent.avatar_key:
            await s3_delete_avatar(agent.avatar_key)
            agent.avatar_key = None
            await self.session.commit()
            await self.session.refresh(agent)

        return agent

    async def delete_agent(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> None:
        """Soft-delete an agent.

        Parameters
        ----------
        user_id : UUID
            The requesting user.
        organization_id : UUID
            Organization context.
        agent_id : UUID
            Agent to delete.

        """
        await self.delete(user_id, organization_id, agent_id)

    async def get_default_agent(
        self,
        *,
        organization_id: UUID,
    ) -> Agent | None:
        """Get the organization's default agent.

        Parameters
        ----------
        organization_id : UUID
            Organization context.

        Returns
        -------
        Agent | None
            The default agent, or None if not set.

        """
        result = await self.session.execute(
            select(Agent).where(
                Agent.organization_id == organization_id,
                Agent.is_default == True,  # noqa: E712
                Agent.is_deleted == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _get_default_bundled_prompt_id(self) -> UUID | None:
        """Return the ID of the first bundled prompt template, if any.

        Returns
        -------
        UUID | None
            The bundled prompt ID, or None if no bundled prompts exist.

        """
        from uniffy.core.models.agents.prompt import AgentPrompt

        result = await self.session.execute(
            select(AgentPrompt.id)
            .where(
                AgentPrompt.organization_id.is_(None),
                AgentPrompt.source == "bundled",
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _clear_existing_default(self, organization_id: UUID) -> None:
        """Clear the is_default flag on any existing default agent.

        Parameters
        ----------
        organization_id : UUID
            Organization context.

        """
        result = await self.session.execute(
            select(Agent).where(
                Agent.organization_id == organization_id,
                Agent.is_default == True,  # noqa: E712
                Agent.is_deleted == False,  # noqa: E712
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.is_default = False
