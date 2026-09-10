"""Resolve integration credentials at execution time and demote rejected connections."""

from typing import Any
from uuid import UUID

from uniffy.core.crypto import OrgCipher
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.domains.agents.tools.definitions import ToolContext
from uniffy.domains.integrations.base import IntegrationAuthError
from uniffy.domains.integrations.clients import get_integration_client_lru
from uniffy.domains.integrations.http import IntegrationHttpClient
from uniffy.domains.integrations.operations import ConnectionOperations
from uniffy.domains.integrations.registry import get_integration_registry


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
