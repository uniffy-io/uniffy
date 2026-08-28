"""Expose client disconnects to long-lived streaming handlers."""

import asyncio
import contextlib
import contextvars

from starlette.types import ASGIApp, Receive, Scope, Send

_client_disconnect: contextvars.ContextVar[asyncio.Event] = contextvars.ContextVar(
    "client_disconnect"
)


def get_disconnect_event() -> asyncio.Event | None:
    """Return the disconnect event for the current request, or None if absent."""
    return _client_disconnect.get(None)


class StreamDisconnectMiddleware:
    """ASGI middleware exposing client-disconnect as an Event for streaming RPCs."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # noqa: PLR2004
            await self.app(scope, receive, send)
            return

        disconnect = asyncio.Event()
        _client_disconnect.set(disconnect)

        # ConnectRPC finishes reading ``receive`` once the response starts;
        # only then is it safe for the watcher to consume it.
        response_started = asyncio.Event()

        async def _send_proxy(message: dict) -> None:
            if message.get("type") == "http.response.start":  # noqa: PLR2004
                response_started.set()
            await send(message)

        async def _disconnect_watcher() -> None:
            await response_started.wait()
            while True:
                msg = await receive()
                if msg.get("type") == "http.disconnect":  # noqa: PLR2004
                    disconnect.set()
                    return

        watcher = asyncio.create_task(_disconnect_watcher())
        try:
            await self.app(scope, receive, _send_proxy)
        finally:
            watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watcher
