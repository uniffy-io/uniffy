"""Agent operations."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import String, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.avatars import delete_avatar as s3_delete_avatar
from uniffy.core.avatars import upload_avatar as s3_upload_avatar
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.members import (
    ContentMembersOperations,
    register_content_loader,
)
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.search.indexer import build_content_urn
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.core.users.cache import invalidate_agent_profile
from uniffy.domains.agents.audit import create_audit_log
from uniffy.domains.agents.cache import (
    fetch_agent_row,
    invalidate_cached_agent,
    invalidate_cached_agent_prompt,
    invalidate_cached_agent_skills,
    set_cached_agent,
    track_agent_prompt_ref,
    track_agent_skill_refs,
)
from uniffy.domains.agents.content_policy import check_admin_content
from uniffy.domains.tags import TagAssignment, TagOperations


def _coerce_uuid_list(values: list | None) -> list[UUID]:
    """Convert an ``enabled_skills`` JSONB list to a ``list[UUID]``.

    JSONB stores strings; the cache reverse-index keys on UUID. Bad
    entries are skipped so a single corrupt value doesn't poison the
    set update.
    """
    out: list[UUID] = []
    if not values:
        return out
    for raw in values:
        try:
            out.append(UUID(str(raw)))
        except (ValueError, AttributeError):
            continue
    return out


class AgentOperations(BaseContentOperations[Agent]):
    """Agent CRUD with permissions and search indexing."""

    content_type = ContentType.AGENT
    model_class = Agent

    def __init__(self, session: AsyncSession) -> None:
        """Initialize agent operations."""
        super().__init__(session)

    def _build_search_keywords(self, model: Agent) -> str:
        """Aggregate searchable text for an agent."""
        parts = [model.name]
        if model.soul_prompt:
            parts.append(model.soul_prompt[:500])
        return " ".join(parts)

    def _get_search_title(self, model: Agent) -> str:
        """Return the agent name for the search index."""
        return model.name

    def _get_url_path(self, model: Agent) -> str:
        """Return the frontend route for this agent."""
        return f"/agents/{model.id}"

    async def resolve_role(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent: Agent,
    ) -> ContentRole | None:
        """Public wrapper over ``_resolve_role`` for handlers/converters."""
        return await self._resolve_role(user_id, organization_id, agent)

    async def get_for_runtime(
        self,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> Agent:
        """Cached agent fetch with view-permission check.

        Read-only path used by the runtime pre-flight phase. Returns a
        transient row from Valkey on hit; falls through to PG on miss
        and write-throughs the cache. Mutating callers must keep using
        ``_fetch_by_id`` so the row stays attached to the session.
        """
        agent = await fetch_agent_row(self.session, agent_id, organization_id)
        if not agent:
            raise NotFoundError(self.content_type.value, agent_id)
        await self._require_view(user_id, organization_id, agent)
        return agent

    def _get_search_description(self, model: Agent) -> str | None:
        """Return a description snippet from the soul prompt."""
        return model.soul_prompt[:200] if model.soul_prompt else None

    async def _get_search_tags_async(self, model: Agent) -> list[str] | None:
        """Return the slug list assigned to this agent via the unified store."""
        tag_ops = TagOperations(self.session)
        urn = build_content_urn(self.content_type, model.id)
        bulk = await tag_ops.get_for_urns(
            organization_id=model.organization_id,
            content_urns=[urn],
        )
        slugs = sorted({tag.slug for tag in bulk.get(urn, [])})
        return slugs or None

    def _tag_filter_subquery(self, tag_ids: list[UUID]):
        """Subquery: agent ids that carry every tag id in ``tag_ids``.

        Logical AND across the tag set via GROUP BY + HAVING
        COUNT(DISTINCT). Mirrors the notes / files / calendar / chat
        shape so the explorer's filter rail composes uniformly.
        """
        urn_prefix = "urn:uniffy:content:AGENT:"
        urn_expr = func.concat(urn_prefix, cast(Agent.id, String))
        return (
            select(Agent.id)
            .join(TagAssignment, TagAssignment.content_urn == urn_expr)
            .where(TagAssignment.tag_id.in_(tag_ids))
            .group_by(Agent.id)
            .having(func.count(func.distinct(TagAssignment.tag_id)) == len(tag_ids))
        )

    async def _sync_agent_tags(
        self,
        *,
        actor_id: UUID,
        agent: Agent,
        tag_ids: list[UUID] | None,
    ) -> None:
        """Reconcile manual tag assignments after an agent write.

        ``tag_ids=None`` leaves manual assignments untouched (used by
        partial updates that did not ship tags). Empty list clears them.
        """
        if tag_ids is None:
            return
        tag_ops = TagOperations(self.session)
        await tag_ops.replace_manual_tags(
            actor_id=actor_id,
            organization_id=agent.organization_id,
            content_urn=build_content_urn(self.content_type, agent.id),
            tag_ids=tag_ids,
        )

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
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        group_ids: list[UUID] | None = None,
        image_model: str = "",
        primary_provider_key_id: UUID | None = None,
        image_provider_key_id: UUID | None = None,
        prompt_id: UUID | None = None,
        tag_ids: list[UUID] | None = None,
    ) -> Agent:
        """Create a new agent configuration."""
        if not name or not name.strip():
            raise ValidationError("name", "Agent name cannot be empty")

        if soul_prompt:
            check_admin_content(soul_prompt, "soul_prompt")

        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        if is_default:
            await self._clear_existing_default(organization_id)

        if prompt_id is None:
            prompt_id = await self._get_default_bundled_prompt_id()

        agent = Agent(
            organization_id=organization_id,
            owner_id=user_id,
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
            access_mode=access_mode,
            baseline_role=baseline_role,
            image_model=image_model,
            primary_provider_key_id=primary_provider_key_id,
            image_provider_key_id=image_provider_key_id,
            prompt_id=prompt_id,
        )
        self.session.add(agent)
        await self.session.commit()
        await self.session.refresh(agent)

        if group_ids:
            members_ops = ContentMembersOperations(self.session)
            for gid in group_ids:
                await members_ops.add_member(
                    actor_user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id=agent.id,
                    subject_type=SubjectType.GROUP,
                    subject_id=gid,
                    role=ContentRole.VIEWER,
                )

        await self._sync_agent_tags(
            actor_id=user_id,
            agent=agent,
            tag_ids=tag_ids,
        )

        await self._index_for_search(agent, skip_member_lookup=not group_ids)
        await self.session.commit()

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

        await set_cached_agent(agent)
        added_skill_uuids = _coerce_uuid_list(agent.enabled_skills)
        if added_skill_uuids:
            await track_agent_skill_refs(
                agent.id, added_skill_ids=added_skill_uuids
            )
        if agent.prompt_id is not None:
            await track_agent_prompt_ref(
                agent.id, old_prompt_id=None, new_prompt_id=agent.prompt_id
            )

        return agent

    async def list_agents(
        self,
        user_id: UUID,
        organization_id: UUID,
        access_mode: AccessMode | None = None,
        personal_only: bool = False,
        group_id: UUID | None = None,
        page: int = 1,
        page_size: int = 50,
        tag_ids: list[UUID] | None = None,
    ) -> tuple[list[Agent], int]:
        """List agents the user can access."""
        from sqlalchemy import or_

        from uniffy.core.models.login.group_member import GroupMember
        from uniffy.core.models.permissions.content_member import ContentMember

        query = select(Agent).where(
            Agent.organization_id == organization_id,
            Agent.is_deleted == False,  # noqa: E712
        )

        if personal_only:
            query = query.where(Agent.owner_id == user_id)
        elif group_id:
            now = datetime.now(UTC)
            group_subq = select(ContentMember.content_id).where(
                ContentMember.organization_id == organization_id,
                ContentMember.content_type == self.content_type,
                ContentMember.subject_type == SubjectType.GROUP,
                ContentMember.subject_id == group_id,
                ContentMember.role != ContentRole.BLOCKED,
                or_(
                    ContentMember.expires_at.is_(None),
                    ContentMember.expires_at > now,
                ),
            )
            query = query.where(Agent.id.in_(group_subq))
        else:
            is_admin = await self.permission_checker.is_org_admin(user_id, organization_id)
            if not is_admin:
                is_admin = await self.permission_checker.is_domain_admin(
                    user_id, organization_id, self.content_type
                )
            if not is_admin:
                access_filter = self.access_query.build_accessible_filter(
                    user_id=user_id,
                    organization_id=organization_id,
                    content_type=self.content_type,
                    content_id_column=Agent.id,
                    owner_id_column=Agent.owner_id,
                    access_mode_column=Agent.access_mode,
                    baseline_role_column=Agent.baseline_role,
                )
                query = query.where(access_filter)

        # Avoid the unused import warning if personal_only / group_id aren't taken.
        _ = GroupMember

        if access_mode is not None:
            query = query.where(Agent.access_mode == access_mode)

        if tag_ids:
            query = query.where(Agent.id.in_(self._tag_filter_subquery(tag_ids)))

        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.session.execute(count_query)).scalar() or 0

        query = query.order_by(Agent.updated_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.session.execute(query)
        agents = list(result.scalars().all())

        return agents, total

    async def get_agents_usable_by_user(
        self,
        user_id: UUID,
        organization_id: UUID,
    ) -> list[Agent]:
        """Return agents the user has at least VIEWER access to.

        Thin wrapper over the permission-filtered list used by the chat
        sidebar agent picker: returns all non-deleted agents the user can
        view, unsorted by the caller's preference (recency ordering lives
        in the builder/picker UI).

        BLOCKED and out-of-scope agents are excluded by
        `ContentAccessQuery.build_accessible_filter`.
        """
        query = select(Agent).where(
            Agent.organization_id == organization_id,
            Agent.is_deleted == False,  # noqa: E712
        )

        is_admin = await self.permission_checker.is_org_admin(user_id, organization_id)
        if not is_admin:
            is_admin = await self.permission_checker.is_domain_admin(
                user_id, organization_id, self.content_type
            )
        if not is_admin:
            access_filter = self.access_query.build_accessible_filter(
                user_id=user_id,
                organization_id=organization_id,
                content_type=self.content_type,
                content_id_column=Agent.id,
                owner_id_column=Agent.owner_id,
                access_mode_column=Agent.access_mode,
                baseline_role_column=Agent.baseline_role,
            )
            query = query.where(access_filter)

        result = await self.session.execute(query.order_by(Agent.name))
        return list(result.scalars().all())

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
        image_model: str | None = None,
        primary_provider_key_id: UUID | None = None,
        image_provider_key_id: UUID | None = None,
        clear_primary_provider_key: bool = False,
        clear_image_provider_key: bool = False,
        prompt_id: UUID | None = None,
        clear_prompt: bool = False,
        tag_ids: list[UUID] | None = None,
    ) -> Agent:
        """Update an agent configuration.

        Access-policy changes (access mode, baseline role, members) go
        through ``permissions.v1.MembersService``, never this method.
        """
        if name is not None and not name.strip():
            raise ValidationError("name", "Agent name cannot be empty")

        agent = await self._fetch_by_id(agent_id, organization_id)
        if agent is None:
            raise NotFoundError("Agent", agent_id)

        await self._require_edit(user_id, organization_id, agent)

        if is_default is not None and is_default and not agent.is_default:
            await self._clear_existing_default(organization_id)

        old_skill_ids = _coerce_uuid_list(agent.enabled_skills)
        old_prompt_id = agent.prompt_id

        updates: dict[str, Any] = {}
        if name is not None:
            updates["name"] = name.strip()
            agent.name = name.strip()
        if soul_prompt is not None:
            check_admin_content(soul_prompt, "soul_prompt")
            updates["soul_prompt"] = soul_prompt
            agent.soul_prompt = soul_prompt
        if primary_model is not None:
            updates["primary_model"] = primary_model
            agent.primary_model = primary_model
        if fallback_models is not None:
            updates["fallback_models"] = fallback_models
            agent.fallback_models = fallback_models
        if avatar_emoji is not None:
            updates["avatar_emoji"] = avatar_emoji
            agent.avatar_emoji = avatar_emoji
        if theme_color is not None:
            updates["theme_color"] = theme_color
            agent.theme_color = theme_color
        if is_default is not None:
            updates["is_default"] = is_default
            agent.is_default = is_default
        if enabled_skills is not None:
            updates["enabled_skills"] = enabled_skills
            agent.enabled_skills = enabled_skills
        if enabled_tools is not None:
            updates["enabled_tools"] = enabled_tools
            agent.enabled_tools = enabled_tools
        if image_model is not None:
            updates["image_model"] = image_model
            agent.image_model = image_model
        if primary_provider_key_id is not None:
            updates["primary_provider_key_id"] = primary_provider_key_id
            agent.primary_provider_key_id = primary_provider_key_id
        if image_provider_key_id is not None:
            updates["image_provider_key_id"] = image_provider_key_id
            agent.image_provider_key_id = image_provider_key_id
        if prompt_id is not None:
            updates["prompt_id"] = prompt_id
            agent.prompt_id = prompt_id

        if clear_primary_provider_key:
            agent.primary_provider_key_id = None
            updates["primary_provider_key_id"] = None
        if clear_image_provider_key:
            agent.image_provider_key_id = None
            updates["image_provider_key_id"] = None
        if clear_prompt:
            agent.prompt_id = None
            updates["prompt_id"] = None

        agent.updated_at = datetime.now(UTC)

        await self.session.commit()
        await self.session.refresh(agent)

        await self._sync_agent_tags(
            actor_id=user_id,
            agent=agent,
            tag_ids=tag_ids,
        )

        await self._index_for_search(agent)
        await self.session.commit()

        await invalidate_agent_profile(agent_id)
        await set_cached_agent(agent)
        await invalidate_cached_agent_skills(agent_id)
        await invalidate_cached_agent_prompt(agent_id)

        new_skill_ids = _coerce_uuid_list(agent.enabled_skills)
        added_skill_ids = [s for s in new_skill_ids if s not in old_skill_ids]
        removed_skill_ids = [s for s in old_skill_ids if s not in new_skill_ids]
        if added_skill_ids or removed_skill_ids:
            await track_agent_skill_refs(
                agent_id,
                added_skill_ids=added_skill_ids,
                removed_skill_ids=removed_skill_ids,
            )

        if agent.prompt_id != old_prompt_id:
            await track_agent_prompt_ref(
                agent_id,
                old_prompt_id=old_prompt_id,
                new_prompt_id=agent.prompt_id,
            )

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
                "primary_provider_key_id",
                "image_provider_key_id",
                "prompt_id",
            }
        }
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
            await self.session.commit()

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
        """Upload and set an agent avatar."""
        agent = await self.get_by_id(user_id, organization_id, agent_id)
        await self._require_edit(user_id, organization_id, agent)

        if agent.avatar_key:
            await s3_delete_avatar(agent.avatar_key)

        avatar_key = await s3_upload_avatar(
            agent_id,
            image_data,
            filename,
            prefix="agent-avatars",
        )
        agent.avatar_key = avatar_key

        await self.session.commit()
        await self.session.refresh(agent)

        await invalidate_agent_profile(agent_id)
        await set_cached_agent(agent)

        return agent

    async def delete_avatar(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> Agent:
        """Delete an agent avatar."""
        agent = await self.get_by_id(user_id, organization_id, agent_id)
        await self._require_edit(user_id, organization_id, agent)

        if agent.avatar_key:
            await s3_delete_avatar(agent.avatar_key)
            agent.avatar_key = None
            await self.session.commit()
            await self.session.refresh(agent)
            await invalidate_agent_profile(agent_id)
            await set_cached_agent(agent)

        return agent

    async def delete_agent(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> None:
        """Soft-delete an agent."""
        agent = await self._fetch_by_id(agent_id, organization_id)
        if agent is None:
            raise NotFoundError("Agent", agent_id)

        await self._require_delete(user_id, organization_id, agent)

        old_skill_ids = _coerce_uuid_list(agent.enabled_skills)
        old_prompt_id = agent.prompt_id

        agent.is_deleted = True
        agent.deleted_at = datetime.now(UTC)
        await self.session.commit()

        from uniffy.core.search.indexer import build_content_urn

        await self.search_indexer.remove(
            build_content_urn(self.content_type, agent_id), organization_id
        )
        await self.session.commit()

        await invalidate_agent_profile(agent_id)
        await invalidate_cached_agent(agent_id)
        await invalidate_cached_agent_skills(agent_id)
        await invalidate_cached_agent_prompt(agent_id)
        if old_skill_ids:
            await track_agent_skill_refs(
                agent_id, removed_skill_ids=old_skill_ids
            )
        if old_prompt_id is not None:
            await track_agent_prompt_ref(
                agent_id, old_prompt_id=old_prompt_id, new_prompt_id=None
            )

    async def get_default_agent(
        self,
        *,
        organization_id: UUID,
    ) -> Agent | None:
        """Return the organization's default agent, if any."""
        result = await self.session.execute(
            select(Agent).where(
                Agent.organization_id == organization_id,
                Agent.is_default == True,  # noqa: E712
                Agent.is_deleted == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _get_default_bundled_prompt_id(self) -> UUID | None:
        """Return the id of the first bundled prompt template, if any."""
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
        """Clear ``is_default`` on any existing default agent in the org."""
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


# Content loader registration


async def _load_agent(
    session: AsyncSession,
    organization_id: UUID,
    content_id: UUID,
) -> Agent | None:
    """Loader used by ``ContentMembersOperations`` to fetch an agent row."""
    result = await session.execute(
        select(Agent).where(
            Agent.id == content_id,
            Agent.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


register_content_loader(ContentType.AGENT, _load_agent)
