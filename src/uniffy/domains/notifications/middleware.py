"""ASGI middleware for server streaming disconnect detection.

ConnectRPC's server streaming handler does not monitor the ASGI ``receive``
callable for ``http.disconnect`` events. When the client closes the tab or
navigates away, granian enqueues ``http.disconnect`` but ConnectRPC never
reads it -- it only reads the initial request, then enters a send-only loop.
Worse, granian's ``protocol_send`` silently swallows ``ConnectionError``,
so ``await send(...)`` succeeds even on a dead socket.

This middleware runs a background task that waits for ``http.disconnect``
after the response headers are sent (i.e., after ConnectRPC finishes reading
the request). When disconnect is detected, it sets an ``asyncio.Event``
stored in a ``contextvars.ContextVar``. The streaming handler checks this
event on each poll tick and breaks cleanly, allowing ``aclosing()`` to
release the Valkey subscriber connection.

We deliberately do NOT cancel the handler task -- that would corrupt
granian's internal ``TaskGroup`` and break Ctrl+C shutdown.
"""

import asyncio
import contextlib
import contextvars

from starlette.types import ASGIApp, Receive, Scope, Send

# Context variable holding the disconnect event for the current request.
# Set by the middleware, read by the streaming handler via get_disconnect_event().
_client_disconnect: contextvars.ContextVar[asyncio.Event] = contextvars.ContextVar(
    "client_disconnect"
)


def get_disconnect_event() -> asyncio.Event | None:
    """
    Get the disconnect event for the current request context.

    Returns None if called outside the middleware (e.g., in non-streaming RPCs
    that don't go through the middleware, or in the worker process).
    """
    return _client_disconnect.get(None)


class StreamDisconnectMiddleware:
    """
    ASGI middleware that detects client disconnect for streaming RPCs.

    Instead of cancelling tasks (which corrupts granian's TaskGroup),
    this sets a shared ``asyncio.Event`` that the handler checks on each
    poll tick. The handler breaks cleanly, and ``aclosing()`` ensures
    proper Valkey connection cleanup.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        disconnect = asyncio.Event()
        _client_disconnect.set(disconnect)

        # Track when the response starts -- ConnectRPC is done reading
        # from receive at that point, so the watcher can safely read it.
        response_started = asyncio.Event()

        async def _send_proxy(message: dict) -> None:
            """Proxy send calls, detecting when response headers are sent."""
            if message.get("type") == "http.response.start":
                response_started.set()
            await send(message)

        async def _disconnect_watcher() -> None:
            """Wait for response to start, then watch receive for disconnect."""
            await response_started.wait()
            while True:
                msg = await receive()
                if msg.get("type") == "http.disconnect":
                    disconnect.set()
                    return

        watcher = asyncio.create_task(_disconnect_watcher())
        try:
            await self.app(scope, receive, _send_proxy)
        finally:
            watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watcher
