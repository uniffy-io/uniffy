"""Agents-domain Valkey cache helpers.

Caches the read-heavy runtime pre-flight rows (agent, skills, prompt,
provider-key metadata). Reverse-index sets `tag:skill:{id}` and
`tag:prompt:{id}` hold agent ids that depend on each shared row so a
mutation can SMEMBERS + bulk-DEL the dependent agent caches.

Provider-key entries hold non-secret routing metadata only; decrypted
credentials live in the in-process provider-client LRU. The pubsub
channel `provider_keys:invalidate:{key_id}` mirrors the Valkey wipe so
every pod drops its LRU entry on the same signal.
"""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.skill import AgentSkill
from uniffy.core.types import AccessMode, ContentRole
from uniffy.core.valkey.cache import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_get_or_set_locked,
    cache_invalidate_by_tag,
    cache_invalidate_many,
    cache_set,
)
from uniffy.core.valkey.ops import _get_ops_client

logger = logger.bind(component="cache")

_AGENT_TTL_SECONDS = 900
_SKILLS_TTL_SECONDS = 900
_PROMPT_TTL_SECONDS = 900


def _agent_key(agent_id: UUID) -> str:
    return f"agent:{agent_id}"


def _agent_skills_key(agent_id: UUID) -> str:
    return f"agent:{agent_id}:skills"


def _agent_prompt_key(agent_id: UUID) -> str:
    return f"agent:{agent_id}:prompt"


def _skill_tag_key(skill_id: UUID) -> str:
    return f"tag:skill:{skill_id}"


def _prompt_tag_key(prompt_id: UUID) -> str:
    return f"tag:prompt:{prompt_id}"


def _org_skills_tag(organization_id: UUID) -> str:
    """Org-wide tag covering always-active skills (per-skill index can't see them)."""
    return f"org_skills:{organization_id}"


def provider_key_invalidate_channel(key_id: UUID) -> str:
    return f"provider_keys:invalidate:{key_id}"


def _serialize_agent(agent: Agent) -> dict[str, Any]:
    return {
        "id": str(agent.id),
        "organization_id": str(agent.organization_id),
        "owner_id": str(agent.owner_id),
        "name": agent.name,
        "soul_prompt": agent.soul_prompt,
        "primary_model": agent.primary_model,
        "fallback_models": list(agent.fallback_models or []),
        "model_params": dict(agent.model_params or {}),
        "image_model": agent.image_model,
        "primary_provider_key_id": (
            str(agent.primary_provider_key_id)
            if agent.primary_provider_key_id
            else None
        ),
        "image_provider_key_id": (
            str(agent.image_provider_key_id)
            if agent.image_provider_key_id
            else None
        ),
        "prompt_id": str(agent.prompt_id) if agent.prompt_id else None,
        "enabled_tools": list(agent.enabled_tools or []),
        "enabled_skills": list(agent.enabled_skills or []),
        "avatar_emoji": agent.avatar_emoji,
        "avatar_key": agent.avatar_key,
        "theme_color": agent.theme_color,
        "is_default": agent.is_default,
        "access_mode": (
            agent.access_mode.value if agent.access_mode is not None else None
        ),
        "baseline_role": (
            agent.baseline_role.value if agent.baseline_role is not None else None
        ),
        "is_deleted": agent.is_deleted,
        "deleted_at": (
            agent.deleted_at.isoformat() if agent.deleted_at else None
        ),
        "created_at": (
            agent.created_at.isoformat() if agent.created_at else None
        ),
        "updated_at": (
            agent.updated_at.isoformat() if agent.updated_at else None
        ),
    }


