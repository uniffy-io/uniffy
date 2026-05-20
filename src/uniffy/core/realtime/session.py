"""Per-WebSocket session loop for the multiplexed realtime channel.

Each WS carries N docs over one connection; every frame on the wire is
``[VarString docName][y-protocols frame bytes]``. The docname prefix
selects which ``YDocSession`` the inner payload routes to.

Inbound loop peeks the docname, runs lazy authorize + acquire on first
sight, and dispatches the payload to the per-doc handler. Outbound
pump drains ``WSSession.outbound`` (frames are docname-prefixed at
enqueue time) into ``ws.send_bytes``.

VIEWER handles are read-only: a ``SYNC_STEP2`` / ``SYNC_UPDATE`` frame
on a ``can_edit=False`` handle closes the socket with ``4403``.
``SYNC_STEP1`` (state-vector handshake) is allowed.
"""

import asyncio
import contextlib

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger
from pycrdt import Decoder

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.auth import WS_CLOSE_FORBIDDEN, WS_CLOSE_UNSUPPORTED_TYPE
from uniffy.core.realtime.multiplex import encode_doc_frame, peek_var_string
from uniffy.core.realtime.state import (
    ClientHandle,
    WSSession,
    YDocSession,
    parse_doc_name,
)
from uniffy.core.realtime.wire import (
    YMessageType,
    YSyncMessageType,
    create_sync_message,
    handle_sync_message,
    is_sync_write_frame,
    peek_message_type,
    peek_sync_sub_type,
)
from uniffy.core.realtime.ydoc_manager import ydoc_manager
from uniffy.db.session import open_session
from uniffy.observability.metrics import (
    REALTIME_AWARENESS_MESSAGES_TOTAL,
    REALTIME_FRAMES_DROPPED_TOTAL,
    REALTIME_PERMISSION_REJECTIONS_TOTAL,
    REALTIME_UPDATE_MESSAGES_TOTAL,
)

# y-protocols QueryAwareness: acknowledged but not acted on (no
# server-side awareness map).
MSG_QUERY_AWARENESS = 3

# 1 MB cap absorbs paste-of-data-URL edits while bounding fanout to
# other peers.
MAX_FRAME_BYTES = 1 * 1024 * 1024

# RFC 6455: "Message Too Big".
WS_CLOSE_MESSAGE_TOO_BIG = 1009

LOGGER_COMPONENT = "realtime.session"


async def run_multiplexed_session(ws: WebSocket, ws_session: WSSession) -> None:
    """Drive one multiplexed WebSocket through the demux loop.

    Authentication already ran at upgrade time. On exit, every doc
    attached to ``ws_session`` is released.
    """
    out_task = asyncio.create_task(_pump_outbound(ws, ws_session))
    try:
        await _drive_inbound(ws, ws_session)
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        # Starlette raises when receiving against a non-CONNECTED socket
        # (client dropped TCP, or a previous iteration already closed).
        # This is a disconnect; demote to debug to keep traces clean.
        logger.debug(
            f"session ended with starlette state error: {exc}",
            component=LOGGER_COMPONENT,
        )
    except Exception as exc:
        logger.exception(f"session loop crashed: {exc}", component=LOGGER_COMPONENT)
    finally:
        out_task.cancel()
        with contextlib.suppress(BaseException):
            await out_task
        await ydoc_manager.release_all(ws_session)
        # Code 1011 signals "reconnect"; code 1000 would suppress the
        # multiplexer's reconnect backoff. Swallow if the socket is
        # already gone.
        with contextlib.suppress(BaseException):
            await ws.close(code=1011, reason="session ended")


async def _pump_outbound(ws: WebSocket, ws_session: WSSession) -> None:
    """Drain the WS-level outbound queue. Frames are already prefixed."""
    while True:
        frame = await ws_session.outbound.get()
        await ws.send_bytes(frame)


async def _drive_inbound(ws: WebSocket, ws_session: WSSession) -> None:
    """Read multiplexed frames off the WebSocket and dispatch by docname."""
    while True:
        frame = await ws.receive_bytes()
        if len(frame) > MAX_FRAME_BYTES:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="oversized").inc()
            await ws.close(code=WS_CLOSE_MESSAGE_TOO_BIG, reason="frame too large")
            return

        try:
            doc_name, payload_offset = peek_var_string(frame)
        except ValueError as exc:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="malformed_prefix").inc()
            logger.warning(
                f"malformed multiplex prefix from conn {ws_session.conn_id}: {exc}",
                component=LOGGER_COMPONENT,
            )
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="malformed frame")
            return

        key = parse_doc_name(doc_name)
        if key is None:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="bad_docname").inc()
            logger.warning(
                f"unparseable docname {doc_name!r} from conn {ws_session.conn_id}",
                component=LOGGER_COMPONENT,
            )
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="bad docname")
            return

        payload = frame[payload_offset:]
        if not payload:
            continue

        handle = ws_session.doc_handles.get(key)
        if handle is None:
            handle = await _attach_doc(ws, ws_session, key, doc_name)
            if handle is None:
                return

        await _dispatch_doc_frame(ws, ws_session, handle, doc_name, payload)


