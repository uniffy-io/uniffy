"""Resolve the image-generation configuration for one run.

Layers agent defaults under any per-conversation override, clamps to the org
ceiling, and produces the tool schema the model gets to see. Nothing here
decrypts a credential: the provider comes from the catalog, so an agent with no
image tool costs one dict lookup.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.domains.agents.providers.catalog import (
    clamp_image_params,
    provider_for_model,
    strip_unsupported_image_params,
)
from uniffy.domains.agents.runtime.settings.operations import get_runtime_settings
from uniffy.domains.agents.tools.builtin.images import (
    build_image_tool_schema,
    generate_image,
)

IMAGE_TOOL = generate_image.name


@dataclass(frozen=True)
class ResolvedImageConfig:
    """Effective image knobs plus the ceiling the tool re-applies to call args."""

    provider: str
    model: str
    params: dict
    max_resolution: str | None
    max_quality: str | None


async def resolve_image_config(
    session: AsyncSession,
    agent: Agent,
    *,
    organization_id: UUID,
    override_params: dict | None = None,
) -> ResolvedImageConfig | None:
    """Effective image config for a run, or ``None`` when the agent generates none."""
    if IMAGE_TOOL not in (agent.enabled_tools or []) or not agent.image_model:
        return None
    provider = provider_for_model(agent.image_model)
    if provider is None:
        return None

    merged = {**(agent.image_params or {}), **(override_params or {})}
    settings = await get_runtime_settings(session, organization_id)
    clamped = clamp_image_params(
        merged,
        max_resolution=settings.image_max_resolution,
        max_quality=settings.image_max_quality,
    )
    return ResolvedImageConfig(
        provider=provider,
        model=agent.image_model,
        params=strip_unsupported_image_params(provider, agent.image_model, clamped),
        max_resolution=settings.image_max_resolution,
        max_quality=settings.image_max_quality,
    )


def apply_image_tool_schema(
    schemas: list[dict] | None,
    config: ResolvedImageConfig | None,
) -> list[dict] | None:
    """Swap the static image-tool schema for the effective model's.

    Without a resolved image model the static schema stands: the tool then
    fails with "no image model configured", which is the honest error.
    """
    if not schemas or config is None:
        return schemas
    for schema in schemas:
        if schema.get("name") == IMAGE_TOOL:
            schema["input_schema"] = build_image_tool_schema(config.provider, config.model)
            break
    return schemas
