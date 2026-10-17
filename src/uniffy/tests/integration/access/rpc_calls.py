"""Call RPC handlers through the transport interceptor as one authenticated member."""

from collections.abc import Awaitable, Callable
from types import SimpleNamespace
from typing import Any
from uuid import UUID

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    reset_current_principal,
    set_current_principal,
)
from uniffy.transport.rpc import LoggingInterceptor


async def call_rpc(
    handler: Callable[[Any, Any], Awaitable[Any]],
    request: Any,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> Any:
    """Domain errors surface as the Connect codes and messages clients receive."""
    token = set_current_principal(
        AuthenticatedPrincipal(
            user_id=user_id,
            organization_id=organization_id,
            session_id=None,
            token_version=None,
            full_name="",
            avatar_key="",
        )
    )
    context = SimpleNamespace(method=SimpleNamespace(name=f"test/{handler.__name__}"))
    try:
        return await LoggingInterceptor().intercept_unary(handler, request, context)
    finally:
        reset_current_principal(token)
