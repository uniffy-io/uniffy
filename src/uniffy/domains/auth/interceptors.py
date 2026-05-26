"""ConnectRPC interceptors enforcing access-token revocation.

The JWT signature check in :func:`get_user_id_from_context` does not
talk to PG or Valkey, so a token issued before a force-logout / org
suspension / sysadmin demotion would keep working until its natural
expiry (default 15 min). This interceptor closes that window by
checking the Valkey ``min_tkv`` watermark on every RPC and rejecting
the request when the JWT's ``tkv`` claim is below the published floor.

Implemented as a :class:`MetadataInterceptor` so the gate applies
uniformly to unary, client-stream, server-stream, and bidi-stream
methods - ConnectRPC's invoker adapts ``on_start`` into all four
``intercept_*`` shapes. A unary-only interceptor would leave the
streaming services (chat stream, notifications, agent runtime)
unguarded.

Mounted ahead of :class:`LoggingInterceptor` in :mod:`uniffy.factory`
so revoked tokens never reach handler code.
"""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext

from uniffy.domains.auth.revocation import is_access_token_revoked
from uniffy.domains.auth.tokens import decode_access_token


class AuthRevocationInterceptor:
    """Reject requests whose access token is below the Valkey watermark.

    Implements the ``MetadataInterceptor`` protocol so the gate runs on
    every RPC method shape (unary / client-stream / server-stream /
    bidi-stream). The Connect runtime wraps this via
    ``MetadataInterceptorInvoker`` and reuses ``on_start`` for all four
    flavours.
    """

    async def on_start(self, ctx: RequestContext) -> None:
        await self._enforce(ctx)
        return None

    async def on_end(
        self, _token: None, _ctx: RequestContext, _error: Exception | None
    ) -> None:
        return None

    @staticmethod
    async def _enforce(ctx: RequestContext) -> None:
        """Decode the bearer token if present and check the watermark.

        Unauthenticated endpoints (Register, Login, RefreshToken) carry
        no Authorization header. We skip silently for those - the
        downstream handler enforces its own gate.
        """
        headers = ctx.request_headers()
        auth_header = headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return
        token = auth_header[7:]
        try:
            payload = decode_access_token(token)
        except Exception:
            # Malformed / expired tokens are the downstream handler's
            # problem; let get_user_id_from_context surface the typed
            # UNAUTHENTICATED error so the wire shape stays consistent.
            return
        sub = payload.get("sub")
        if not sub:
            return
        try:
            user_id = UUID(sub)
        except (TypeError, ValueError):
            return
        if await is_access_token_revoked(user_id, payload.get("tkv")):
            raise ConnectError(Code.UNAUTHENTICATED, "Token has been revoked")


__all__ = ["AuthRevocationInterceptor"]
