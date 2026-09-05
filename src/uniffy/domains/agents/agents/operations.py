"""Agent operations."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import String, cast, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.avatars import delete_avatar as s3_delete_avatar
from uniffy.core.avatars import upload_avatar as s3_upload_avatar
from uniffy.core.content.base_operations import BaseContentOperations
from uniffy.core.content.registry import (
    register_content_loader,
    register_manage_override,
)
from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.agents.memory import AgentMemory
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.core.models.integrations.connection import IntegrationConnection
from uniffy.core.models.tags.tag import TagAssignment
from uniffy.core.search.indexer import SearchIndexer, build_content_urn
from uniffy.core.storage import ObjectStorage
from uniffy.core.types import AccessMode, ContentRole, ContentType, SubjectType
from uniffy.core.users.cache import invalidate_agent_profile
from uniffy.domains.agents.access import is_agents_builder, require_agents_builder
from uniffy.domains.agents.cache import (
    fetch_agent_row,
    invalidate_cached_agent,
    invalidate_cached_agent_skills,
    invalidate_memory_index,
    set_cached_agent,
    track_agent_skill_refs,
)
from uniffy.domains.agents.memories.scope import MemoryScopeRef
from uniffy.domains.agents.policy import check_admin_content
from uniffy.domains.agents.providers.catalog import (
    provider_for_model,
    strip_unsupported_image_params,
    validate_image_params,
    validate_model_params,
)
from uniffy.domains.agents.rules.validation import validate_rule_selection
from uniffy.domains.integrations.registry import get_integration_registry
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.permissions.members import (
    ContentMembersOperations,
    StagedContentMemberAdd,
)
from uniffy.domains.tags.operations import StagedManualTagReplacement, TagOperations

logger = logger.bind(component="agents.agents.operations")


@dataclass(frozen=True)
class _StagedAgentCreate:
    agent: Agent
    members: tuple[StagedContentMemberAdd, ...]
    tags: StagedManualTagReplacement | None


def _check_model_params(model_id: str, params: dict | None) -> None:
    """Validate tuned params against the model's catalog schema."""
    if not params:
        return
    provider = provider_for_model(model_id)
    try:
        validate_model_params(provider or "", model_id, params)
    except ValueError as exc:
        raise ValidationError("model_params", str(exc)) from exc


def _strip_invalid_params(model_id: str, params: dict) -> dict:
    """Drop knobs that do not validate for ``model_id``; keep the rest."""
    kept: dict = {}
    for knob, value in params.items():
        try:
            _check_model_params(model_id, {knob: value})
        except ValidationError:
            continue
        kept[knob] = value
    return kept


def _check_image_params(model_id: str, params: dict | None) -> None:
    """Validate image knobs against the image model's catalog schema."""
    if not params:
        return
    provider = provider_for_model(model_id)
    try:
        validate_image_params(provider or "", model_id, params)
    except ValueError as exc:
        raise ValidationError("image_params", str(exc)) from exc


def _strip_invalid_image_params(model_id: str, params: dict) -> dict:
    """Drop image knobs the newly selected image model rejects."""
    provider = provider_for_model(model_id)
    if provider is None:
        return {}
    return strip_unsupported_image_params(provider, model_id, params)


