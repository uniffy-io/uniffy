"""Per-request capture of client IP and User-Agent for audit attribution.

The writer reads these ContextVars so operations do not have to plumb IP / UA
through their signatures. Worker / ARQ paths leave them unset and the writer
treats that as a system-initiated event.
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


def _load_trusted_proxy_hops() -> int:
    """Parse ``TRUSTED_PROXY_HOPS`` env var. Negative or invalid -> 0."""
    raw = os.getenv("TRUSTED_PROXY_HOPS", "0").strip()
    try:
        value = int(raw)
    except ValueError:
        return 0
    return max(0, value)


_TRUSTED_PROXY_HOPS: int = _load_trusted_proxy_hops()


def _extract_ip(scope: Scope) -> str | None:
    """Pull the client IP from an ASGI scope, honouring ``TRUSTED_PROXY_HOPS``.

    With ``N>0`` we take the entry ``N`` from the right of ``X-Forwarded-For``,
    matching how nginx / Caddy / ALB / Cloudflare append the immediate caller.
    Malformed XFF (fewer entries than configured hops) falls back to the socket
    peer so a misconfiguration cannot suppress audit IPs.
    """
    client = scope.get("client")
    direct_ip: str | None = client[0] if client else None

    if _TRUSTED_PROXY_HOPS <= 0:
        return direct_ip

    headers = dict(scope.get("headers", []))
    xff = headers.get(b"x-forwarded-for")
    if not xff:
        return direct_ip
    parts = [p.strip() for p in xff.decode("latin-1").split(",") if p.strip()]
    if len(parts) < _TRUSTED_PROXY_HOPS:
        return direct_ip
    return parts[-_TRUSTED_PROXY_HOPS] or direct_ip


def _extract_user_agent(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == b"user-agent":
            decoded = value.decode("latin-1", errors="replace")
            return decoded[:_MAX_UA_LENGTH]
    return None


class RequestContextMiddleware:
    """ASGI middleware that captures client IP / UA into ContextVars."""

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
