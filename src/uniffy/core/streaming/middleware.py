"""ASGI middleware that wires streaming RPCs into the revoke coordinator.

Mounted alongside :class:`StreamDisconnectMiddleware` on every long-lived
server-streaming service. Reads the access-token claims from the request
headers at stream open, registers the stream with the coordinator using
the existing disconnect ``asyncio.Event`` set by ``StreamDisconnectMiddleware``,
and unregisters on stream end.

The coordinator is the one that PSUBSCRIBEs and sets the event on a
revoke match. This middleware is just plumbing.
"""

from __future__ import annotations

from uuid import UUID

from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send

from uniffy.core.streaming.revoke_coordinator import coordinator
from uniffy.domains.auth.tokens import decode_access_token
from uniffy.domains.notifications.middleware import get_disconnect_event

LOGGER_COMPONENT = "streaming.revoke.middleware"


def _extract_bearer(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == b"authorization":
            text = value.decode("latin-1", errors="ignore")
            if text.startswith("Bearer "):
                return text[7:]
    return None


class StreamRevokeWatchMiddleware:
    """Register the current stream with the revoke coordinator.

    Mounting order matters: place INSIDE
    ``StreamDisconnectMiddleware`` so the disconnect event is already
    set on the ContextVar when this middleware runs. Without the event
    we have nothing to signal, so we no-op and the stream behaves as
    before.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        disconnect = get_disconnect_event()
        if disconnect is None:
            # No StreamDisconnectMiddleware in the chain; nothing to signal.
            await self.app(scope, receive, send)
            return

        token = _extract_bearer(scope)
        if token is None:
            await self.app(scope, receive, send)
            return

        try:
            payload = decode_access_token(token)
            user_id = UUID(payload["sub"])
            tkv_raw = payload.get("tkv")
            token_version = int(tkv_raw) if isinstance(tkv_raw, int) else None
            sid_raw = payload.get("sid")
            session_id = UUID(sid_raw) if isinstance(sid_raw, str) else None
        except Exception:
            # Bad / wrong-kind token - the upstream interceptor will
            # reject it; we just skip registration.
            await self.app(scope, receive, send)
            return

        registration_id: int | None = None
        try:
            registration_id = await coordinator.register(
                user_id=user_id,
                token_version=token_version,
                session_id=session_id,
                disconnect=disconnect,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"stream revoke registration failed: {exc}",
                component=LOGGER_COMPONENT,
            )

        try:
            await self.app(scope, receive, send)
        finally:
            if registration_id is not None:
                try:
                    await coordinator.unregister(registration_id)
                except Exception:  # noqa: BLE001
                    logger.warning(
                        "stream revoke unregister failed",
                        component=LOGGER_COMPONENT,
                    )
