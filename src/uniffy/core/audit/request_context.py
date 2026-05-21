"""Per-request context capture for audit attribution.

A single ASGI middleware extracts the client IP and User-Agent from
the inbound HTTP request and stores them in module-level
:class:`contextvars.ContextVar`. The audit writer reads the ContextVars
when emitting a row so that operations methods do not have to plumb
IP / UA through their signatures.

IP extraction respects ``X-Forwarded-For`` only when the immediate
peer appears in ``TRUSTED_PROXIES`` (a comma-separated env var). When
no proxies are trusted the middleware uses the raw client tuple.

Worker / cron / ARQ paths that emit audit rows leave both ContextVars
unset; the writer treats unset values as ``None`` (system-initiated
events).

ContextVars copy with :class:`asyncio.Task` by default (Python 3.13
behaviour), so ``asyncio.gather`` fan-out inside a request - notably
the agent tool executor's parallel read-tool pool - inherits the
captured IP / UA without any extra glue.
"""

import os
from contextvars import ContextVar
from typing import Final

from starlette.types import ASGIApp, Receive, Scope, Send

audit_ip_var: ContextVar[str | None] = ContextVar("audit_ip", default=None)
audit_user_agent_var: ContextVar[str | None] = ContextVar(
    "audit_user_agent", default=None
)

_MAX_UA_LENGTH: Final[int] = 512


def _load_trusted_proxies() -> frozenset[str]:
    """Parse ``TRUSTED_PROXIES`` env var into a set of IP strings."""
    raw = os.getenv("TRUSTED_PROXIES", "")
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


_TRUSTED_PROXIES: frozenset[str] = _load_trusted_proxies()


def _extract_ip(scope: Scope) -> str | None:
    """Pull the client IP from an ASGI scope, honouring trusted proxies."""
    client = scope.get("client")
    direct_ip: str | None = client[0] if client else None

    if direct_ip is not None and direct_ip in _TRUSTED_PROXIES:
        headers = dict(scope.get("headers", []))
        xff = headers.get(b"x-forwarded-for")
        if xff:
            first = xff.decode("latin-1").split(",")[0].strip()
            return first or direct_ip

    return direct_ip


def _extract_user_agent(scope: Scope) -> str | None:
    """Pull the User-Agent header from an ASGI scope."""
    for name, value in scope.get("headers", []):
        if name == b"user-agent":
            decoded = value.decode("latin-1", errors="replace")
            return decoded[:_MAX_UA_LENGTH]
    return None


class RequestContextMiddleware:
    """ASGI middleware that captures client IP / UA into ContextVars.

    Mounted ahead of every service so that audit writes from any
    downstream handler can attach the originating request metadata
    without changing operation signatures.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        ip_token = audit_ip_var.set(_extract_ip(scope))
        ua_token = audit_user_agent_var.set(_extract_user_agent(scope))
        try:
            await self.app(scope, receive, send)
        finally:
            audit_ip_var.reset(ip_token)
            audit_user_agent_var.reset(ua_token)
