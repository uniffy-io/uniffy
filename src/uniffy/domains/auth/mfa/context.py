"""Identity extraction for MFA enrollment-only credentials."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uniffy.domains.auth.mfa.challenge import decode_enrollment_only_token

logger = logger.bind(component="auth.mfa.context")


def _bearer_token(ctx: RequestContext) -> str | None:
    authorization = ctx.request_headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return None
    return authorization[7:]


def enrollment_user_id(ctx: RequestContext) -> UUID:
    token = _bearer_token(ctx)
    if token is None:
        raise ConnectError(Code.UNAUTHENTICATED, "Missing or invalid authorization header")
    try:
        return UUID(str(decode_enrollment_only_token(token)["sub"]))
    except Exception as exc:
        logger.debug("Rejected enrollment token", error_type=type(exc).__name__)
        raise ConnectError(Code.UNAUTHENTICATED, "Invalid or expired enrollment token") from exc


def enrollment_organization_id(ctx: RequestContext) -> UUID | None:
    token = _bearer_token(ctx)
    if token is None:
        return None
    try:
        organization_id = decode_enrollment_only_token(token).get("org_id")
        return UUID(str(organization_id)) if organization_id else None
    except Exception:
        return None


__all__ = ["enrollment_organization_id", "enrollment_user_id"]
