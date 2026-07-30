"""Advertise-time filtering and executor-side connection resolution.

The model never sees a dead integration tool; the executor re-resolves at
call time so a raced call degrades to a recoverable structured error.
"""

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.crypto import OrgCipher
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.agents.tools.registry import from_api_name, get_tool_registry
from uniffy.domains.integrations.base import IntegrationAuthError
from uniffy.domains.integrations.cache import get_org_connections_meta
from uniffy.domains.integrations.client_cache import get_integration_client_lru
from uniffy.domains.integrations.http import IntegrationHttpClient
from uniffy.domains.integrations.operations import ConnectionOperations
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


def filter_enabled_tools_for_prompt(
    enabled_tools: list[str],
    schemas: list[dict] | None,
) -> list[str]:
    """Keep the prompt's tool section aligned with the advertised schemas."""
    registry = get_integration_registry()
    advertised = {from_api_name(s.get("name", "")) for s in schemas or []}
    return [
        name
        for name in enabled_tools
        if registry.get(name.split(".", 1)[0]) is None or name in advertised
    ]


def has_advertised_integration_tools(schemas: list[dict] | None) -> bool:
    if not schemas:
        return False
    registry = get_integration_registry()
    return any(registry.get(_provider_prefix(s.get("name", ""))) for s in schemas)


async def resolve_connection_client(
    ctx: ToolContext,
    provider_id: str,
    connection_name: str | None = None,
    *,
    for_write: bool = False,
) -> tuple[dict[str, Any], IntegrationHttpClient]:
    """Resolve the connection a tool call runs through and its cached client.

    An explicit ``connection_name`` wins outright; otherwise the agent's pin
    for the provider is the default. Write tools re-check ``allow_writes``
    here as the backstop behind the schema filter.
    """
    ops = ConnectionOperations(ctx.session)
    pinned_id: UUID | None = None
    if not connection_name:
        pinned = (ctx.integration_connections or {}).get(provider_id)
        if pinned:
            try:
                pinned_id = UUID(str(pinned))
            except ValueError:
                raise ValidationError(
                    "connection",
                    f"The {provider_id} connection pinned to this agent no "
                    f"longer exists; a builder can fix it on the agent's "
                    f"Capabilities tab.",
                ) from None
    meta = await ops.resolve_connection(
        organization_id=ctx.organization_id,
        provider=provider_id,
        name=connection_name or None,
        connection_id=pinned_id,
    )

    if for_write and not meta.get("allow_writes"):
        raise PermissionDeniedError(
            f"write actions on {provider_id} connection '{meta.get('name')}' "
            f"(an org admin must enable writes under Admin > Integrations)"
        )

    connection_id = UUID(meta["id"])
    lru = get_integration_client_lru()
    cached = await lru.get(connection_id)
    if cached is not None:
        _credential, client = cached
    else:
        row = await ops.get_connection_row(connection_id, ctx.organization_id)
        credential = await OrgCipher(ctx.session).decrypt(
            ctx.organization_id, row.encrypted_credential
        )
        provider = get_integration_registry().require_known(provider_id)
        client = provider.build_http_client(credential, row.base_url)
        await lru.set(connection_id, credential, client)

    await ops.touch_last_used(connection_id)
    return meta, client


async def demote_connection_on_auth_error(
    ctx: ToolContext,
    meta: dict[str, Any],
    exc: IntegrationAuthError,
) -> None:
    """Mark the connection invalid after the upstream rejected its credential."""
    await ConnectionOperations(ctx.session).mark_connection_invalid(
        UUID(meta["id"]), ctx.organization_id, str(exc)
    )
