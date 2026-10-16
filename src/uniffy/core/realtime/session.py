"""Authenticated document traffic over one multiplexed WebSocket."""

import asyncio
import contextlib
import time

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.admission import SavingUnavailable, UpdateConflict
from uniffy.core.realtime.auth import WS_CLOSE_UNSUPPORTED_TYPE
from uniffy.core.realtime.awareness import authenticated_awareness
from uniffy.core.realtime.fanout import broadcast_awareness
from uniffy.core.realtime.limits import (
    AWARENESS_QUERY_INTERVAL_SECONDS,
    MAX_AWARENESS_BYTES,
    MAX_DOCS_PER_SOCKET,
    MAX_FRAME_BYTES,
    MAX_MESSAGES_PER_SECOND,
)
from uniffy.core.realtime.metrics import (
    REALTIME_AWARENESS_MESSAGES_TOTAL,
    REALTIME_FRAMES_DROPPED_TOTAL,
    REALTIME_PERMISSION_REJECTIONS_TOTAL,
    REALTIME_REAUTH_CLOSES_TOTAL,
    REALTIME_RECEIPT_LATENCY,
    REALTIME_WRITE_REJECTIONS,
)
from uniffy.core.realtime.multiplex import (
    encode_doc_frame,
    peek_var_string,
    read_var_string,
    read_var_uint,
)
from uniffy.core.realtime.reauth import (
    REAUTH_INTERVAL_SECONDS,
    Denial,
    connection_denial,
)
from uniffy.core.realtime.resident import handshake_messages, holds_unknown_updates
from uniffy.core.realtime.state import (
    ClientHandle,
    TokenBucket,
    WSSession,
    YDocSession,
    parse_doc_name,
)
from uniffy.core.realtime.storage import (
    DocumentTooLarge,
    EditDenied,
    GenerationConflict,
    SeedConflict,
)
from uniffy.core.realtime.wire import (
    MAX_WIRE_STRING_BYTES,
    MESSAGE_QUERY_AWARENESS,
    MESSAGE_SEED_CAPABILITY,
    MESSAGE_SEED_UPDATE,
    MESSAGE_UPDATE,
    Y_MESSAGE_AUTH,
    YMessageType,
    YSyncMessageType,
    create_accepted_receipt_message,
    create_auth_denied_message,
    create_committed_message,
    create_seed_rejected_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    is_sync_write_frame,
    peek_message_type,
    peek_sync_sub_type,
    sync_step1_state_vector,
)
from uniffy.core.realtime.ydoc_manager import YDocManager
from uniffy.infrastructure.database.session import open_session

logger = logger.bind(component="core.realtime.session")

WS_CLOSE_MESSAGE_TOO_BIG = 1009

# Retryable refusal: the client keeps the update and resends its id after a backoff.
UNAVAILABLE_REASON = "unavailable"
# The id already names other bytes; the client drops that id as rejected.
UPDATE_CONFLICT_REASON = "update conflict"
# Clients send the awareness query as this one byte; peers answer it, so nothing else is relayed.
AWARENESS_QUERY = bytes([MESSAGE_QUERY_AWARENESS])


async def run_multiplexed_session(
    ws: WebSocket, ws_session: WSSession, manager: YDocManager
) -> None:
    """Drive one multiplexed WebSocket; releases every attached doc on exit."""
    out_task = asyncio.create_task(_pump_outbound(ws, ws_session, manager))
    reauth_task = asyncio.create_task(_reauth_watchdog(ws, ws_session, manager))
    in_task = asyncio.create_task(_drive_inbound(ws, ws_session, manager))
    try:
        done, _ = await asyncio.wait(
            (out_task, reauth_task, in_task), return_when=asyncio.FIRST_COMPLETED
        )
        for task in done:
            await task
    except asyncio.QueueFull:
        REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="slow_consumer").inc()
        with contextlib.suppress(Exception):
            await ws.close(code=1013, reason="slow consumer")
    except WebSocketDisconnect:
        pass
    except RuntimeError as exc:
        # Starlette raises when receiving against a non-CONNECTED socket; demote to debug.
        logger.debug(f"session ended with starlette state error: {exc}")
    except Exception as exc:
        logger.exception(f"session loop crashed: {exc}")
    finally:
        for task in (out_task, reauth_task, in_task):
            task.cancel()
            with contextlib.suppress(BaseException):
                await task
        await manager.release_all(ws_session)
        # Code 1011 signals "reconnect"; code 1000 would suppress multiplexer backoff.
        with contextlib.suppress(BaseException):
            await ws.close(code=1011, reason="session ended")


