from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.models.agents.agent import Agent
from uniffy.domains.agents.runtime.images.config import apply_image_tool_schema, resolve_image_config
from uniffy.domains.agents.runtime.tooling import resolve_tool_schemas
from uniffy.domains.agents.tools.registry import get_tool_registry
from uniffy.domains.integrations.advertisement import filter_integration_tool_schemas


async def resolve_executable_tool_schemas(
    session: AsyncSession, *, organization_id: UUID, agent: Agent
) -> list[dict]:
    schemas = resolve_tool_schemas(get_tool_registry(), agent.enabled_tools or [])
    image_config = await resolve_image_config(session, agent, organization_id=organization_id)
    schemas = apply_image_tool_schema(schemas, image_config)
    return await filter_integration_tool_schemas(session, organization_id, schemas) or []
