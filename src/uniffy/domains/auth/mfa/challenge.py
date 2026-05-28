"""Short-lived JWTs that gate the two MFA mid-login states.

Two token types, both HS256-signed with ``JWT_SECRET_KEY`` so they
share the existing signing key + transport with access / refresh
tokens:

* ``mfa_challenge`` -- issued by ``Authenticate`` when the caller's
  password is correct but their account has MFA enabled. Holds the
  ``user_id`` and the requested ``organization_id`` (if any). The
  client returns it to ``VerifyMfa`` together with a TOTP code or
  recovery code; on success ``VerifyMfa`` mints the real
  ``AuthResult``. Five-minute exp -- enough to finish a code entry,
  short enough to bound replay if intercepted. The challenge token
  authorizes *only* ``VerifyMfa``; no other RPC accepts it.
* ``enrollment_only`` -- issued by ``Authenticate`` when policy says
  the user must enrol MFA before they can use any other surface. The
  token is valid for 30 min and is whitelisted for exactly the MFA
  enrollment RPCs (``BeginEnrollment``, ``ConfirmEnrollment``,
  ``GetMfaStatus``) -- not for content, settings, or anything else.

The plan called these claims ``typ`` but the rest of the codebase uses
``type``; we keep that here too so a single decoder can dispatch on
one claim name.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt

from uniffy.domains.auth.tokens import get_secret_key

TOKEN_TYPE_MFA_CHALLENGE = "mfa_challenge"
TOKEN_TYPE_ENROLLMENT_ONLY = "enrollment_only"

MFA_CHALLENGE_EXPIRE_MINUTES = 5
ENROLLMENT_ONLY_EXPIRE_MINUTES = 30

ENROLLMENT_ALLOWED_RPCS: frozenset[str] = frozenset(
    {
        "BeginEnrollment",
        "ConfirmEnrollment",
        "GetMfaStatus",
    }
)


def create_mfa_challenge_token(
    user_id: UUID,
    organization_id: UUID | None = None,
    *,
    token_version: int | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """Return a fresh ``mfa_challenge`` JWT for ``user_id``.

    ``token_version`` is embedded so the cluster-wide revocation
    watermark (force-logout, admin MFA reset, suspension) kills the
    challenge the same way it kills access tokens.
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=MFA_CHALLENGE_EXPIRE_MINUTES)
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + expires_delta,
        "type": TOKEN_TYPE_MFA_CHALLENGE,
    }
    if organization_id is not None:
        payload["org_id"] = str(organization_id)
    if token_version is not None:
        payload["tkv"] = token_version
    return jwt.encode(payload, get_secret_key(), algorithm="HS256")


def create_enrollment_only_token(
    user_id: UUID,
    *,
    token_version: int | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """Return a fresh ``enrollment_only`` JWT for ``user_id``.

    ``token_version`` rides the same revocation watermark as access /
    challenge tokens.
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=ENROLLMENT_ONLY_EXPIRE_MINUTES)
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + expires_delta,
        "type": TOKEN_TYPE_ENROLLMENT_ONLY,
    }
    if token_version is not None:
        payload["tkv"] = token_version
    return jwt.encode(payload, get_secret_key(), algorithm="HS256")


def decode_mfa_challenge_token(token: str) -> dict[str, Any]:
    """Decode + verify an ``mfa_challenge`` token.

    Raises ``jwt.InvalidTokenError`` (or one of its subclasses) when
    the signature is bad, the token has expired, or the ``type`` claim
    is not ``mfa_challenge``. Callers convert to a typed Connect error.
    """
    return _decode_with_type(token, TOKEN_TYPE_MFA_CHALLENGE)


def decode_enrollment_only_token(token: str) -> dict[str, Any]:
    """Decode + verify an ``enrollment_only`` token."""
    return _decode_with_type(token, TOKEN_TYPE_ENROLLMENT_ONLY)


def _decode_with_type(token: str, expected_type: str) -> dict[str, Any]:
    payload = jwt.decode(token, get_secret_key(), algorithms=["HS256"])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError(
            f"Expected token type {expected_type!r}, got {payload.get('type')!r}"
        )
    return payload