async def _pump_outbound(ws: WebSocket, ws_session: WSSession, manager: YDocManager) -> None:
    while True:
        frame = await ws_session.outbound.get()
        doc_name, offset = peek_var_string(frame)
        key = parse_doc_name(doc_name)
        if key is not None and peek_message_type(frame[offset:]) != Y_MESSAGE_AUTH:
            handle = ws_session.doc_handles.get(key)
            if handle is None or handle.closed:
                continue
            await manager.access.authorize_outbound(key, ws_session.user_id)
            if handle.closed or key in ws_session.denied_docs:
                continue
        await ws.send_bytes(frame)


async def _reauth_watchdog(ws: WebSocket, ws_session: WSSession, manager: YDocManager) -> None:
    """Close the socket once its token, session or membership stops holding.

    The revoke fanout only reaches handles registered on a doc, so a connected
    socket with nothing attached is invisible to it. This task sees every
    socket, which also makes the token's own expiry a real ceiling.
    """
    while True:
        await asyncio.sleep(REAUTH_INTERVAL_SECONDS)
        denial = await connection_denial(ws_session)
        if denial is None:
            await manager.access.recheck(list(ws_session.doc_handles), ws_session.user_id)
            continue
        await _close_denied(ws, ws_session, denial)
        return


async def _close_denied(ws: WebSocket, ws_session: WSSession, denial: Denial) -> None:
    REALTIME_REAUTH_CLOSES_TOTAL.labels(reason=denial.metric_reason).inc()
    logger.info(
        f"closing conn {ws_session.conn_id} for user {ws_session.user_id}: {denial.metric_reason}"
    )
    with contextlib.suppress(BaseException):
        await ws.close(code=denial.code, reason=denial.reason)


async def _drive_inbound(ws: WebSocket, ws_session: WSSession, manager: YDocManager) -> None:
    frames = TokenBucket(capacity=MAX_MESSAGES_PER_SECOND * 2, per_second=MAX_MESSAGES_PER_SECOND)
    while True:
        frame = await ws.receive_bytes()
        if not frames.take():
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="rate_limit").inc()
            await ws.close(code=1013, reason="rate limit")
            return
        if len(frame) > MAX_FRAME_BYTES:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="oversized").inc()
            try:
                name, _ = peek_var_string(frame)
                key = parse_doc_name(name)
                if key is None:
                    raise ValueError("invalid document")
            except ValueError:
                await ws.close(code=WS_CLOSE_MESSAGE_TOO_BIG, reason="frame too large")
                return
            await ws_session.outbound.put(
                encode_doc_frame(name, create_auth_denied_message("update too large"))
            )
            continue

        try:
            doc_name, payload_offset = peek_var_string(frame)
        except ValueError as exc:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="malformed_prefix").inc()
            logger.warning(f"malformed multiplex prefix from conn {ws_session.conn_id}: {exc}")
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="malformed frame")
            return

        key = parse_doc_name(doc_name)
        if key is None:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="bad_docname").inc()
            logger.warning(f"unparseable docname {doc_name!r} from conn {ws_session.conn_id}")
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="bad docname")
            return

        payload = frame[payload_offset:]
        if not payload:
            continue
        if key in ws_session.denied_docs:
            continue

        handle = ws_session.doc_handles.get(key)
        attached = handle is None
        if handle is None:
            if len(ws_session.doc_handles) >= MAX_DOCS_PER_SOCKET:
                await ws_session.outbound.put(
                    encode_doc_frame(doc_name, create_auth_denied_message("too many open documents"))
                )
                continue
            handle = await _attach_doc(ws, ws_session, key, doc_name, manager)
            if handle is None:
                continue

        await _dispatch_doc_frame(
            ws, ws_session, handle, doc_name, payload, manager, attached=attached
        )


async def _attach_doc(
    ws: WebSocket,
    ws_session: WSSession,
    key: tuple,
    doc_name: str,
    manager: YDocManager,
) -> ClientHandle | None:
    """Lazy per-doc authorize + acquire on first frame. Closes with ``4403`` on denial."""
    content_type, content_id = key
    # An idle socket must not be able to attach its first doc after the token or
    # session behind it was revoked; the watchdog interval is not a grace period.
    denial = await connection_denial(ws_session)
    if denial is not None:
        await _close_denied(ws, ws_session, denial)
        return None

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
        logger.info(f"per-doc authorize denied for conn {ws_session.conn_id} on {doc_name}")
        ws_session.denied_docs.add(key)
        await ws_session.outbound.put(
            encode_doc_frame(doc_name, create_auth_denied_message("no view access", no_view=True))
        )
        return None

    can_edit = role_can_edit(role)
    try:
        session, handle = await manager.acquire(key, ws_session, can_edit=can_edit)
    except EditDenied:
        ws_session.denied_docs.add(key)
        await ws_session.outbound.put(
            encode_doc_frame(doc_name, create_auth_denied_message("no view access", no_view=True))
        )
        return None
    await manager.refresh_fragment_seeder(session)
    await manager.refresh_document(session)
    frames = [encode_doc_frame(doc_name, frame) for frame in handshake_messages(session)]
    if not can_edit:
        # Ahead of any sync frame, so a client holding a stale editable role never writes.
        frames.append(encode_doc_frame(doc_name, create_auth_denied_message("read only")))
    try:
        for framed in frames:
            ws_session.outbound.put_nowait(framed)
    except asyncio.QueueFull:
        logger.warning(f"outbound queue full during attach for conn {ws_session.conn_id}")
    return handle


