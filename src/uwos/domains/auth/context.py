"""Authentication context utilities for extracting user info from requests."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger

from uwos.domains.auth.tokens import decode_access_token


def get_user_id_from_context(ctx: RequestContext) -> UUID:
    """
    Extract user ID from request context.

    Extracts and validates the JWT token from the Authorization header,
    then returns the user ID from the token payload.

    Parameters
    ----------
    ctx : RequestContext
        RPC request context.

    Returns
    -------
    UUID
        User ID from the JWT token.

    Raises
    ------
    ConnectError
        If authorization token is missing, invalid, or expired.

    """
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        raise ConnectError(
            Code.UNAUTHENTICATED,
            "Missing or invalid authorization header",
        )

    token = auth_header[7:]  # Remove "Bearer " prefix

    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        return user_id
    except Exception as e:
        logger.error(f"JWT decode error: {e}")
        raise ConnectError(Code.UNAUTHENTICATED, f"Invalid or expired token: {e}")


def get_organization_id_from_context(ctx: RequestContext) -> UUID | None:
    """
    Extract organization ID from request context if present.

    Parameters
    ----------
    ctx : RequestContext
        RPC request context.

    Returns
    -------
    UUID | None
        Organization ID from the JWT token, or None if not present.

    """
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]

    try:
        payload = decode_access_token(token)
        org_id = payload.get("org_id")
        return UUID(org_id) if org_id else None
    except Exception:
        return None
