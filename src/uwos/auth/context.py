"""Authentication context utilities for ConnectRPC services."""

import logging
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext

from uwos.auth.jwt import decode_access_token

logger = logging.getLogger(__name__)


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
    # Get Authorization header
    headers = ctx.request_headers()
    auth_header = headers.get("authorization", "")

    if not auth_header.startswith("Bearer "):
        raise ConnectError(Code.UNAUTHENTICATED, "Missing or invalid authorization header")

    token = auth_header[7:]  # Remove "Bearer " prefix

    # Decode and verify token
    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        return user_id
    except Exception as e:
        logger.error(f"JWT decode error: {e}")
        raise ConnectError(Code.UNAUTHENTICATED, f"Invalid or expired token: {e}")