async def _dispatch_doc_frame(
    ws: WebSocket,
    ws_session: WSSession,
    handle: ClientHandle,
    doc_name: str,
    payload: bytes,
    manager: YDocManager,
    *,
    attached: bool,
) -> None:
    """Route a demuxed y-protocols frame; ``attached`` marks the frame that attached the doc."""
    kind = peek_message_type(payload)
    if kind is None:
        return

    session = manager.resident(handle.doc_key)
    if session is None:
        return
    if (
        kind == YMessageType.SYNC
        and not attached
        and peek_sync_sub_type(payload) == YSyncMessageType.SYNC_STEP1
    ):
        # The attaching SyncStep1 creates the handle and stays unthrottled.
        await handle.ws_session.resyncs.wait()
    if kind != MESSAGE_UPDATE:
        # Admission reads the writer's role under the document lock and applies it to the handle.
        await manager.access.recheck([session.key], handle.user_id)
    if handle.closed:
        return

    if kind == MESSAGE_SEED_CAPABILITY:
        if len(payload) != 2 or payload[1] not in (0, 1):
            return
        handle.can_seed = bool(payload[1]) and handle.can_edit
        await manager.refresh_fragment_seeder(session)
    elif kind in (MESSAGE_UPDATE, MESSAGE_SEED_UPDATE):
        await _handle_write(ws_session, session, handle, doc_name, payload, manager)
    elif kind == YMessageType.SYNC:
        await _handle_sync_frame(ws, session, handle, doc_name, payload, manager, attached=attached)
    elif kind == YMessageType.AWARENESS:
        if len(payload) > MAX_AWARENESS_BYTES:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="awareness_too_large").inc()
            return
        try:
            payload = await authenticated_awareness(payload, handle)
        except ValueError, UnicodeDecodeError:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="invalid_awareness").inc()
            return
        REALTIME_AWARENESS_MESSAGES_TOTAL.labels(content_type=handle.doc_key[0].value).inc()
        broadcast_awareness(session, payload, source_conn_id=handle.conn_id)
    elif kind == MESSAGE_QUERY_AWARENESS:
        # Every peer answers a query with its own awareness, so relay only the canonical byte and
        # only once per handle and interval; clients ask once when they attach.
        now = time.monotonic()
        if payload != AWARENESS_QUERY or (
            handle.awareness_queried_at is not None
            and now - handle.awareness_queried_at < AWARENESS_QUERY_INTERVAL_SECONDS
        ):
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="awareness_query").inc()
            return
        handle.awareness_queried_at = now
        broadcast_awareness(session, AWARENESS_QUERY, source_conn_id=handle.conn_id)
    else:
        logger.debug(f"unknown message type {kind} on {doc_name}, dropping")


