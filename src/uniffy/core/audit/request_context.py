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
    """Pull the client IP from an ASGI scope, honouring trusted proxy hops.

    With ``TRUSTED_PROXY_HOPS=0`` (default) the raw socket peer wins -
    appropriate for direct-connect deployments and the safe default
    behind an unknown LB. With ``N>0`` we take the entry ``N`` from the
    right of ``X-Forwarded-For``, which matches how nginx / Caddy / ALB
    / Cloudflare each append their view of the immediate caller. Common
    settings:
      * 0 - dev / docker-compose / direct connect
      * 1 - behind one reverse proxy (nginx, Caddy, Traefik, ALB)
      * 2 - behind a CDN + LB (Cloudflare -> ALB -> app)
    Malformed XFF (fewer entries than configured hops) falls back to
    the socket peer so a misconfiguration cannot suppress audit IPs.
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
