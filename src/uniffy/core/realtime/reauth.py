"""Recheck durable credentials and membership for live realtime sockets."""

from __future__ import annotations

import time
from dataclasses import dataclass

from uniffy.core.auth.membership import is_active_member
from uniffy.core.auth.revocation import RevocationUnavailableError, token_revocation
from uniffy.core.realtime.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_REAUTH_REQUIRED,
    WS_CLOSE_TOKEN_REVOKED,
)
from uniffy.core.realtime.state import WSSession

REAUTH_INTERVAL_SECONDS = 30

# Ceiling for a token that carries no ``exp``; no issuer of ours omits it, but
# an absent claim must not mean "lives forever".
MAX_SOCKET_LIFETIME_SECONDS = 15 * 60


@dataclass(frozen=True)
class Denial:
    """Why a live socket must close now."""

    code: int
    reason: str
    metric_reason: str


def socket_deadline(ws_session: WSSession) -> float:
    return (
        ws_session.expires_at
        if ws_session.expires_at is not None
        else ws_session.connected_at + MAX_SOCKET_LIFETIME_SECONDS
    )


async def connection_denial(
    ws_session: WSSession,
    *,
    now: float | None = None,
) -> Denial | None:
    moment = time.time() if now is None else now
    if moment >= socket_deadline(ws_session):
        return Denial(WS_CLOSE_REAUTH_REQUIRED, "reauth required", "token_expired")

    try:
        revoked = await token_revocation(
            ws_session.user_id, ws_session.token_version, ws_session.session_id
        )
    except RevocationUnavailableError:
        return Denial(1013, "authentication temporarily unavailable", "auth_unavailable")
    if revoked is not None:
        return Denial(WS_CLOSE_TOKEN_REVOKED, "credentials revoked", revoked.value)

    if not await is_active_member(ws_session.user_id, ws_session.organization_id):
        return Denial(WS_CLOSE_FORBIDDEN, "not a member", "membership_revoked")

    return None


__all__ = [
    "MAX_SOCKET_LIFETIME_SECONDS",
    "REAUTH_INTERVAL_SECONDS",
    "Denial",
    "connection_denial",
    "socket_deadline",
]
