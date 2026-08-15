"""ConnectRPC interceptors enforcing authentication and access-token revocation.

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

from uniffy.domains.auth.context import get_user_id_from_context
from uniffy.domains.auth.revocation import (
    is_access_token_revoked,
    is_session_revoked,
)
from uniffy.domains.auth.tokens import decode_token_unsafe

PUBLIC_METHODS: frozenset[str] = frozenset({
    # Credential entry points: no session exists yet.
    "auth.v1.AuthService/Register",
    "auth.v1.AuthService/Login",
    "auth.v1.AuthService/RefreshToken",
    "auth.v1.AuthService/GetAuthConfig",
    # Carries its own credential in the body rather than the header:
    # the refresh token, which is not an access token.
    "auth.v1.AuthService/SwitchOrganization",
    # Reached from an emailed link before the recipient has an account.
    "auth.v1.AuthService/GetInvitation",
    "auth.v1.AuthService/AcceptInvitation",
    # Password reset: the token in the body is the credential.
    "auth.v1.AuthService/SendPasswordReset",
    "auth.v1.AuthService/VerifyPasswordResetToken",
    "auth.v1.AuthService/ResetPassword",
    # MFA legs that run mid-login, holding an enrollment-only or
    # challenge token rather than an access token. The handlers
    # authenticate those themselves; see ENROLLMENT_ALLOWED_RPCS.
    "auth.v1.MfaService/BeginEnrollment",
    "auth.v1.MfaService/ConfirmEnrollment",
    "auth.v1.MfaService/GetMfaStatus",
    "auth.v1.MfaService/VerifyMfa",
    # Static server public key, needed before a push subscription exists.
    "notifications.v1.NotificationsService/GetVapidPublicKey",
})


class AuthenticationInterceptor:
    """Reject any RPC outside :data:`PUBLIC_METHODS` that carries no valid
    access token.

    Authentication used to be opt-in per handler, 468 times over, so a
    handler that forgot ``get_user_id_from_context`` was reachable with no
    credentials. This makes the default deny: a new RPC is private unless
    it is added to the allowlist above, and handlers keep their own
    authorization checks on top.
    """

    async def on_start(self, ctx: RequestContext) -> None:
        method = ctx.method()
        if f"{method.service_name}/{method.name}" in PUBLIC_METHODS:
            return None
        # Raises UNAUTHENTICATED on a missing, malformed, expired or
        # wrong-type token. Identity itself is re-resolved by the handler.
        get_user_id_from_context(ctx)
        return None

    async def on_end(self, _token: None, _ctx: RequestContext, _error: Exception | None) -> None:
        return None


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

    async def on_end(self, _token: None, _ctx: RequestContext, _error: Exception | None) -> None:
        return None

    @staticmethod
    async def _enforce(ctx: RequestContext) -> None:
        """Decode the bearer token if present and check the watermark.

        A missing header is not an error here: the allowlisted public
        methods legitimately carry none, and every other method was
        already rejected by :class:`AuthenticationInterceptor`.
        """
        headers = ctx.request_headers()
        auth_header = headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return
        token = auth_header[7:]
        try:
            # Use the type-unsafe decoder: this interceptor only cares about
            # revocation, which applies to every token kind. The downstream
            # ``get_user_id_from_context`` enforces ``type == "access"`` so
            # a wrong-kind token in the Authorization header is rejected by
            # the handler with the typed UNAUTHENTICATED error.
            payload = decode_token_unsafe(token)
        except Exception:
            return
        sub = payload.get("sub")
        if not sub:
            return
        try:
            user_id = UUID(sub)
        except TypeError, ValueError:
            return
        if await is_access_token_revoked(user_id, payload.get("tkv")):
            raise ConnectError(Code.UNAUTHENTICATED, "Token has been revoked")
        sid_raw = payload.get("sid")
        if sid_raw:
            try:
                session_id = UUID(sid_raw)
            except TypeError, ValueError:
                return
            if await is_session_revoked(session_id):
                raise ConnectError(Code.UNAUTHENTICATED, "Session has been revoked")


__all__ = ["AuthenticationInterceptor", "AuthRevocationInterceptor", "PUBLIC_METHODS"]
