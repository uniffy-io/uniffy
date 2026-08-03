"""Seed LLM provider keys from env vars and one agent per key."""

from __future__ import annotations

import os
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.crypto import OrgCipher
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.agents.provider_key import ProviderKey
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.agents.agents.operations import AgentOperations
from uniffy.domains.agents.providers.utils import build_key_hint
from uniffy.domains.agents.tools.definitions import CATEGORY_PLATFORM
from uniffy.domains.agents.tools.registry import get_tool_registry
from uniffy.scripts.demo_company.context import DemoContext, DomainResult
from uniffy.scripts.demo_company.loader import AgentsContent, AgentSpec

logger = logger.bind(component="scripts.demo_company.agents")


async def seed_agents(ctx: DemoContext, content: AgentsContent) -> DomainResult:
    result = DomainResult()
    if not content.agents:
        return result

    for spec in content.agents:
        credential = os.getenv(spec.env_var, "").strip()
        if not credential:
            logger.warning(f"{spec.env_var} not set, skipping {spec.name}")
            result.skipped += 1
            continue

        key_id = await _ensure_provider_key(ctx, spec, credential, result)
        if key_id is None and not ctx.dry_run:
            continue
        await _ensure_agent(ctx, spec, key_id, content.soul_prompt, result)

    return result


async def _ensure_provider_key(
    ctx: DemoContext,
    spec: AgentSpec,
    credential: str,
    result: DomainResult,
) -> UUID | None:
    existing = (
        await ctx.session.execute(
            select(ProviderKey).where(
                ProviderKey.organization_id == ctx.organization_id,
                ProviderKey.provider == spec.provider,
                ProviderKey.label == spec.key_label,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        result.skipped += 1
        return existing.id

    if ctx.dry_run:
        logger.info(f"[dry-run] provider key {spec.key_label} ({spec.provider})")
        result.created += 1
        return None

    # Stored without the live probe: a fresh stack may boot offline and the
    # dev key must not land disabled because of that.
    encrypted = await OrgCipher(ctx.session).encrypt(ctx.organization_id, credential)
    key = ProviderKey(
        organization_id=ctx.organization_id,
        provider=spec.provider,
        label=spec.key_label,
        encrypted_credential=encrypted,
        key_hint=build_key_hint(credential),
        is_valid=True,
        is_enabled=True,
        created_by=ctx.actor_id,
    )
    ctx.session.add(key)
    await ctx.session.commit()
    await ctx.session.refresh(key)
    result.created += 1
    logger.info(f"Seeded provider key {spec.key_label} ({spec.provider})")
    return key.id


async def _ensure_agent(
    ctx: DemoContext,
    spec: AgentSpec,
    key_id: UUID | None,
    soul_prompt: str,
    result: DomainResult,
) -> None:
    existing = (
        await ctx.session.execute(
            select(Agent.id).where(
                Agent.organization_id == ctx.organization_id,
                Agent.name == spec.name,
                Agent.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().first()
    if existing is not None:
        result.skipped += 1
        return

    if ctx.dry_run:
        logger.info(f"[dry-run] agent {spec.name} ({spec.model})")
        result.created += 1
        return

    ops = AgentOperations(ctx.session)
    agent = await ops.create_agent(
        user_id=ctx.actor_id,
        organization_id=ctx.organization_id,
        name=spec.name,
        soul_prompt=soul_prompt,
        primary_model=spec.model,
        avatar_emoji=spec.emoji,
        theme_color=spec.color,
        primary_provider_key_id=key_id,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
    )
    await ops.update_agent(
        user_id=ctx.actor_id,
        organization_id=ctx.organization_id,
        agent_id=agent.id,
        enabled_tools=_all_platform_tools(),
    )
    result.created += 1
    logger.info(f"Seeded agent {spec.name} ({spec.model})")


def _all_platform_tools() -> list[str]:
    """Everything built in; integration packs need a live connection to matter."""
    return [
        tool.name
        for tool in get_tool_registry().all()
        if not tool.internal and tool.category == CATEGORY_PLATFORM
    ]
