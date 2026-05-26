"""Cluster-wide access-token revocation via a Valkey min-version watermark.

Access tokens are short-lived (default 15 min) but the bare JWT
signature check used by :func:`get_user_id_from_context` would still
honour a token issued before the user was force-logged-out or had
their organization suspended. To close the window we publish the
user's new ``token_version`` to Valkey on every bump; every
authenticated request reads it and rejects tokens whose claim is
below the watermark.

Failure mode is fail-open: a Valkey outage drops back to JWT-only
validation. The previous behaviour was the same in steady state, so a
Valkey outage cannot regress beyond the existing baseline.
"""

from __future__ import annotations

import os
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client, ops_call

_NAMESPACE = "auth"
_KEY_PREFIX = "auth:min_tkv"
_DEFAULT_TTL_SECONDS = 60 * 60  # safely outlives any plausible access-token TTL


def _key(user_id: UUID) -> str:
    return f"{_KEY_PREFIX}:{user_id}"


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


__all__ = [
    "is_access_token_revoked",
    "mark_token_version_revoked",
]
