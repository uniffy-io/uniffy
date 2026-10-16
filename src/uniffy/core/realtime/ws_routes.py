"""Authenticate and admit multiplexed realtime connections."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket
from loguru import logger

from uniffy.core.auth.membership import is_active_member
from uniffy.core.auth.revocation import RevocationUnavailableError, token_revocation
from uniffy.core.auth.tokens import decode_access_token
from uniffy.core.realtime.auth import (
    CANONICAL_SUBPROTOCOL,
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_UNAUTHENTICATED,
    WS_CLOSE_UPGRADE_REQUIRED,
    extract_bearer,
    extract_bearer_from_auth_header,
    get_ws_origin_allowlist,
    offered_subprotocols,
    origin_is_allowed,
)
from uniffy.core.realtime.limits import MAX_SOCKETS_PER_USER
from uniffy.core.realtime.metrics import REALTIME_AUTH_FAILURES_TOTAL
from uniffy.core.realtime.session import run_multiplexed_session
from uniffy.core.realtime.state import WSSession
from uniffy.core.realtime.ydoc_manager import YDocManager

logger = logger.bind(component="core.realtime.ws_routes")

_active_sockets: dict[UUID, int] = {}


def create_realtime_router(manager: YDocManager) -> APIRouter:
    router = APIRouter(prefix="/realtime", tags=["realtime"])

    @router.websocket("")
    async def realtime(ws: WebSocket, org_id: Annotated[UUID, Query(...)]) -> None:
        await serve_realtime(ws, org_id, manager)

    return router


async def serve_realtime(ws: WebSocket, org_id: UUID, manager: YDocManager) -> None:
    """Authenticate one upgrade, then run its multiplexed session against ``manager``."""
    origin = ws.headers.get("origin")
    if not origin_is_allowed(origin, get_ws_origin_allowlist()):
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="origin_denied").inc()
        logger.warning(f"realtime upgrade rejected: origin not allowed (origin={origin!r})")
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="origin not allowed")
        return

    subprotocol_header = ws.headers.get("sec-websocket-protocol")
    token = extract_bearer(subprotocol_header) or extract_bearer_from_auth_header(
        ws.headers.get("authorization")
    )
    if token is None:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="missing_token").inc()
        logger.warning("realtime upgrade rejected: missing token")
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="missing token")
        return

    try:
        payload = decode_access_token(token)
        if payload.get("type") != "access":  # noqa: PLR2004
            REALTIME_AUTH_FAILURES_TOTAL.labels(reason="wrong_token_type").inc()
            logger.warning(f"realtime upgrade rejected: wrong token type={payload.get('type')!r}")
            await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="wrong token type")
            return
        user_id = UUID(payload["sub"])
        token_org_raw = payload.get("org_id")
        token_org = UUID(token_org_raw) if token_org_raw else None
        token_version = payload.get("tkv")
        exp_raw = payload.get("exp")
        expires_at = float(exp_raw) if isinstance(exp_raw, (int, float)) else None
        sid_raw = payload.get("sid")
        session_id = UUID(sid_raw) if sid_raw is not None else None
    except Exception as exc:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="decode_error").inc()
        logger.warning(f"realtime upgrade rejected: token decode failed ({exc})")
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="invalid token")
        return

    if token_org is None or token_org != org_id:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="org_mismatch").inc()
        logger.warning(
            f"realtime upgrade rejected: org mismatch "
            f"(token_org={token_org}, url_org={org_id}, user={user_id})"
        )
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="org mismatch")
        return

    try:
        revoked = await token_revocation(user_id, token_version, session_id)
    except RevocationUnavailableError:
        await ws.close(code=1013, reason="authentication temporarily unavailable")
        return
    if revoked is not None:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason=revoked.value).inc()
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="credentials revoked")
        return

    if not await is_active_member(user_id, org_id):
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="membership_revoked").inc()
        logger.warning(
            f"realtime upgrade rejected: not an active member (user={user_id}, org={org_id})"
        )
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="not a member")
        return

    offered = offered_subprotocols(subprotocol_header)
    if CANONICAL_SUBPROTOCOL not in offered:
        # Complete the handshake so the close code reaches the client; a browser fails a
        # handshake that selects none of the protocols it offered.
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="upgrade_required").inc()
        await ws.accept(subprotocol=offered[0] if offered else None)
        await ws.close(code=WS_CLOSE_UPGRADE_REQUIRED, reason="upgrade required")
        return

    if _active_sockets.get(user_id, 0) >= MAX_SOCKETS_PER_USER:
        await ws.close(code=1013, reason="too many connections")
        return
    # Reserve before acceptance yields so concurrent upgrades cannot take the same slot.
    _active_sockets[user_id] = _active_sockets.get(user_id, 0) + 1
    try:
        await ws.accept(subprotocol=CANONICAL_SUBPROTOCOL)
        ws_session = WSSession(
            user_id=user_id,
            organization_id=org_id,
            token_version=token_version,
            conn_id=id(ws),
            ws=ws,
            session_id=session_id,
            expires_at=expires_at,
        )
        await run_multiplexed_session(ws, ws_session, manager)
    finally:
        remaining = _active_sockets[user_id] - 1
        if remaining:
            _active_sockets[user_id] = remaining
        else:
            _active_sockets.pop(user_id, None)