def _deserialize_agent(payload: dict[str, Any]) -> Agent:
    """Return a detached, read-only `Agent` rebuilt from a cached payload."""
    return Agent(
        id=UUID(payload["id"]),
        organization_id=UUID(payload["organization_id"]),
        owner_id=UUID(payload["owner_id"]),
        name=payload["name"],
        soul_prompt=payload["soul_prompt"],
        primary_model=payload["primary_model"],
        fallback_models=payload.get("fallback_models") or [],
        model_params=payload.get("model_params") or {},
        image_model=payload.get("image_model", ""),
        primary_provider_key_id=(
            UUID(payload["primary_provider_key_id"])
            if payload.get("primary_provider_key_id")
            else None
        ),
        image_provider_key_id=(
            UUID(payload["image_provider_key_id"])
            if payload.get("image_provider_key_id")
            else None
        ),
        prompt_id=(
            UUID(payload["prompt_id"]) if payload.get("prompt_id") else None
        ),
        enabled_tools=payload.get("enabled_tools") or [],
        enabled_skills=payload.get("enabled_skills") or [],
        avatar_emoji=payload.get("avatar_emoji", ""),
        avatar_key=payload.get("avatar_key"),
        theme_color=payload.get("theme_color", ""),
        is_default=payload.get("is_default", False),
        access_mode=(
            AccessMode(payload["access_mode"])
            if payload.get("access_mode") is not None
            else None
        ),
        baseline_role=(
            ContentRole(payload["baseline_role"])
            if payload.get("baseline_role") is not None
            else None
        ),
        is_deleted=payload.get("is_deleted", False),
        deleted_at=(
            datetime.fromisoformat(payload["deleted_at"])
            if payload.get("deleted_at")
            else None
        ),
        created_at=(
            datetime.fromisoformat(payload["created_at"])
            if payload.get("created_at")
            else None
        ),
        updated_at=(
            datetime.fromisoformat(payload["updated_at"])
            if payload.get("updated_at")
            else None
        ),
    )


async def get_cached_agent(agent_id: UUID) -> Agent | None:
    """Return a transient ``Agent`` from cache, or ``None`` on miss."""
    cached = await cache_get(_agent_key(agent_id))
    if cached is CACHE_MISS or cached is None:
        return None
    return _deserialize_agent(cached)


async def set_cached_agent(agent: Agent) -> None:
    """Cache an Agent row. Soft-deleted agents are not seeded."""
    if agent.is_deleted:
        return
    await cache_set(
        _agent_key(agent.id),
        _serialize_agent(agent),
        ttl=_AGENT_TTL_SECONDS,
    )


async def invalidate_cached_agent(agent_id: UUID) -> None:
    await cache_delete(_agent_key(agent_id))


