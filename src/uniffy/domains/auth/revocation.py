"""Cluster-wide access-token revocation via two complementary signals.

Access tokens are short-lived (default 15 min) but the bare JWT
signature check used by :func:`get_user_id_from_context` would still
honour a token issued before the user was force-logged-out or had
their organization suspended. To close that window we publish two
keys to Valkey:

* a per-user ``min_tkv`` watermark - any access token whose ``tkv``
  claim is below this floor is rejected. Used on bulk events: force
  logout, suspension, password reset, MFA admin reset.
* a per-session revoked marker keyed on the JWT ``sid`` claim - any
  access token issued from a session that was individually revoked
  (logout from one device, "log out this session" in settings,
  refresh-token reuse detection) is rejected without bumping the
  user-wide version.

Failure mode is fail-open: a Valkey outage drops back to JWT-only
validation. The previous behaviour was the same in steady state, so a
Valkey outage cannot regress beyond the existing baseline.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client, ops_call

logger = logger.bind(component="auth")

_NAMESPACE = "auth"
_KEY_PREFIX = "auth:min_tkv"
_SESSION_KEY_PREFIX = "auth:revoked_sid"
_DEFAULT_TTL_SECONDS = 60 * 60  # safely outlives any plausible access-token TTL


def _key(user_id: UUID) -> str:
    return f"{_KEY_PREFIX}:{user_id}"


def _session_key(session_id: UUID) -> str:
    return f"{_SESSION_KEY_PREFIX}:{session_id}"


def _ttl_seconds() -> int:
    """TTL that covers the longest plausible access-token lifetime.

    Reads ``JWT_ACCESS_TOKEN_EXPIRE_MINUTES`` (the lifetime of any
    token we ever issued) and adds a 5-minute cushion so a clock skew
    between issuer and validator does not let a stale token slip past
    the watermark.
    """
    try:
        minutes = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    except ValueError:
        minutes = 15
    return max(_DEFAULT_TTL_SECONDS, minutes * 60 + 300)


async def mark_token_version_revoked(user_id: UUID, new_version: int) -> None:
    """Publish the user's new ``token_version`` as the revocation watermark.

    Idempotent; callers may write the same value repeatedly. The TTL is
    re-armed on every write so a long-running session that keeps
    bumping the version never lets the key expire mid-flight.
    """
    client = _get_ops_client()
    if client is None:
        return
    try:
        async with ops_call(_NAMESPACE, "set_min_tkv"):
            await client.set(_key(user_id), str(int(new_version)), ex=_ttl_seconds())
    except Exception:  # noqa: BLE001
        logger.warning(
            "auth.revocation: failed to publish min_tkv",
            component="auth",
            user_id=str(user_id),
        )


async def is_access_token_revoked(user_id: UUID, token_version: int | None) -> bool:
    """True when ``token_version`` is below the published watermark.

    Tokens issued before ``token_version`` was ever tracked carry no
    ``tkv`` claim. We treat ``None`` as "older than any watermark" so a
    legacy token is rejected the moment any bump is published; if no
    watermark exists, the token is allowed (no information to act on).
    """
    client = _get_ops_client()
    if client is None:
        return False
    try:
        async with ops_call(_NAMESPACE, "get_min_tkv"):
            raw = await client.get(_key(user_id))
    except Exception:  # noqa: BLE001
        return False
    if raw is None:
        return False
    try:
        min_tkv = int(raw)
    except (TypeError, ValueError):
        return False
    if token_version is None:
        return True
    return int(token_version) < min_tkv


async def mark_session_revoked(session_id: UUID) -> None:
    """Mark one session as revoked so its outstanding access tokens are rejected.

    Used by logout, "log out this device", refresh-token reuse
    detection, admin MFA reset, and the platform force-logout flow.
    Idempotent; the TTL is re-armed on every write so a long-lived
    session that bumps repeatedly never lets the key expire mid-flight.
    """
    client = _get_ops_client()
    if client is None:
        return
    try:
        async with ops_call(_NAMESPACE, "set_revoked_sid"):
            await client.set(_session_key(session_id), "1", ex=_ttl_seconds())
    except Exception:  # noqa: BLE001
        logger.warning(
            "auth.revocation: failed to publish revoked sid",
            component="auth",
            session_id=str(session_id),
        )


async def mark_sessions_revoked(session_ids: Iterable[UUID]) -> None:
    """Bulk variant of :func:`mark_session_revoked` for revoke-all flows."""
    ids = [sid for sid in session_ids]
    if not ids:
        return
    client = _get_ops_client()
    if client is None:
        return
    ttl = _ttl_seconds()
    try:
        async with ops_call(_NAMESPACE, "set_revoked_sid_bulk"):
            pipe = client.pipeline(transaction=False)
            for sid in ids:
                pipe.set(_session_key(sid), "1", ex=ttl)
            await pipe.execute()
    except Exception:  # noqa: BLE001
        logger.warning(
            "auth.revocation: failed to publish revoked sids in bulk",
            component="auth",
            count=len(ids),
        )


async def is_session_revoked(session_id: UUID | None) -> bool:
    """True when the session has been explicitly revoked since the JWT was issued.

    ``None`` (no ``sid`` claim) returns ``False`` - legacy tokens
    without session tracking can only be killed via the user-level
    ``min_tkv`` watermark.
    """
    if session_id is None:
        return False
    client = _get_ops_client()
    if client is None:
        return False
    try:
        async with ops_call(_NAMESPACE, "get_revoked_sid"):
            raw = await client.get(_session_key(session_id))
    except Exception:  # noqa: BLE001
        return False
    return raw is not None


__all__ = [
    "is_access_token_revoked",
    "is_session_revoked",
    "mark_session_revoked",
    "mark_sessions_revoked",
    "mark_token_version_revoked",
]
