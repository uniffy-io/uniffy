"""Durable credential checks and best-effort revocation signals."""

from __future__ import annotations

import os
from collections.abc import Iterable
from enum import StrEnum
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from uniffy.core.errors import UnavailableError
from uniffy.core.models.login.user import User
from uniffy.core.models.login.user_session import UserSession
from uniffy.infrastructure.database import open_session
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

logger = logger.bind(component="core.auth.revocation")

_NAMESPACE = "auth"
_KEY_PREFIX = "auth:min_tkv"
_SESSION_KEY_PREFIX = "auth:revoked_sid"
_DEFAULT_TTL_SECONDS = 60 * 60  # safely outlives any plausible access-token TTL


def _key(user_id: UUID) -> str:
    return f"{_KEY_PREFIX}:{user_id}"


def _session_key(session_id: UUID) -> str:
    return f"{_SESSION_KEY_PREFIX}:{session_id}"


def _ttl_seconds() -> int:
    """Keep revocation hints beyond the longest issued access-token lifetime."""
    try:
        minutes = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    except ValueError:
        minutes = 15
    return max(_DEFAULT_TTL_SECONDS, minutes * 60 + 300)


async def mark_token_version_revoked(user_id: UUID, new_version: int) -> None:
    """Publish a best-effort account revocation hint."""
    client = get_ops_client()
    if client is None:
        return
    try:
        async with ops_call(_NAMESPACE, "set_min_tkv"):
            await client.set(_key(user_id), str(int(new_version)), ex=_ttl_seconds())
    except Exception:  # noqa: BLE001
        logger.warning(
            "auth.revocation: failed to publish min_tkv",
            user_id=str(user_id),
        )


class TokenRevocation(StrEnum):
    TOKEN = "token_revoked"
    SESSION = "session_revoked"


class RevocationUnavailableError(UnavailableError):
    """Authentication cannot proceed without fresh durable revocation facts."""


async def token_revocation(
    user_id: UUID, token_version: int | None, session_id: UUID | None
) -> TokenRevocation | None:
    """Read fresh account and session facts together without trusting cache absence."""
    try:
        async with open_session() as session:
            row = (
                await session.execute(
                    select(
                        User.is_active,
                        User.token_version,
                        UserSession.id.label("session_id"),
                        UserSession.user_id.label("session_user_id"),
                        UserSession.is_revoked,
                    )
                    .select_from(User)
                    .outerjoin(UserSession, UserSession.id == session_id)
                    .where(User.id == user_id)
                )
            ).one_or_none()
    except Exception as exc:
        logger.opt(exception=True).warning("Durable credential check failed")
        raise RevocationUnavailableError("Authentication temporarily unavailable") from exc

    if row is None or not row.is_active:
        return TokenRevocation.TOKEN
    # Tokens without a version predate account-wide revocation and only match initial state.
    version = 1 if token_version is None else token_version
    if version != row.token_version:
        return TokenRevocation.TOKEN
    if session_id is not None and (
        row.session_id is None or row.session_user_id != user_id or row.is_revoked
    ):
        return TokenRevocation.SESSION
    return None


async def mark_session_revoked(session_id: UUID) -> None:
    """Publish a best-effort session revocation hint."""
    client = get_ops_client()
    if client is None:
        return
    try:
        async with ops_call(_NAMESPACE, "set_revoked_sid"):
            await client.set(_session_key(session_id), "1", ex=_ttl_seconds())
    except Exception:  # noqa: BLE001
        logger.warning(
            "auth.revocation: failed to publish revoked sid",
            session_id=str(session_id),
        )


async def mark_sessions_revoked(session_ids: Iterable[UUID]) -> None:
    """Bulk variant of :func:`mark_session_revoked` for revoke-all flows."""
    ids = [sid for sid in session_ids]
    if not ids:
        return
    client = get_ops_client()
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
            count=len(ids),
        )


__all__ = [
    "RevocationUnavailableError",
    "TokenRevocation",
    "token_revocation",
    "mark_session_revoked",
    "mark_sessions_revoked",
    "mark_token_version_revoked",
]
