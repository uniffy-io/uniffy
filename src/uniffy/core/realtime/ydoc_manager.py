"""In-memory YDoc cache + client-handle registry keyed by ``(content_type, content_id)``.

Owns cold-start hydration, local peer fanout, snapshot debounce, 15-minute idle
eviction, the role-change decision matrix, and the token-revoke close path.
:class:`RealtimeRouter` dispatches Valkey payloads back here via
:class:`RouterCallbacks`.
"""

import asyncio
import contextlib
import time
from uuid import UUID

import pycrdt
from loguru import logger
from sqlalchemy import select

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.models.realtime.yjs_snapshot import RealtimeYjsSnapshot
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_TOKEN_REVOKED,
)
from uniffy.core.realtime.identity import replica_id
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.publisher import publish_doc_update
from uniffy.core.realtime.router import RouterCallbacks, router
from uniffy.core.realtime.snapshot import snapshot_writer
from uniffy.core.realtime.state import (
    ClientHandle,
    DocKey,
    WSSession,
    YDocSession,
    doc_name_for,
)
from uniffy.core.realtime.wire import create_update_message
from uniffy.db.session import open_session
from uniffy.observability.metrics import (
    REALTIME_ACTIVE_CLIENTS,
    REALTIME_ACTIVE_DOCS,
    REALTIME_FRAMES_DROPPED_TOTAL,
    REALTIME_HYDRATION_DURATION,
    REALTIME_PERMISSION_REJECTIONS_TOTAL,
    REALTIME_UPDATE_MESSAGES_TOTAL,
)

__all__ = ["ClientHandle", "DocKey", "WSSession", "YDocManager", "YDocSession", "ydoc_manager"]

IDLE_EVICTION_SECONDS = 15 * 60

_ROLES_REQUIRING_CLOSE: frozenset[str | None] = frozenset({None, "BLOCKED"})
_ROLES_VIEW_ONLY: frozenset[str] = frozenset({"VIEWER"})

LOGGER_COMPONENT = "realtime.manager"