async def _handle_write(
    ws_session: WSSession,
    session: YDocSession,
    handle: ClientHandle,
    doc_name: str,
    payload: bytes,
    manager: YDocManager,
) -> None:
    """Type 6 answers an accepted receipt, or committed when the checkpoint already holds it.

    A type 8 seed proposal always answers committed.
    """
    started = time.perf_counter()
    seed = payload[0] == MESSAGE_SEED_UPDATE
    update_id = ""
    try:
        generation, offset = read_var_string(payload, 1, max_bytes=MAX_WIRE_STRING_BYTES)
        update_id, offset = read_var_string(payload, offset, max_bytes=MAX_WIRE_STRING_BYTES)
        seed_token = seed_base = ""
        if seed:
            seed_token, offset = read_var_string(payload, offset, max_bytes=MAX_WIRE_STRING_BYTES)
            seed_base, offset = read_var_string(payload, offset, max_bytes=MAX_FRAME_BYTES)
        length, offset = read_var_uint(payload, offset)
        if offset + length != len(payload):
            raise ValueError("invalid update length")
        if seed:
            await manager.apply_seed_update(
                session,
                payload[offset:],
                source_conn_id=handle.conn_id,
                generation=generation,
                seed_token=seed_token,
                seed_base=seed_base,
            )
            reply = create_committed_message(update_id)
        else:
            receipt = await manager.apply_local_update(
                session,
                payload[offset:],
                source_conn_id=handle.conn_id,
                generation=generation,
                update_id=update_id,
            )
            reply = (
                create_committed_message(update_id)
                if receipt is None
                else create_accepted_receipt_message(
                    update_id=update_id,
                    generation=receipt.generation,
                    epoch=receipt.epoch,
                    accepted_sequence=receipt.seq,
                )
            )
            REALTIME_RECEIPT_LATENCY.observe(time.perf_counter() - started)
    except DocumentTooLarge:
        REALTIME_WRITE_REJECTIONS.labels(reason="too_large").inc()
        REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="document_too_large").inc()
        reply = create_auth_denied_message("update too large")
    except ValueError:
        REALTIME_WRITE_REJECTIONS.labels(reason="invalid_update").inc()
        reply = create_auth_denied_message("invalid update")
    except GenerationConflict:
        REALTIME_WRITE_REJECTIONS.labels(reason="generation").inc()
        await manager.refresh_document(session)
        for frame in handshake_messages(session):
            await ws_session.outbound.put(encode_doc_frame(doc_name, frame))
        reply = create_update_message(session.ydoc.get_update())
    except SeedConflict:
        REALTIME_WRITE_REJECTIONS.labels(reason="seed").inc()
        await manager.refresh_document(session)
        reply = (
            create_seed_rejected_message(update_id)
            if seed
            else create_auth_denied_message("seed_conflict")
        )
    except EditDenied:
        REALTIME_WRITE_REJECTIONS.labels(reason="edit_denied").inc()
        if handle.closed:
            # The writer lost view access and its handle already received the document denial.
            return
        reply = create_auth_denied_message("edit denied")
    except UpdateConflict:
        REALTIME_WRITE_REJECTIONS.labels(reason="update_conflict").inc()
        reply = create_auth_denied_message(UPDATE_CONFLICT_REASON)
    except SavingUnavailable as exc:
        REALTIME_WRITE_REJECTIONS.labels(reason=exc.reason).inc()
        reply = create_auth_denied_message(UNAVAILABLE_REASON)
    await ws_session.outbound.put(encode_doc_frame(doc_name, reply))


async def _handle_sync_frame(
    ws: WebSocket,
    session: YDocSession,
    handle: ClientHandle,
    doc_name: str,
    frame: bytes,
    manager: YDocManager,
    *,
    attached: bool,
) -> None:
    """Dispatch a SYNC frame (step1 / step2 / update)."""
    outbound = handle.ws_session.outbound
    if not handle.can_edit and is_sync_write_frame(frame):
        REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
            content_type=handle.doc_key[0].value, reason="edit_denied"
        ).inc()
        await outbound.put(encode_doc_frame(doc_name, create_auth_denied_message("edit denied")))
        return

    sub_type = peek_sync_sub_type(frame)
    if sub_type == YSyncMessageType.SYNC_STEP1:
        # Attaching just refreshed and sent the handshake; a later resync compares heads, so a
        # missed hint or progress frame repairs here.
        if not attached:
            await manager.refresh_document(session)
            for state_frame in handshake_messages(session):
                await outbound.put(encode_doc_frame(doc_name, state_frame))
        try:
            reply = handle_sync_message(frame[1:], session.ydoc)
            # Clients ignore a server SyncStep1 within their epoch. One attaching after a buffer
            # reset it never heard of may hold updates the reset lost, so ask it back then.
            ask = (
                attached
                and handle.can_edit
                and holds_unknown_updates(session, sync_step1_state_vector(frame))
            )
        except Exception as exc:
            REALTIME_FRAMES_DROPPED_TOTAL.labels(kind="malformed_sync_step1").inc()
            logger.warning(
                f"malformed SYNC_STEP1 frame from conn {handle.conn_id} on {doc_name}: {exc}"
            )
            await ws.close(code=WS_CLOSE_UNSUPPORTED_TYPE, reason="malformed sync frame")
            return
        frames = [create_sync_message(session.ydoc)] if ask else []
        if reply is not None:
            frames.append(reply)
        try:
            for each in frames:
                outbound.put_nowait(encode_doc_frame(doc_name, each))
        except asyncio.QueueFull:
            logger.warning(f"outbound full answering SyncStep1 from conn {handle.conn_id}")
        return

    if sub_type in (YSyncMessageType.SYNC_STEP2, YSyncMessageType.SYNC_UPDATE):
        # Untagged writes cannot prove which document generation they belong to.
        await outbound.put(
            encode_doc_frame(doc_name, create_auth_denied_message("client update required"))
        )