async def fetch_agent_row(
    session: AsyncSession,
    agent_id: UUID,
    organization_id: UUID,
) -> Agent | None:
    """Stampede-protected cache-or-load for an Agent row.

    Soft-deleted rows stay out of the cache so the next reader re-checks PG.
    """

    async def _load() -> dict[str, Any] | None:
        result = await session.execute(
            select(Agent).where(
                Agent.id == agent_id,
                Agent.organization_id == organization_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is None or row.is_deleted:
            return None
        return _serialize_agent(row)

    payload = await cache_get_or_set_locked(
        _agent_key(agent_id),
        _load,
        ttl=_AGENT_TTL_SECONDS,
    )
    if payload is None:
        return None
    agent = _deserialize_agent(payload)
    if agent.organization_id != organization_id:
        return None
    return agent


def _serialize_skill(skill: AgentSkill) -> dict[str, Any]:
    return {
        "id": str(skill.id),
        "name": skill.name,
        "display_name": skill.display_name,
        "description": skill.description,
        "content": skill.content,
        "source": skill.source,
        "always_active": skill.always_active,
        "when_to_use": getattr(skill, "when_to_use", "") or "",
        "requires_tools": list(getattr(skill, "requires_tools", None) or []),
        "requires_context": list(getattr(skill, "requires_context", None) or []),
        "latest_version_number": int(getattr(skill, "latest_version_number", 1) or 1),
    }


def _deserialize_skill(payload: dict[str, Any]) -> AgentSkill:
    return AgentSkill(
        id=UUID(payload["id"]),
        organization_id=None,
        name=payload["name"],
        display_name=payload["display_name"],
        description=payload.get("description", ""),
        content=payload.get("content", ""),
        source=payload["source"],
        owner_id=None,
        always_active=payload.get("always_active", False),
        when_to_use=payload.get("when_to_use", ""),
        requires_tools=payload.get("requires_tools") or [],
        requires_context=payload.get("requires_context") or [],
        latest_version_number=payload.get("latest_version_number", 1),
    )


async def get_cached_agent_skills(
    agent_id: UUID,
) -> list[AgentSkill] | None:
    """Return cached, ordered skills for an agent or ``None`` on miss."""
    cached = await cache_get(_agent_skills_key(agent_id))
    if cached is CACHE_MISS or cached is None:
        return None
    skills = cached.get("skills") if isinstance(cached, dict) else None
    if not isinstance(skills, list):
        return None
    return [_deserialize_skill(s) for s in skills]


async def set_cached_agent_skills(
    agent_id: UUID,
    organization_id: UUID,
    skills: list[AgentSkill],
) -> None:
    payload = {"skills": [_serialize_skill(s) for s in skills]}
    await cache_set(
        _agent_skills_key(agent_id),
        payload,
        ttl=_SKILLS_TTL_SECONDS,
        tags=[_org_skills_tag(organization_id)],
    )


async def invalidate_cached_agent_skills(agent_id: UUID) -> None:
    await cache_delete(_agent_skills_key(agent_id))


async def fetch_agent_skills(
    skill_ops,
    *,
    agent_id: UUID,
    organization_id: UUID,
    enabled_skill_ids: list[str],
) -> list[AgentSkill]:
    """Stampede-protected cache-or-load for resolved agent skills."""

    async def _load() -> dict[str, Any] | None:
        skills = await skill_ops.get_skills_for_agent(
            organization_id=organization_id,
            enabled_skill_ids=enabled_skill_ids,
        )
        return {"skills": [_serialize_skill(s) for s in skills]}

    payload = await cache_get_or_set_locked(
        _agent_skills_key(agent_id),
        _load,
        ttl=_SKILLS_TTL_SECONDS,
        tags=[_org_skills_tag(organization_id)],
    )
    if not payload:
        return []
    raw = payload.get("skills") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []
    return [_deserialize_skill(s) for s in raw]


async def get_cached_agent_prompt(agent_id: UUID) -> str | None:
    """Return cached resolved prompt content, or `None` on miss/no-prompt."""
    cached = await cache_get(_agent_prompt_key(agent_id))
    if cached is CACHE_MISS:
        return None
    if cached is None:
        return None
    content = cached.get("content")
    return content if isinstance(content, str) else None


async def set_cached_agent_prompt(
    agent_id: UUID,
    content: str | None,
) -> None:
    payload: dict[str, Any] | None
    payload = {"content": content} if content is not None else None
    await cache_set(
        _agent_prompt_key(agent_id),
        payload,
        ttl=_PROMPT_TTL_SECONDS,
    )


async def invalidate_cached_agent_prompt(agent_id: UUID) -> None:
    await cache_delete(_agent_prompt_key(agent_id))


async def fetch_agent_prompt(
    session: AsyncSession,
    *,
    agent_id: UUID,
    prompt_id: UUID | None,
) -> str | None:
    """Stampede-protected cache-or-load for the resolved prompt."""
    if prompt_id is None:
        return None

    async def _load() -> dict[str, Any] | None:
        from uniffy.domains.agents.prompts.operations import PromptOperations

        try:
            prompt_ops = PromptOperations(session)
            prompt = await prompt_ops.get_prompt_by_id(prompt_id)
        except Exception:
            logger.opt(exception=True).warning("Failed to resolve prompt template")
            return None
        if not prompt or not prompt.content:
            return None
        return {"content": prompt.content}

    payload = await cache_get_or_set_locked(
        _agent_prompt_key(agent_id),
        _load,
        ttl=_PROMPT_TTL_SECONDS,
    )
    if payload is None:
        return None
    content = payload.get("content") if isinstance(payload, dict) else None
    return content if isinstance(content, str) else None


async def _set_add(set_key: str, member: str, ttl: int) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        pipe = client.pipeline(transaction=False)
        pipe.sadd(set_key, member)
        pipe.expire(set_key, ttl)
        await pipe.execute()
    except Exception:
        logger.warning(
            f"Cache reverse-index SADD failed for {set_key}", component="cache"
        )


async def _set_remove(set_key: str, member: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.srem(set_key, member)
    except Exception:
        logger.warning(
            f"Cache reverse-index SREM failed for {set_key}", component="cache"
        )


async def _set_members(set_key: str) -> list[str]:
    client = _get_ops_client()
    if client is None:
        return []
    try:
        members = await client.smembers(set_key)
    except Exception:
        logger.warning(
            f"Cache reverse-index SMEMBERS failed for {set_key}",
            component="cache",
        )
        return []
    out: list[str] = []
    for m in members:
        out.append(m.decode() if isinstance(m, bytes | bytearray) else str(m))
    return out


async def track_agent_skill_refs(
    agent_id: UUID,
    *,
    added_skill_ids: list[UUID] | None = None,
    removed_skill_ids: list[UUID] | None = None,
) -> None:
    """Update the `tag:skill:{sid}` reverse-index sets for an agent.

    The set TTL is refreshed on every SADD so the index can't expire
    while the agent still references the skill.
    """
    if added_skill_ids:
        for sid in added_skill_ids:
            await _set_add(
                _skill_tag_key(sid), str(agent_id), _SKILLS_TTL_SECONDS
            )
    if removed_skill_ids:
        for sid in removed_skill_ids:
            await _set_remove(_skill_tag_key(sid), str(agent_id))


async def track_agent_prompt_ref(
    agent_id: UUID,
    *,
    old_prompt_id: UUID | None,
    new_prompt_id: UUID | None,
) -> None:
    """Update the `tag:prompt:{pid}` reverse-index; idempotent on no-op."""
    if old_prompt_id == new_prompt_id:
        return
    if old_prompt_id is not None:
        await _set_remove(_prompt_tag_key(old_prompt_id), str(agent_id))
    if new_prompt_id is not None:
        await _set_add(
            _prompt_tag_key(new_prompt_id),
            str(agent_id),
            _PROMPT_TTL_SECONDS,
        )


async def invalidate_agents_using_skill(
    skill_id: UUID,
    *,
    drop_tag_set: bool = False,
) -> None:
    """Invalidate the skills cache for every agent referencing `skill_id`.

    `drop_tag_set=True` also DELs the tag set itself (skill row delete).
    """
    set_key = _skill_tag_key(skill_id)
    members = await _set_members(set_key)
    if members:
        keys = [
            _agent_skills_key(UUID(aid)) for aid in members if _is_uuid(aid)
        ]
        if keys:
            await cache_invalidate_many(*keys)
    if drop_tag_set:
        client = _get_ops_client()
        if client is not None:
            try:
                await client.delete(set_key)
            except Exception:
                logger.warning(
                    f"Cache reverse-index DEL failed for {set_key}",
                    component="cache",
                )


async def invalidate_org_always_active_skills(organization_id: UUID) -> None:
    """Fan-invalidate every agent's skills cache via the org tag.

    Always-active skills are injected for every agent, so per-skill reverse
    indices miss them; only the org tag covers all agents at once.
    """
    await cache_invalidate_by_tag(_org_skills_tag(organization_id))


async def invalidate_agents_using_prompt(
    prompt_id: UUID,
    *,
    drop_tag_set: bool = False,
) -> None:
    """Invalidate the prompt cache for every agent referencing `prompt_id`."""
    set_key = _prompt_tag_key(prompt_id)
    members = await _set_members(set_key)
    if members:
        keys = [
            _agent_prompt_key(UUID(aid)) for aid in members if _is_uuid(aid)
        ]
        if keys:
            await cache_invalidate_many(*keys)
    if drop_tag_set:
        client = _get_ops_client()
        if client is not None:
            try:
                await client.delete(set_key)
            except Exception:
                logger.warning(
                    f"Cache reverse-index DEL failed for {set_key}",
                    component="cache",
                )


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except (ValueError, AttributeError):
        return False
    return True


_MEMORY_INDEX_TTL_SECONDS = 300
MEMORY_INDEX_LIMIT = 50


def _memory_index_key(agent_id: UUID, scope: str, subject: str) -> str:
    return f"agentmem:{agent_id}:{scope}:{subject}"


async def fetch_memory_index(
    session: AsyncSession,
    *,
    agent_id: UUID,
    organization_id: UUID,
    scope_ref,
) -> dict[str, Any]:
    """Stampede-protected cache-or-load of one scope's rendered memory index.

    Payload: pinned entries carry full content (they inject verbatim);
    index entries carry key/category/description only, capped at
    MEMORY_INDEX_LIMIT with `total` preserving the real row count.
    """
    from sqlalchemy import func

    from uniffy.core.models.agents.memory import AgentMemory
    from uniffy.domains.agents.memories.scope import scope_filters

    async def _load() -> dict[str, Any]:
        filters = scope_filters(agent_id, organization_id, scope_ref)
        pinned_rows = (
            await session.execute(
                select(
                    AgentMemory.key, AgentMemory.category, AgentMemory.content
                )
                .where(*filters, AgentMemory.pinned.is_(True))  # type: ignore[union-attr]
                .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
            )
        ).all()
        index_rows = (
            await session.execute(
                select(
                    AgentMemory.key, AgentMemory.category, AgentMemory.description
                )
                .where(*filters, AgentMemory.pinned.is_(False))  # type: ignore[union-attr]
                .order_by(AgentMemory.importance.desc(), AgentMemory.updated_at.desc())
                .limit(MEMORY_INDEX_LIMIT)
            )
        ).all()
        total = (
            await session.execute(
                select(func.count()).select_from(AgentMemory).where(*filters)
            )
        ).scalar() or 0
        return {
            "pinned": [
                {"key": k, "category": c, "content": body}
                for k, c, body in pinned_rows
            ],
            "index": [
                {"key": k, "category": c, "description": d}
                for k, c, d in index_rows
            ],
            "total": int(total),
        }

    payload = await cache_get_or_set_locked(
        _memory_index_key(agent_id, scope_ref.scope.value, scope_ref.cache_subject),
        _load,
        ttl=_MEMORY_INDEX_TTL_SECONDS,
    )
    if not isinstance(payload, dict):
        return {"pinned": [], "index": [], "total": 0}
    return payload


async def invalidate_memory_index(
    agent_id: UUID, scope: str, subject: str
) -> None:
    await cache_delete(_memory_index_key(agent_id, scope, subject))


async def publish_provider_key_invalidation(key_id: UUID) -> None:
    """Publish the cross-pod signal that drops this key's cached client.

    The ``ProviderClientLRU`` (decrypted credential + SDK client) is the only
    place a key's client is cached now that the model list is catalog-served;
    every pod's subscriber drops its entry on this signal. Call after any
    mutation to the key (add / validate / toggle / remove).
    """
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.publish(
            provider_key_invalidate_channel(key_id),
            json.dumps({"key_id": str(key_id)}),
        )
    except Exception:
        logger.warning(
            f"Provider-key invalidate publish failed for {key_id}",
            component="cache",
        )