async def _validate_integration_connections(
    session: AsyncSession,
    organization_id: UUID,
    mapping: dict | None,
) -> None:
    """Check a pin map against the registry and this org's connection rows.

    Disabled or invalid connections are accepted deliberately: admins toggle
    keys freely and the runtime degrades to a recoverable tool error.
    """
    if not mapping:
        return
    registry = get_integration_registry()
    ids: dict[str, UUID] = {}
    for provider_id, raw in mapping.items():
        if not isinstance(provider_id, str) or registry.get(provider_id) is None:
            raise ValidationError(
                "integration_connections",
                f"Unknown integration provider '{provider_id}'",
            )
        try:
            ids[provider_id] = UUID(raw if isinstance(raw, str) else "")
        except ValueError:
            raise ValidationError(
                "integration_connections",
                f"Connection id for '{provider_id}' must be a UUID",
            ) from None
    result = await session.execute(
        select(IntegrationConnection.id, IntegrationConnection.provider).where(
            IntegrationConnection.organization_id == organization_id,
            IntegrationConnection.id.in_(list(ids.values())),
        )
    )
    provider_by_id = {row.id: row.provider for row in result}
    for provider_id, connection_id in ids.items():
        found = provider_by_id.get(connection_id)
        if found is None:
            raise ValidationError(
                "integration_connections",
                f"No {provider_id} connection with id {connection_id} exists in this organization",
            )
        if found != provider_id:
            raise ValidationError(
                "integration_connections",
                f"Connection {connection_id} belongs to provider '{found}', not '{provider_id}'",
            )


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
        except ValueError, AttributeError:
            continue
    return out