class YDocManager:
    """Process-wide registry of live ``YDocSession`` instances."""

    def __init__(self) -> None:
        self._sessions: dict[DocKey, YDocSession] = {}
        # Per-key lock so hydration of one doc cannot stall concurrent connects to others.
        self._hydration_locks: dict[DocKey, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()
        self._replica_id = replica_id()

    @property
    def replica_id(self) -> str:
        return self._replica_id

    def router_callbacks(self) -> RouterCallbacks:
        return RouterCallbacks(
            apply_remote_update=self._apply_remote_pubsub_update,
            enforce_role_change=self._enforce_role_change,
            close_stale_user_sessions=self._close_stale_user_sessions,
            reauthorize_doc=self._reauthorize_doc_by_key,
        )

    async def acquire(
        self,
        key: DocKey,
        ws_session: WSSession,
        *,
        can_edit: bool,
    ) -> tuple[YDocSession, ClientHandle]:
        """Return the shared session and a fresh handle; lazily hydrates on first acquire."""
        async with self._global_lock:
            session = self._sessions.get(key)
            if session is not None:
                return session, self._attach_client(session, ws_session, can_edit=can_edit)
            hydration_lock = self._hydration_locks.setdefault(key, asyncio.Lock())

        async with hydration_lock:
            async with self._global_lock:
                session = self._sessions.get(key)

            if session is None:
                session = await self._hydrate(key, ws_session.organization_id)
                async with self._global_lock:
                    self._sessions[key] = session
                router.register_doc_session(key, session)
                REALTIME_ACTIVE_DOCS.labels(content_type=key[0].value).inc()

            async with self._global_lock:
                self._hydration_locks.pop(key, None)
                return session, self._attach_client(session, ws_session, can_edit=can_edit)

    def _attach_client(
        self,
        session: YDocSession,
        ws_session: WSSession,
        *,
        can_edit: bool,
    ) -> ClientHandle:
        """Register a new client on an existing session; caller holds ``_global_lock``."""
        if session.eviction_task is not None:
            session.eviction_task.cancel()
            session.eviction_task = None
        handle = ClientHandle(
            conn_id=ws_session.conn_id,
            user_id=ws_session.user_id,
            can_edit=can_edit,
            token_version=ws_session.token_version,
            ws=ws_session.ws,
            doc_key=session.key,
            ws_session=ws_session,
        )
        session.clients[ws_session.conn_id] = handle
        ws_session.doc_handles[session.key] = handle
        router.attach_handle(session.key, handle)
        REALTIME_ACTIVE_CLIENTS.labels(content_type=session.key[0].value).inc()
        return handle

    async def release(self, key: DocKey, conn_id: int) -> None:
        """Drop a client handle; schedule idle eviction if the session is now empty."""
        async with self._global_lock:
            session = self._sessions.get(key)
            if session is None:
                return
            handle = session.clients.pop(conn_id, None)
            if handle is not None:
                router.detach_handle(key, handle)
                if handle.ws_session is not None:
                    handle.ws_session.doc_handles.pop(key, None)
                REALTIME_ACTIVE_CLIENTS.labels(content_type=key[0].value).dec()
            if not session.clients and session.eviction_task is None:
                session.eviction_task = asyncio.create_task(self._evict_after_idle(key))

    async def release_all(self, ws_session: WSSession) -> None:
        """Tear down every doc attachment on ``ws_session``."""
        for key in list(ws_session.doc_handles.keys()):
            await self.release(key, ws_session.conn_id)

    async def apply_local_update(
        self,
        session: YDocSession,
        update_bytes: bytes,
        *,
        source_conn_id: int,
    ) -> None:
        """Apply a local client's update, fan out to other local clients, and publish to Valkey."""
        content_type_label = session.key[0].value
        async with session.lock:
            session.ydoc.apply_update(update_bytes)
            frame = create_update_message(update_bytes)
            for cid, peer in session.clients.items():
                if cid == source_conn_id:
                    continue
                enqueue_for_handle(peer, frame, kind="update")
                REALTIME_UPDATE_MESSAGES_TOTAL.labels(
                    content_type=content_type_label, direction="local_fanout"
                ).inc()

        await publish_doc_update(
            session.key[0],
            session.key[1],
            update_bytes,
            source_conn_id=source_conn_id,
        )
        REALTIME_UPDATE_MESSAGES_TOTAL.labels(
            content_type=content_type_label, direction="pubsub_out"
        ).inc()
        await snapshot_writer.schedule(session)

    async def broadcast_awareness(
        self,
        session: YDocSession,
        frame: bytes,
        *,
        source_conn_id: int,
    ) -> None:
        """Re-broadcast awareness to every peer except the source. Drops on full queues."""
        for cid, peer in session.clients.items():
            if cid == source_conn_id:
                continue
            enqueue_for_handle(peer, frame, kind="awareness")

    async def _hydrate(
        self,
        key: DocKey,
        organization_id: UUID,
    ) -> YDocSession:
        """Seed a fresh ``YDocSession`` from snapshot or domain row."""
        content_type, content_id = key
        ydoc = pycrdt.Doc()
        started = time.perf_counter()
        source = "snapshot"

        async with open_session() as db:
            snapshot = (
                await db.execute(
                    select(RealtimeYjsSnapshot).where(
                        RealtimeYjsSnapshot.content_type == content_type,
                        RealtimeYjsSnapshot.content_id == content_id,
                    )
                )
            ).scalar_one_or_none()

            if snapshot is not None:
                ydoc.apply_update(snapshot.updates)
                logger.debug(
                    f"hydrated {content_type.value}:{content_id} from snapshot",
                    component=LOGGER_COMPONENT,
                )
            else:
                source = "domain"
                adapter = get_realtime_adapter(content_type)
                await adapter.hydrate_ydoc(db, ydoc, content_id, organization_id)
                logger.debug(
                    f"hydrated {content_type.value}:{content_id} from domain row",
                    component=LOGGER_COMPONENT,
                )

        REALTIME_HYDRATION_DURATION.labels(
            content_type=content_type.value, source=source
        ).observe(time.perf_counter() - started)
        return YDocSession(key=key, ydoc=ydoc, organization_id=organization_id)

    async def _evict_after_idle(self, key: DocKey) -> None:
        """Drop the session from memory if no client reconnects within ``IDLE_EVICTION_SECONDS``."""
        try:
            await asyncio.sleep(IDLE_EVICTION_SECONDS)
        except asyncio.CancelledError:
            return

        async with self._global_lock:
            session = self._sessions.get(key)
            if session is None or session.clients:
                return
            del self._sessions[key]

        router.unregister_doc_session(key)
        REALTIME_ACTIVE_DOCS.labels(content_type=key[0].value).dec()

        with contextlib.suppress(Exception):
            await snapshot_writer.flush(session, force=True)
        logger.info(
            f"evicted idle session {key[0].value}:{key[1]}",
            component=LOGGER_COMPONENT,
        )

    async def _apply_remote_pubsub_update(
        self, session: YDocSession, update_bytes: bytes
    ) -> None:
        """Apply a peer-replica update and fan out to local clients without re-publishing."""
        content_type_label = session.key[0].value
        REALTIME_UPDATE_MESSAGES_TOTAL.labels(
            content_type=content_type_label, direction="pubsub_in"
        ).inc()
        async with session.lock:
            session.ydoc.apply_update(update_bytes)
            frame = create_update_message(update_bytes)
            for peer in session.clients.values():
                enqueue_for_handle(peer, frame, kind="update")

        await snapshot_writer.schedule(session)

    async def _enforce_role_change(
        self, handle: ClientHandle, new_role: object
    ) -> None:
        if new_role in _ROLES_REQUIRING_CLOSE:
            if handle.doc_key is not None:
                REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
                    content_type=handle.doc_key[0].value, reason="role_revoked"
                ).inc()
            await self._close_handle(handle, WS_CLOSE_FORBIDDEN, "access revoked")
            return
        if new_role in _ROLES_VIEW_ONLY:
            handle.can_edit = False
            return
        handle.can_edit = True

    async def _reauthorize_doc_by_key(self, key: DocKey) -> None:
        """Re-run authorize for every attached client; downgrade or close per result."""
        session = self._sessions.get(key)
        if session is None or not session.clients:
            return
        await self._reauthorize_all(session)

    async def _reauthorize_all(self, session: YDocSession) -> None:
        content_type, content_id = session.key
        adapter = get_realtime_adapter(content_type)
        affected = list(session.clients.values())
        if not affected:
            return

        async with open_session() as db:
            for handle in affected:
                try:
                    role = await adapter.authorize(
                        db, handle.user_id, session.organization_id, content_id
                    )
                except Exception:
                    logger.exception(
                        "reauthorize failed; closing session as forbidden",
                        component=LOGGER_COMPONENT,
                    )
                    REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
                        content_type=content_type.value, reason="reauthorize_failed"
                    ).inc()
                    await self._close_handle(handle, WS_CLOSE_FORBIDDEN, "reauthorize failed")
                    continue

                if role is None or not role_can_view(role):
                    REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
                        content_type=content_type.value, reason="role_revoked"
                    ).inc()
                    await self._close_handle(handle, WS_CLOSE_FORBIDDEN, "access revoked")
                    continue
                handle.can_edit = role_can_edit(role)

    async def _close_stale_user_sessions(self, user_id: UUID, new_version: int) -> None:
        """Close every handle for ``user_id`` whose ``token_version`` predates ``new_version``."""
        affected: list[ClientHandle] = []
        for session in self._sessions.values():
            for handle in session.clients.values():
                if handle.user_id != user_id:
                    continue
                if handle.token_version is None or handle.token_version < new_version:
                    affected.append(handle)

        for handle in affected:
            await self._close_handle(handle, WS_CLOSE_TOKEN_REVOKED, "token revoked")

    async def _close_handle(
        self, handle: ClientHandle, code: int, reason: str
    ) -> None:
        if handle.closed:
            return
        handle.closed = True
        with contextlib.suppress(BaseException):
            await handle.ws.close(code=code, reason=reason)


def enqueue_for_handle(handle: ClientHandle, frame: bytes, *, kind: str) -> None:
    """Best-effort enqueue onto the owning WS's outbound queue. Drops on
    full to protect the broadcaster.
    """
    if handle.ws_session is None or handle.doc_key is None:
        return
    framed = encode_doc_frame(doc_name_for(handle.doc_key), frame)
    try:
        handle.ws_session.outbound.put_nowait(framed)
    except asyncio.QueueFull:
        REALTIME_FRAMES_DROPPED_TOTAL.labels(kind=f"outbound_full_{kind}").inc()
        logger.warning(
            f"outbound queue full for conn {handle.conn_id}; dropping {kind} frame",
            component=LOGGER_COMPONENT,
        )


ydoc_manager = YDocManager()
router.register_callbacks(ydoc_manager.router_callbacks())
