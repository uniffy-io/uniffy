"""Validate explicit chat workflows before accepting their triggering message."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.auth.permissions.helpers import require_view
from uniffy.core.models.agents.agent import Agent
from uniffy.core.models.chat.channel import ChatChannel
from uniffy.core.models.chat.message import ChatMessage, SenderType
from uniffy.core.types import ContentType
from uniffy.domains.agents.bridge.mentions import detect_agent_mentions
from uniffy.domains.agents.cache import fetch_agent_row
from uniffy.domains.agents.runtime.images.config import apply_image_tool_schema, resolve_image_config
from uniffy.domains.agents.runtime.tooling import allowed_tool_names, resolve_tool_schemas
from uniffy.domains.agents.skills.resolution import (
    SkillInvocationError,
    SkillInvocationFailure,
    SkillSurface,
    resolve_skill_invocation,
)
from uniffy.domains.agents.tools.registry import get_tool_registry
from uniffy.domains.integrations.advertisement import filter_integration_tool_schemas


def parse_invoked_skill_id(metadata: dict | None) -> UUID | None:
    if metadata is None or "invoked_skill_id" not in metadata:  # noqa: PLR2004 - chat wire key
        return None
    try:
        return UUID(str(metadata["invoked_skill_id"]))
    except ValueError as exc:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE) from exc


async def validate_chat_skill_invocation(
    session: AsyncSession, message: ChatMessage, channel: ChatChannel
) -> None:
    skill_id = parse_invoked_skill_id(message.message_metadata)
    if skill_id is None:
        return
    if message.sender_type != SenderType.USER:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)
    targets = await detect_agent_mentions(session, message, channel)
    if len(targets) != 1:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)
    agent_id = targets[0].agent_id
    policy = (
        await session.execute(
            select(Agent.owner_id, Agent.access_mode, Agent.baseline_role).where(
                Agent.id == agent_id,
                Agent.organization_id == channel.organization_id,
                Agent.is_deleted.is_(False),
            )
        )
    ).one_or_none()
    if policy is None:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)
    await require_view(
        PermissionChecker(session),
        message.sender_id,
        channel.organization_id,
        ContentType.AGENT,
        agent_id,
        owner_id=policy.owner_id,
        access_mode=policy.access_mode,
        baseline_role=policy.baseline_role,
    )
    agent = await fetch_agent_row(session, agent_id, channel.organization_id)
    if agent is None:
        raise SkillInvocationError(SkillInvocationFailure.UNAVAILABLE)
    schemas = resolve_tool_schemas(get_tool_registry(), agent.enabled_tools or [])
    config = await resolve_image_config(session, agent, organization_id=channel.organization_id)
    schemas = apply_image_tool_schema(schemas, config)
    schemas = await filter_integration_tool_schemas(session, channel.organization_id, schemas)
    await resolve_skill_invocation(
        session,
        organization_id=channel.organization_id,
        enabled_skill_ids=agent.enabled_skills or [],
        invoked_skill_id=skill_id,
        surface=SkillSurface.CHAT,
        executable_tools=allowed_tool_names(schemas),
    )
