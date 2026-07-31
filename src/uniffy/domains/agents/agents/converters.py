"""Proto <-> domain converters for the agents domain."""

import json

from uniffy_proto.agents.v1.agents_pb2 import AgentInfo, ToolInfo
from uniffy_proto.agents.v1.agents_pb2 import AgentTemplate as AgentTemplateProto

from uniffy.core.avatars import get_avatar_url
from uniffy.core.converters import datetime_to_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.agents.agent import Agent
from uniffy.core.types import AccessMode, ContentRole
from uniffy.domains.agents.templates import AgentTemplate
from uniffy.domains.agents.tools.catalog import ToolCatalogEntry
from uniffy.domains.tags import Tag
from uniffy.domains.tags.converters import tag_to_proto


def agent_to_proto(
    agent: Agent,
    user_role: ContentRole | None = None,
    tags: list[Tag] | None = None,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
) -> AgentInfo:
    """Convert an :class:`Agent` row to its proto representation.

    Set ``user_role`` when the proto travels to the frontend so the UI can
    render the correct edit/share affordances; omit for internal callers.
    """
    avatar_url = get_avatar_url(
        agent.id,
        agent.avatar_key,
        size="lg",
        url_prefix="/api/agents/avatars",
    )

    resolved_mode = (
        effective_access_mode if effective_access_mode is not None else agent.access_mode
    )
    resolved_baseline = (
        effective_baseline_role
        if effective_baseline_role is not None
        else agent.baseline_role
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
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        avatar_key=avatar_url,
        image_model=agent.image_model or "",
        primary_provider_key_id=(
            str(agent.primary_provider_key_id) if agent.primary_provider_key_id else ""
        ),
        image_provider_key_id=(
            str(agent.image_provider_key_id) if agent.image_provider_key_id else ""
        ),
        model_params=json.dumps(agent.model_params or {}),
        image_params=json.dumps(agent.image_params or {}),
        image_style_prompt=agent.image_style_prompt or "",
        integration_connections=json.dumps(agent.integration_connections or {}),
        is_deleted=agent.is_deleted,
    )

    if agent.deleted_at is not None:
        proto.deleted_at.CopyFrom(datetime_to_timestamp(agent.deleted_at))

    if resolved_baseline is not None:
        proto.baseline_role = content_role_to_proto(resolved_baseline)
    if user_role is not None:
        proto.user_role = content_role_to_proto(user_role)

    if tags:
        proto.tags.extend(tag_to_proto(t) for t in tags)

    return proto


def agent_template_to_proto(
    template: AgentTemplate,
    enabled_skill_ids: list[str],
) -> AgentTemplateProto:
    return AgentTemplateProto(
        key=template.key,
        name=template.name,
        emoji=template.emoji,
        description=template.description,
        soul_prompt=template.soul_prompt,
        enabled_tools=list(template.enabled_tools),
        enabled_skill_ids=enabled_skill_ids,
        recommended_model=template.recommended_model,
        recommended_image_model=template.recommended_image_model,
    )


def tool_catalog_entry_to_proto(entry: ToolCatalogEntry) -> ToolInfo:
    return ToolInfo(
        name=entry.name,
        display_name=entry.display_name,
        description=entry.description,
        group=entry.group,
        category=entry.category,
        destructive=entry.destructive,
        requires_connection=entry.requires_connection,
    )