class AgentOperations(BaseContentOperations[Agent]):
    """Agent CRUD with permissions and search indexing."""

    content_type = ContentType.AGENT
    model_class = Agent

    def __init__(
        self,
        session: AsyncSession,
        search_indexer: SearchIndexer | None = None,
    ) -> None:
        super().__init__(session, search_indexer)

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

    def _get_search_metadata(self, model: Agent) -> dict[str, str] | None:
        # Search rows render the agent identity avatar (emoji or gradient).
        return {"emoji": model.avatar_emoji} if model.avatar_emoji else None

    async def _get_search_tags_async(self, model: Agent) -> list[str] | None:
        """Return the slug list assigned to this agent via the unified store."""
        tag_ops = TagOperations(self.session, self.search_indexer)
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
        tag_ops = TagOperations(self.session, self.search_indexer)
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
        enabled_rules: list[str] | None = None,
        access_mode: AccessMode | None = None,
        baseline_role: ContentRole | None = None,
        group_ids: list[UUID] | None = None,
        image_model: str = "",
        primary_provider_key_id: UUID | None = None,
        image_provider_key_id: UUID | None = None,
        tag_ids: list[UUID] | None = None,
        model_params: dict | None = None,
        image_params: dict | None = None,
        image_style_prompt: str = "",
        integration_connections: dict | None = None,
    ) -> Agent:
        """Create a new agent configuration."""
        await require_agents_builder(self.session, user_id, organization_id)

        if is_default:
            org_ops = OrganizationOperations(self.session)
            await org_ops.require_org_admin(user_id, organization_id)

        if not name or not name.strip():
            raise ValidationError("name", "Agent name cannot be empty")

        if soul_prompt:
            check_admin_content(soul_prompt, "soul_prompt")

        _check_model_params(primary_model, model_params)
        _check_image_params(image_model, image_params)
        await _validate_integration_connections(
            self.session, organization_id, integration_connections
        )
        if image_style_prompt:
            check_admin_content(image_style_prompt, "image_style_prompt")

        access_mode, baseline_role = await self._resolve_access_policy(
            organization_id, access_mode, baseline_role
        )

        if is_default:
            await self._clear_existing_default(organization_id)

        agent = Agent(
            organization_id=organization_id,
            owner_id=user_id,
            name=name.strip(),
            soul_prompt=soul_prompt,
            primary_model=primary_model,
            fallback_models=fallback_models or [],
            enabled_tools=[
                "memory.save",
                "memory.read",
                "memory.forget",
            ],
            enabled_skills=enabled_skills or [],
            enabled_rules=await validate_rule_selection(
                self._session, organization_id, enabled_rules or [], existing=[]
            ),
            avatar_emoji=avatar_emoji,
            theme_color=theme_color,
            is_default=is_default,
            access_mode=access_mode,
            baseline_role=baseline_role,
            image_model=image_model,
            primary_provider_key_id=primary_provider_key_id,
            image_provider_key_id=image_provider_key_id,
            model_params=model_params or {},
            image_params=image_params or {},
            image_style_prompt=image_style_prompt,
            integration_connections=integration_connections or {},
        )
        self.session.add(agent)
        staged_members: list[StagedContentMemberAdd] = []
        staged_tags = None
        try:
            await self.session.flush()
            members_ops = ContentMembersOperations(self.session, self.search_indexer)
            for gid in group_ids or []:
                staged_members.append(
                    await members_ops.stage_member(
                        actor_user_id=user_id,
                        organization_id=organization_id,
                        content_type=self.content_type,
                        content_id=agent.id,
                        subject_type=SubjectType.GROUP,
                        subject_id=gid,
                        role=ContentRole.VIEWER,
                    )
                )

            if tag_ids is not None:
                staged_tags = await TagOperations(
                    self.session,
                    self.search_indexer,
                ).stage_manual_tags(
                    actor_id=user_id,
                    organization_id=organization_id,
                    content_urn=build_content_urn(self.content_type, agent.id),
                    tag_ids=tag_ids,
                )
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AGENT_CREATED,
                resource_type=AuditResourceType.AGENT,
                resource_id=agent.id,
                details={"name": agent.name},
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(agent)

        await self._finish_agent_create_after_commit(
            _StagedAgentCreate(agent, tuple(staged_members), staged_tags)
        )

        return agent

    async def _finish_agent_create_after_commit(self, staged: _StagedAgentCreate) -> None:
        agent = staged.agent
        members_ops = ContentMembersOperations(self.session, self.search_indexer)
        for member in staged.members:
            try:
                await members_ops.finish_member_add_after_commit(member)
            except Exception:
                logger.opt(exception=True).warning(
                    "Agent created with degraded initial member fanout",
                    agent_id=str(agent.id),
                )

        if staged.tags is not None:
            try:
                await TagOperations(
                    self.session,
                    self.search_indexer,
                ).finish_manual_tags_after_commit(staged.tags)
            except Exception:
                logger.opt(exception=True).warning(
                    "Agent created with degraded tag projection",
                    agent_id=str(agent.id),
                )

        try:
            await self._index_for_search(agent, skip_member_lookup=not staged.members)
        except Exception:
            logger.opt(exception=True).warning(
                "Agent created with stale search projection",
                agent_id=str(agent.id),
            )

        try:
            effective_mode, _ = await self._effective_policy(agent.organization_id, agent)
            await self._broadcast_open_to_org_create(
                agent.organization_id,
                agent.id,
                effective_mode,
            )
        except Exception:
            logger.opt(exception=True).warning(
                "Agent created with degraded access fanout",
                agent_id=str(agent.id),
            )

        try:
            await set_cached_agent(agent)
        except Exception:
            logger.opt(exception=True).warning(
                "Agent created with stale profile cache",
                agent_id=str(agent.id),
            )

        added_skill_uuids = _coerce_uuid_list(agent.enabled_skills)
        if added_skill_uuids:
            try:
                await track_agent_skill_refs(agent.id, added_skill_ids=added_skill_uuids)
            except Exception:
                logger.opt(exception=True).warning(
                    "Agent created with stale skill reference cache",
                    agent_id=str(agent.id),
                )

    async def list_agents(
        self,
        user_id: UUID,
        organization_id: UUID,
        access_mode: AccessMode | None = None,
        group_id: UUID | None = None,
        page: int = 1,
        page_size: int = 50,
        tag_ids: list[UUID] | None = None,
        deleted_only: bool = False,
    ) -> tuple[list[Agent], int]:
        """List agents the user can access.

        ``deleted_only`` swaps the set for the retired rows, which is what the
        builder's deleted group renders; the access filter still applies.
        """
        from sqlalchemy import or_

        from uniffy.core.models.permissions.content_member import ContentMember

        query = select(Agent).where(
            Agent.organization_id == organization_id,
            Agent.is_deleted == deleted_only,
        )

        access_filter = await self.access_query.build_accessible_filter(
            user_id=user_id,
            organization_id=organization_id,
            content_type=self.content_type,
            content_id_column=Agent.id,
            owner_id_column=Agent.owner_id,
            access_mode_column=Agent.access_mode,
            baseline_role_column=Agent.baseline_role,
        )
        query = query.where(access_filter)

        if group_id:
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

        access_filter = await self.access_query.build_accessible_filter(
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
        tag_ids: list[UUID] | None = None,
        model_params: dict | None = None,
        image_params: dict | None = None,
        image_style_prompt: str | None = None,
        integration_connections: dict | None = None,
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

        await require_agents_builder(self.session, user_id, organization_id)

        if is_default is not None and is_default != agent.is_default:
            await OrganizationOperations(self.session).require_org_admin(user_id, organization_id)

        if is_default is not None and is_default and not agent.is_default:
            await self._clear_existing_default(organization_id)

        old_skill_ids = _coerce_uuid_list(agent.enabled_skills)

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
        if model_params is not None:
            _check_model_params(
                primary_model if primary_model is not None else agent.primary_model,
                model_params,
            )
            updates["model_params"] = model_params
            agent.model_params = model_params
        if integration_connections is not None:
            await _validate_integration_connections(
                self.session, organization_id, integration_connections
            )
            updates["integration_connections"] = integration_connections
            agent.integration_connections = integration_connections

        if image_style_prompt is not None:
            check_admin_content(image_style_prompt, "image_style_prompt")
            updates["image_style_prompt"] = image_style_prompt
            agent.image_style_prompt = image_style_prompt
        if image_params is not None:
            _check_image_params(
                image_model if image_model is not None else agent.image_model,
                image_params,
            )
            updates["image_params"] = image_params
            agent.image_params = image_params

        if image_model is not None and image_params is None and agent.image_params:
            kept = _strip_invalid_image_params(image_model, agent.image_params)
            if kept != agent.image_params:
                logger.warning(
                    "Dropped image_params invalid for the new image model",
                    agent_id=str(agent_id),
                    model=image_model,
                    dropped=sorted(set(agent.image_params) - set(kept)),
                )
                updates["image_params"] = kept
                agent.image_params = kept

        if primary_model is not None and model_params is None and agent.model_params:
            kept = _strip_invalid_params(primary_model, agent.model_params)
            if kept != agent.model_params:
                logger.warning(
                    "Dropped model_params invalid for the new primary model",
                    agent_id=str(agent_id),
                    model=primary_model,
                    dropped=sorted(set(agent.model_params) - set(kept)),
                )
                updates["model_params"] = kept
                agent.model_params = kept

        if clear_primary_provider_key:
            agent.primary_provider_key_id = None
            updates["primary_provider_key_id"] = None
        if clear_image_provider_key:
            agent.image_provider_key_id = None
            updates["image_provider_key_id"] = None

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

        new_skill_ids = _coerce_uuid_list(agent.enabled_skills)
        added_skill_ids = [s for s in new_skill_ids if s not in old_skill_ids]
        removed_skill_ids = [s for s in old_skill_ids if s not in new_skill_ids]
        if added_skill_ids or removed_skill_ids:
            await track_agent_skill_refs(
                agent_id,
                added_skill_ids=added_skill_ids,
                removed_skill_ids=removed_skill_ids,
            )

        for sid in added_skill_ids:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AGENT_SKILL_ENABLED,
                resource_type=AuditResourceType.AGENT,
                resource_id=agent_id,
                details={"skill_id": str(sid)},
            )
        for sid in removed_skill_ids:
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AGENT_SKILL_DISABLED,
                resource_type=AuditResourceType.AGENT,
                resource_id=agent_id,
                details={"skill_id": str(sid)},
            )
        if added_skill_ids or removed_skill_ids:
            await self.session.commit()

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
            }
        }
        if audit_fields:
            serializable = {}
            for k, v in audit_fields.items():
                if isinstance(v, UUID):
                    serializable[k] = str(v)
                elif k == "soul_prompt" and isinstance(v, str) and len(v) > 200:  # noqa: PLR2004
                    serializable[k] = v[:200] + "..."
                else:
                    serializable[k] = v
            await write_audit_event(
                self.session,
                organization_id=organization_id,
                actor_user_id=user_id,
                action=Action.AGENT_UPDATED,
                resource_type=AuditResourceType.AGENT,
                resource_id=agent_id,
                details={"changes": serializable},
            )
            await self.session.commit()

        return agent

    async def upload_avatar(
        self,
        *,
        storage: ObjectStorage,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
        image_data: bytes,
        filename: str,
    ) -> Agent:
        """Upload and set an agent avatar."""
        agent = await self.get_by_id(user_id, organization_id, agent_id)
        await require_agents_builder(self.session, user_id, organization_id)

        if agent.avatar_key:
            await s3_delete_avatar(storage, agent.avatar_key)

        avatar_key = await s3_upload_avatar(
            storage,
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
        storage: ObjectStorage,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> Agent:
        """Delete an agent avatar."""
        agent = await self.get_by_id(user_id, organization_id, agent_id)
        await require_agents_builder(self.session, user_id, organization_id)

        if agent.avatar_key:
            await s3_delete_avatar(storage, agent.avatar_key)
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
        """Retire an agent: the row survives, everything that makes it act stops.

        The row is also the display record for every chat message the agent
        sent (``SenderResolver`` resolves agents by id without filtering
        deletion), so it is never removed here.
        """
        agent = await self._fetch_by_id(agent_id, organization_id)
        if agent is None:
            raise NotFoundError("Agent", agent_id)

        await require_agents_builder(self.session, user_id, organization_id)

        old_skill_ids = _coerce_uuid_list(agent.enabled_skills)

        agent.is_deleted = True
        agent.deleted_at = datetime.now(UTC)
        agent.is_default = False

        # Schedules would otherwise keep firing against an agent that can no
        # longer answer, one failed run per tick. Rows stay for the history.
        await self.session.execute(
            update(AgentCronTask)
            .where(
                AgentCronTask.agent_id == agent_id,
                AgentCronTask.organization_id == organization_id,
            )
            .values(is_enabled=False)
        )

        # The org-for-one-agent memory tier has no audience without its agent.
        # Entries the agent WROTE into shared buckets stay: created_by_agent_id
        # is provenance, and the audience owns them.
        await self.session.execute(
            delete(AgentMemory).where(
                AgentMemory.organization_id == organization_id,
                AgentMemory.agent_id == agent_id,
            )
        )

        await self.session.commit()

        await self.search_indexer.remove(
            build_content_urn(self.content_type, agent_id), organization_id
        )
        await self.session.commit()

        await invalidate_agent_profile(agent_id)
        await invalidate_cached_agent(agent_id)
        await invalidate_cached_agent_skills(agent_id)
        await invalidate_memory_index(organization_id, MemoryScopeRef.org(agent_id))
        if old_skill_ids:
            await track_agent_skill_refs(agent_id, removed_skill_ids=old_skill_ids)

    async def restore_agent(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        agent_id: UUID,
    ) -> Agent:
        """Bring a deleted agent back. Automations stay disabled deliberately.

        A restore that silently resumed cron schedules would start runs nobody
        asked for, so re-enabling one is a separate, explicit act.
        """
        agent = await self._fetch_by_id(agent_id, organization_id)
        if agent is None:
            raise NotFoundError("Agent", agent_id)

        await require_agents_builder(self.session, user_id, organization_id)

        if not agent.is_deleted:
            return agent

        agent.is_deleted = False
        agent.deleted_at = None
        await self.session.commit()
        await self.session.refresh(agent)

        await self._index_for_search(agent)
        await set_cached_agent(agent)
        await invalidate_agent_profile(agent_id)
        skill_ids = _coerce_uuid_list(agent.enabled_skills)
        if skill_ids:
            await track_agent_skill_refs(agent_id, added_skill_ids=skill_ids)

        return agent

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
register_manage_override(ContentType.AGENT, is_agents_builder)
