"""Request-scoped identity established by the authentication boundary."""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from loguru import logger

from uniffy.core.auth.tokens import decode_access_token

logger = logger.bind(component="core.auth.principal")


@dataclass(frozen=True, slots=True)
class AuthenticatedPrincipal:
    user_id: UUID
    organization_id: UUID | None
    session_id: UUID | None
    token_version: int | None
    full_name: str
    avatar_key: str


_current_principal: ContextVar[AuthenticatedPrincipal | None] = ContextVar(
    "authenticated_principal",
    default=None,
)


def _optional_uuid(claims: dict[str, Any], name: str) -> UUID | None:
    value = claims.get(name)
    return UUID(str(value)) if value else None


def principal_from_access_token(token: str) -> AuthenticatedPrincipal:
    try:
        claims = decode_access_token(token)
        token_version = claims.get("tkv")
        return AuthenticatedPrincipal(
            user_id=UUID(str(claims["sub"])),
            organization_id=_optional_uuid(claims, "org_id"),
            session_id=_optional_uuid(claims, "sid"),
            token_version=int(token_version) if token_version is not None else None,
            full_name=str(claims.get("name") or ""),
            avatar_key=str(claims.get("avk") or ""),
        )
    except Exception as exc:
        logger.debug("Rejected access token", error_type=type(exc).__name__)
        raise ConnectError(Code.UNAUTHENTICATED, "Invalid or expired access token") from exc


def set_current_principal(
    principal: AuthenticatedPrincipal,
) -> Token[AuthenticatedPrincipal | None]:
    return _current_principal.set(principal)


def reset_current_principal(token: Token[AuthenticatedPrincipal | None]) -> None:
    _current_principal.reset(token)


def current_principal() -> AuthenticatedPrincipal:
    principal = _current_principal.get()
    if principal is None:
        raise ConnectError(Code.UNAUTHENTICATED, "Authenticated principal is unavailable")
    return principal


def current_user_id() -> UUID:
    return current_principal().user_id


def current_organization_id() -> UUID | None:
    return current_principal().organization_id


def current_session_id() -> UUID | None:
    return current_principal().session_id


def current_sender_info() -> tuple[str, str]:
    principal = current_principal()
    return principal.full_name, principal.avatar_key


def resolve_organization_id(request_organization_id: str) -> UUID:
    authenticated = current_organization_id()
    if request_organization_id:
        try:
            requested = UUID(request_organization_id)
        except ValueError as exc:
            raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id") from exc
        if authenticated is not None and authenticated != requested:
            raise ConnectError(
                Code.PERMISSION_DENIED,
                "organization_id does not match the authenticated session",
            )
        return requested
    if authenticated is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "organization_id is required")
    return authenticated


__all__ = [
    "AuthenticatedPrincipal",
    "current_organization_id",
    "current_principal",
    "current_sender_info",
    "current_session_id",
    "current_user_id",
    "principal_from_access_token",
    "reset_current_principal",
    "resolve_organization_id",
    "set_current_principal",
]
