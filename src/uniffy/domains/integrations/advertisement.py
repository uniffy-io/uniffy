"""Connection-aware integration tool advertisement without credential access."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.domains.agents.tools.registry import from_api_name, get_tool_registry
from uniffy.domains.integrations.cache import get_org_connections_meta
from uniffy.domains.integrations.registry import get_integration_registry


def _provider_prefix(schema_name: str) -> str:
    return from_api_name(schema_name).split(".", 1)[0]


async def filter_integration_tool_schemas(
    session: AsyncSession,
    organization_id: UUID,
    schemas: list[dict] | None,
) -> list[dict] | None:
    """Drop integration tool schemas the org cannot currently use."""
    if not schemas:
        return schemas
    registry = get_integration_registry()
    if not any(registry.get(_provider_prefix(s.get("name", ""))) for s in schemas):
        return schemas

    meta = await get_org_connections_meta(session, organization_id)
    usable: set[str] = set()
    writable: set[str] = set()
    for m in meta:
        if not (m.get("is_valid") and m.get("is_enabled")):
            continue
        provider_id = m.get("provider", "")
        usable.add(provider_id)
        if m.get("allow_writes"):
            writable.add(provider_id)

    tool_registry = get_tool_registry()
    filtered: list[dict] = []
    for schema in schemas:
        prefix = _provider_prefix(schema.get("name", ""))
        if registry.get(prefix) is None:
            filtered.append(schema)
            continue
        if prefix not in usable:
            continue
        tool_def = tool_registry.get(from_api_name(schema.get("name", "")))
        if tool_def is not None and not tool_def.read_only and prefix not in writable:
            continue
        filtered.append(schema)
    return filtered


def has_advertised_integration_tools(schemas: list[dict] | None) -> bool:
    if not schemas:
        return False
    registry = get_integration_registry()
    return any(registry.get(_provider_prefix(s.get("name", ""))) for s in schemas)
