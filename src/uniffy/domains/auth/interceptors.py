"""ConnectRPC authentication boundary for every method shape."""

from __future__ import annotations

from contextvars import Token
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext

from uniffy.core.auth.principal import (
    AuthenticatedPrincipal,
    principal_from_access_token,
    reset_current_principal,
    set_current_principal,
)
from uniffy.core.auth.revocation import is_access_token_revoked, is_session_revoked
from uniffy.core.auth.tokens import decode_token_unsafe

PUBLIC_METHODS: frozenset[str] = frozenset({
    "auth.v1.AuthService/Register",
    "auth.v1.AuthService/Login",
    "auth.v1.AuthService/RefreshToken",
    "auth.v1.AuthService/GetAuthConfig",
    "auth.v1.AuthService/SwitchOrganization",
    "auth.v1.AuthService/GetInvitation",
    "auth.v1.AuthService/AcceptInvitation",
    "auth.v1.AuthService/SendPasswordReset",
    "auth.v1.AuthService/VerifyPasswordResetToken",
    "auth.v1.AuthService/ResetPassword",
    "auth.v1.MfaService/BeginEnrollment",
    "auth.v1.MfaService/ConfirmEnrollment",
    "auth.v1.MfaService/GetMfaStatus",
    "auth.v1.MfaService/VerifyMfa",
    "notifications.v1.NotificationsService/GetVapidPublicKey",
})


class AuthenticationInterceptor:
    """Authenticate private RPCs and publish one principal for the request."""

    async def on_start(
        self,
        ctx: RequestContext,
    ) -> Token[AuthenticatedPrincipal | None] | None:
        authorization = ctx.request_headers().get("authorization", "")
        is_public = f"{ctx.method().service_name}/{ctx.method().name}" in PUBLIC_METHODS

        if not authorization.startswith("Bearer "):
            if is_public:
                return None
            raise ConnectError(Code.UNAUTHENTICATED, "Missing or invalid authorization header")

        bearer = authorization[7:]
        if is_public:
            try:
                principal = principal_from_access_token(bearer)
            except ConnectError:
                await self._enforce_public_token_revocation(bearer)
                return None
            await self._enforce_principal_revocation(principal)
            return set_current_principal(principal)

        principal = principal_from_access_token(bearer)
        await self._enforce_principal_revocation(principal)
        return set_current_principal(principal)

    async def on_end(
        self,
        token: Token[AuthenticatedPrincipal | None] | None,
        _ctx: RequestContext,
        _error: Exception | None,
    ) -> None:
        if token is not None:
            reset_current_principal(token)

    @staticmethod
    async def _enforce_principal_revocation(principal: AuthenticatedPrincipal) -> None:
        if await is_access_token_revoked(principal.user_id, principal.token_version):
            raise ConnectError(Code.UNAUTHENTICATED, "Token has been revoked")
        if await is_session_revoked(principal.session_id):
            raise ConnectError(Code.UNAUTHENTICATED, "Session has been revoked")

    @staticmethod
    async def _enforce_public_token_revocation(token: str) -> None:
        try:
            claims = decode_token_unsafe(token)
            user_id = UUID(str(claims["sub"]))
        except Exception:
            return

        if await is_access_token_revoked(user_id, claims.get("tkv")):
            raise ConnectError(Code.UNAUTHENTICATED, "Token has been revoked")

        session_id: UUID | None = None
        if claims.get("sid"):
            try:
                session_id = UUID(str(claims["sid"]))
            except ValueError:
                return
        if await is_session_revoked(session_id):
            raise ConnectError(Code.UNAUTHENTICATED, "Session has been revoked")


__all__ = ["AuthenticationInterceptor", "PUBLIC_METHODS"]