async def _attach_doc(
    ws: WebSocket,
    ws_session: WSSession,
    key: tuple,
    doc_name: str,
) -> ClientHandle | None:
    """Lazy per-doc authorize + acquire on first frame for ``key``.

    Closes the WS with ``4403`` on denial so the client does not sit
    waiting for a SyncStep1 that will never come.
    """
    content_type, content_id = key
    try:
        adapter = get_realtime_adapter(content_type)
    except LookupError:
        REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
            content_type=content_type.value, reason="unsupported_content_type"
        ).inc()
        await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="unsupported content type")
        return None

    async with open_session() as db:
        role = await adapter.authorize(
            db, ws_session.user_id, ws_session.organization_id, content_id
        )

    if role is None or not role_can_view(role):
        REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
            content_type=content_type.value, reason="no_view"
        ).inc()
        logger.info(
            f"per-doc authorize denied for conn {ws_session.conn_id} on {doc_name}",
            component=LOGGER_COMPONENT,
        )
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="no view access")
        return None

    can_edit = role_can_edit(role)
    session, handle = await ydoc_manager.acquire(key, ws_session, can_edit=can_edit)
    # Send initial SyncStep1 so the client can compute its delta.
    initial = create_sync_message(session.ydoc)
    framed = encode_doc_frame(doc_name, initial)
    try:
        ws_session.outbound.put_nowait(framed)
    except asyncio.QueueFull:
        logger.warning(
            f"outbound queue full during attach for conn {ws_session.conn_id}",
            component=LOGGER_COMPONENT,
        )
    return handle


async def _dispatch_doc_frame(
    ws: WebSocket,
    ws_session: WSSession,
    handle: ClientHandle,
    doc_name: str,
    payload: bytes,
) -> None:
    """Route one (already-demuxed) y-protocols frame to the right handler."""
    kind = peek_message_type(payload)
    if kind is None:
        return

    session = ydoc_manager._sessions.get(handle.doc_key)  # noqa: SLF001
    if session is None:
        return

    if kind == YMessageType.SYNC:
        await _handle_sync_frame(ws, session, handle, doc_name, payload)
    elif kind == YMessageType.AWARENESS:
        REALTIME_AWARENESS_MESSAGES_TOTAL.labels(
            content_type=handle.doc_key[0].value
        ).inc()
        await ydoc_manager.broadcast_awareness(
            session, payload, source_conn_id=handle.conn_id
        )
    elif kind == MSG_QUERY_AWARENESS:
        return
    else:
        logger.debug(
            f"unknown message type {kind} on {doc_name}, dropping",
            component=LOGGER_COMPONENT,
        )


async def _handle_sync_frame(
    ws: WebSocket,
    session: YDocSession,
    handle: ClientHandle,
    doc_name: str,
    frame: bytes,
) -> None:
    """Dispatch a SYNC frame (step1 / step2 / update) for one doc."""
    if not handle.can_edit and is_sync_write_frame(frame):
        REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
            content_type=handle.doc_key[0].value, reason="edit_denied"
        ).inc()
        await ws.close(code=WS_CLOSE_FORBIDDEN, reason="edit denied")
        return

    sub_type = peek_sync_sub_type(frame)
    if sub_type == YSyncMessageType.SYNC_STEP1:
        try:
            reply = handle_sync_message(frame[1:], session.ydoc)
        except Exception as exc:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="malformed_sync_step1").inc()
            logger.warning(
                f"malformed SYNC_STEP1 frame from conn {handle.conn_id} on {doc_name}: {exc}",
                component=LOGGER_COMPONENT,
            )
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="malformed sync frame")
            return
        if reply is not None:
            framed = encode_doc_frame(doc_name, reply)
            try:
                handle.ws_session.outbound.put_nowait(framed)  # type: ignore[union-attr]
            except asyncio.QueueFull:
                logger.warning(
                    f"outbound full sending step2 to conn {handle.conn_id}",
                    component=LOGGER_COMPONENT,
                )
        return

    if sub_type in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE):
        try:
            decoder = Decoder(frame[2:])
            update_bytes = decoder.read_message()
        except Exception as exc:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="malformed_sync_update").inc()
            logger.warning(
                f"malformed sync update from conn {handle.conn_id} on {doc_name}: {exc}",
                component=LOGGER_COMPONENT,
            )
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="malformed sync frame")
            return
        if update_bytes and update_bytes != b"\x00\x00":
            REALTIME_UPDATE_MESSAGES_TOTAL.labels(
                content_type=handle.doc_key[0].value, direction="inbound"
            ).inc()
            try:
                await ydoc_manager.apply_local_update(
                    session, update_bytes, source_conn_id=handle.conn_id
                )
            except Exception as exc:
                REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="rejected_update").inc()
                logger.warning(
                    f"apply_update rejected from conn {handle.conn_id} on {doc_name}: {exc}",
                    component=LOGGER_COMPONENT,
                )
                await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="invalid update")
                return
