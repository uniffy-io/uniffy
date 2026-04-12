"""Proto <-> domain converters for the agents domain."""

from uniffy_proto.agents.v1.agents_pb2 import AgentInfo

from uniffy.core.avatars import get_avatar_url
from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.agents.agent import Agent


def agent_to_proto(agent: Agent) -> AgentInfo:
    """Convert an :class:`Agent` row to its proto representation."""
    avatar_url = get_avatar_url(
        agent.id,
        agent.avatar_key,
        size="lg",
        url_prefix="/api/agents/avatars",
    )

    proto = AgentInfo(
        id=str(agent.id),
        organization_id=str(agent.organization_id),
        owner_id=str(agent.owner_id),
        name=agent.name,
        soul_prompt=agent.soul_prompt or "",
        primary_model=agent.primary_model,
        fallback_models=agent.fallback_models or [],
        enabled_tools=agent.enabled_tools or [],
        avatar_emoji=agent.avatar_emoji or "",
        theme_color=agent.theme_color or "",
        is_default=agent.is_default,
        created_at=datetime_to_timestamp(agent.created_at),
        updated_at=datetime_to_timestamp(agent.updated_at),
        enabled_skills=agent.enabled_skills or [],
        access_mode=access_mode_to_proto(agent.access_mode),
        avatar_key=avatar_url,
        image_model=agent.image_model or "",
        primary_provider_key_id=(
            str(agent.primary_provider_key_id) if agent.primary_provider_key_id else ""
        ),
        image_provider_key_id=(
            str(agent.image_provider_key_id) if agent.image_provider_key_id else ""
        ),
        prompt_id=str(agent.prompt_id) if agent.prompt_id else "",
    )

    if agent.baseline_role is not None:
        proto.baseline_role = content_role_to_proto(agent.baseline_role)

    return proto
