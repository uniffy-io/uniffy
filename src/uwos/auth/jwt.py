"""JWT token utilities."""

import os
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import jwt


def get_secret_key() -> str:
    """
    Get JWT secret key from environment.

    Returns
    -------
    str
        JWT secret key.

    Raises
    ------
    ValueError
        If JWT_SECRET_KEY is not set.

    """
    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        raise ValueError("JWT_SECRET_KEY environment variable is required")
    return secret


def create_access_token(
    user_id: UUID,
    organization_id: UUID | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """
    Create a JWT access token.

    Parameters
    ----------
    user_id : UUID
        User ID to encode in the token.
    organization_id : UUID | None
        Optional organization ID for organization context.
    expires_delta : timedelta | None
        Token expiration time. Defaults to 30 days if not provided.

    Returns
    -------
    str
        Encoded JWT token.

    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=15)

    expire = datetime.utcnow() + expires_delta
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "access",
    }

    if organization_id:
        payload["org_id"] = str(organization_id)

    secret_key = get_secret_key()
    token = jwt.encode(payload, secret_key, algorithm="HS256")
    return token


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decode and verify a JWT access token.

    Parameters
    ----------
    token : str
        JWT token to decode.

    Returns
    -------
    dict[str, Any]
        Decoded token payload.

    Raises
    ------
    jwt.InvalidTokenError
        If token is invalid or expired.

    """
    secret_key = get_secret_key()
    payload = jwt.decode(token, secret_key, algorithms=["HS256"])
    return payload


def create_refresh_token(user_id: UUID, expires_delta: timedelta | None = None) -> str:
    """
    Create a JWT refresh token.

    Parameters
    ----------
    user_id : UUID
        User ID to encode in the token.
    expires_delta : timedelta | None
        Token expiration time. Defaults to 90 days if not provided.

    Returns
    -------
    str
        Encoded JWT refresh token.

    """
    if expires_delta is None:
        expires_delta = timedelta(days=90)

    expire = datetime.utcnow() + expires_delta
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "refresh",
    }

    secret_key = get_secret_key()
    token = jwt.encode(payload, secret_key, algorithm="HS256")
    return token
