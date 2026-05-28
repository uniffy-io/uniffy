"""JWT token utilities for authentication."""

import os
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt

# Default token expiration times
# Short-lived access tokens for security - user verification happens on refresh
DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES = 15
DEFAULT_REFRESH_TOKEN_EXPIRE_DAYS = 90
# Hard ceiling on the env override so a misconfigured deployment cannot mint
# year-long access tokens. The refresh path is the right knob for long
# sessions; the access token should stay short.
MAX_ACCESS_TOKEN_EXPIRE_MINUTES = 60


def get_access_token_expire_minutes() -> int:
    """Access-token TTL, clamped to ``MAX_ACCESS_TOKEN_EXPIRE_MINUTES``."""
    expire_str = os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES")
    if expire_str:
        try:
            minutes = int(expire_str)
        except ValueError:
            return DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES
        if minutes <= 0:
            return DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES
        return min(minutes, MAX_ACCESS_TOKEN_EXPIRE_MINUTES)
    return DEFAULT_ACCESS_TOKEN_EXPIRE_MINUTES


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
    token_version: int | None = None,
    session_id: UUID | None = None,
    full_name: str | None = None,
    avatar_key: str | None = None,
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
    token_version : int | None
        User's current token version for revocation support.
    session_id : UUID | None
        Optional session ID for per-session tracking.
    full_name : str | None
        User's display name. Embedded in the token so handlers can
        identify the sender without a DB query.
    avatar_key : str | None
        User's avatar storage key. Embedded for the same reason.
    expires_delta : timedelta | None
        Token expiration time. Defaults to JWT_ACCESS_TOKEN_EXPIRE_MINUTES env var
        or 15 minutes if not set.

    Returns
    -------
    str
        Encoded JWT token.

    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=get_access_token_expire_minutes())

    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "exp": now + expires_delta,
        "iat": now,
        "type": "access",
    }

    if organization_id:
        payload["org_id"] = str(organization_id)

    if token_version is not None:
        payload["tkv"] = token_version

    if session_id is not None:
        payload["sid"] = str(session_id)

    if full_name:
        payload["name"] = full_name

    if avatar_key:
        payload["avk"] = avatar_key

    secret_key = get_secret_key()
    token = jwt.encode(payload, secret_key, algorithm="HS256")
    return token


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode + verify an access token. Refuses other token kinds.

    Refresh / mfa_challenge / enrollment_only tokens share the signing
    key but have different ``type`` claims; a centralised type check
    here makes "wrong-kind token in Authorization header" a typed
    rejection at the decoder rather than something every caller has to
    remember to assert.
    """
    return _decode_with_required_type(token, "access")


def decode_refresh_token(token: str) -> dict[str, Any]:
    """Decode + verify a refresh token. Refuses other token kinds."""
    return _decode_with_required_type(token, "refresh")


JWT_DECODE_LEEWAY = timedelta(minutes=2)


def decode_token_unsafe(token: str) -> dict[str, Any]:
    """Decode without enforcing a ``type``; for callers that dispatch on it.

    Used by the revocation interceptor, which inspects ``sub`` / ``tkv``
    / ``sid`` regardless of token kind. Production callers that act on
    the token's identity should reach for ``decode_access_token`` /
    ``decode_refresh_token`` instead.
    """
    secret_key = get_secret_key()
    return jwt.decode(
        token, secret_key, algorithms=["HS256"], leeway=JWT_DECODE_LEEWAY
    )


def _decode_with_required_type(token: str, expected_type: str) -> dict[str, Any]:
    secret_key = get_secret_key()
    payload = jwt.decode(
        token, secret_key, algorithms=["HS256"], leeway=JWT_DECODE_LEEWAY
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(
            f"Expected token type {expected_type!r}, got {payload.get('type')!r}"
        )
    return payload


def create_refresh_token(
    user_id: UUID,
    token_version: int | None = None,
    session_id: UUID | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """
    Create a JWT refresh token.

    Parameters
    ----------
    user_id : UUID
        User ID to encode in the token.
    token_version : int | None
        User's current token version for revocation support.
    session_id : UUID | None
        Optional session ID for per-session tracking.
    expires_delta : timedelta | None
        Token expiration time. Defaults to 90 days if not provided.

    Returns
    -------
    str
        Encoded JWT refresh token.

    """
    if expires_delta is None:
        expires_delta = timedelta(days=90)

    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "exp": now + expires_delta,
        "iat": now,
        "type": "refresh",
    }

    if token_version is not None:
        payload["tkv"] = token_version

    if session_id is not None:
        payload["sid"] = str(session_id)

    secret_key = get_secret_key()
    token = jwt.encode(payload, secret_key, algorithm="HS256")
    return token
