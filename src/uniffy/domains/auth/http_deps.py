"""Shared HTTP route authentication dependencies.

Provides FastAPI dependencies for extracting user identity from Bearer tokens
in standard HTTP routes (non-ConnectRPC).
"""

from typing import Annotated
from uuid import UUID

from fastapi import Header, HTTPException, status
from loguru import logger

from uniffy.domains.auth.tokens import decode_access_token


async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    """
    Extract and validate user ID from Authorization header.

    This is the FastAPI equivalent of get_user_id_from_context for HTTP routes.

    Parameters
    ----------
    authorization : str | None
        Authorization header value (Bearer token).

    Returns
    -------
    UUID
        Authenticated user's ID.

    Raises
    ------
    HTTPException
        401 if token is missing, invalid, or expired.

    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[7:]  # Remove "Bearer " prefix

    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
        return user_id
    except Exception as e:
        logger.debug(f"JWT decode error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
