"""FastAPI WebSocket route for the multiplexed realtime channel.

Single route, single WS per browser tab; every active doc is multiplexed
onto this connection. URL: ``/api/realtime?org_id={uuid}``.

Auth on upgrade enforces, in order:
  1. Origin allowlist.
  2. Subprotocol bearer JWT (or ``Authorization`` header for mobile).
  3. ``payload["type"] == "access"`` (refresh tokens rejected).
  4. Token ``org_id`` claim matches the URL ``org_id``.

Per-doc role resolution runs lazily inside ``run_multiplexed_session``.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket
from loguru import logger

from uniffy.core.realtime.auth import (
    CANONICAL_SUBPROTOCOL,
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_UNAUTHENTICATED,
    extract_bearer,
    extract_bearer_from_auth_header,
    get_ws_origin_allowlist,
    origin_is_allowed,
)
from uniffy.core.realtime.session import run_multiplexed_session
from uniffy.core.realtime.state import WSSession
from uniffy.domains.auth.tokens import decode_access_token
from uniffy.observability.metrics import REALTIME_AUTH_FAILURES_TOTAL

LOGGER_COMPONENT = "realtime.ws"

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.websocket("")
async def realtime(
    ws: WebSocket,
    org_id: Annotated[UUID, Query(...)],
) -> None:
    """Upgrade, authenticate, then hand the socket to ``run_multiplexed_session``."""
    origin = ws.headers.get("origin")
    if not origin_is_allowed(origin, get_ws_origin_allowlist()):
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="origin_denied").inc()
        logger.warning(
            f"realtime upgrade rejected: origin not allowed (origin={origin!r})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="origin not allowed")
        return

    subprotocol_header = ws.headers.get("sec-websocket-protocol")
    token = extract_bearer(subprotocol_header) or extract_bearer_from_auth_header(
        ws.headers.get("authorization")
    )
    if token is None:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="missing_token").inc()
        logger.warning(
            f"realtime upgrade rejected: missing token (subprotocol_header={subprotocol_header!r})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="missing token")
        return

    try:
        payload = decode_access_token(token)
        if payload.get("type") != "access":
            REALTIME_AUTH_FAILURES_TOTAL.labels(reason="wrong_token_type").inc()
            logger.warning(
                f"realtime upgrade rejected: wrong token type={payload.get('type')!r}",
                component=LOGGER_COMPONENT,
            )
            await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="wrong token type")
            return
        user_id = UUID(payload["sub"])
        token_org_raw = payload.get("org_id")
        token_org = UUID(token_org_raw) if token_org_raw else None
        token_version = payload.get("tkv")
    except Exception as exc:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="decode_error").inc()
        logger.warning(
            f"realtime upgrade rejected: token decode failed ({exc})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="invalid token")
        return

    if token_org is None or token_org != org_id:
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="org_mismatch").inc()
        logger.warning(
            f"realtime upgrade rejected: org mismatch "
            f"(token_org={token_org}, url_org={org_id}, user={user_id})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="org mismatch")
        return

    await ws.accept(subprotocol=CANONICAL_SUBPROTOCOL)

    ws_session = WSSession(
        user_id=user_id,
        organization_id=org_id,
        token_version=token_version,
        conn_id=id(ws),
        ws=ws,
    )
    await run_multiplexed_session(ws, ws_session)
