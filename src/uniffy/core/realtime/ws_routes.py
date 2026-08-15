"""FastAPI WebSocket route for the multiplexed realtime channel.

One WS per browser tab, all docs multiplexed onto it. Upgrade enforces, in order:
origin allowlist, bearer JWT, ``type==access``, ``org_id`` match, ``min_tkv``
watermark and per-session revoke (both catch the "connect with an already-revoked
token" race), active membership. Per-doc role resolution runs lazily inside
``run_multiplexed_session``, which also re-checks all of it on a timer.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket
from loguru import logger

from uniffy.core.auth.membership import is_active_member
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
from uniffy.domains.auth.revocation import is_access_token_revoked, is_session_revoked
from uniffy.domains.auth.tokens import decode_access_token
from uniffy.observability.metrics import REALTIME_AUTH_FAILURES_TOTAL

LOGGER_COMPONENT = "realtime.ws"

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.websocket("")
async def realtime(
    ws: WebSocket,
    org_id: Annotated[UUID, Query(...)],
) -> None:
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
        if payload.get("type") != "access":  # noqa: PLR2004
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
        exp_raw = payload.get("exp")
        expires_at = float(exp_raw) if isinstance(exp_raw, (int, float)) else None
        sid_raw = payload.get("sid")
        try:
            session_id = UUID(sid_raw) if sid_raw else None
        except TypeError, ValueError:
            session_id = None
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

    if await is_access_token_revoked(user_id, token_version):
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="token_revoked").inc()
        logger.warning(
            f"realtime upgrade rejected: token revoked (user={user_id})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="token revoked")
        return

    # Per-session revoke does not bump token_version, so the watermark above
    # cannot see it: without this check "log out this device" leaves that device
    # able to open a fresh realtime channel.
    if await is_session_revoked(session_id):
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="session_revoked").inc()
        logger.warning(
            f"realtime upgrade rejected: session revoked (user={user_id}, sid={session_id})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_UNAUTHENTICATED, reason="session revoked")
        return

    if not await is_active_member(user_id, org_id):
        REALTIME_AUTH_FAILURES_TOTAL.labels(reason="membership_revoked").inc()
        logger.warning(
            f"realtime upgrade rejected: not an active member (user={user_id}, org={org_id})",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="not a member")
        return

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
    await run_multiplexed_session(ws, ws_session)
