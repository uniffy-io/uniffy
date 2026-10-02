"""In-memory YDoc cache + client-handle registry keyed by ``(content_type, content_id)``.

Owns cold-start hydration, local peer fanout, snapshot debounce, 15-minute idle
eviction, permission re-authorization, and the token-revoke close path.
:class:`RealtimeRouter` dispatches Valkey payloads back here via
:class:`RouterCallbacks`.
"""

import asyncio
import contextlib
import time
from collections.abc import Sequence
from uuid import UUID

import pycrdt
from loguru import logger

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_TOKEN_REVOKED,
)
from uniffy.core.realtime.identity import replica_id
from uniffy.core.realtime.markdown import DOC_GENERATION_KEY, DOC_META_FIELD
from uniffy.core.realtime.metrics import (
    REALTIME_ACTIVE_CLIENTS,
    REALTIME_ACTIVE_DOCS,
    REALTIME_FRAMES_DROPPED_TOTAL,
    REALTIME_HYDRATION_DURATION,
    REALTIME_PERMISSION_REJECTIONS_TOTAL,
    REALTIME_SNAPSHOT_DROPPED_TOTAL,
    REALTIME_UPDATE_MESSAGES_TOTAL,
)
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
from uniffy.core.realtime.storage import (
    accept_update,
    claim_seed,
    decode_snapshot,
    load_snapshot,
    lock_document,
    stage_seed,
)
from uniffy.core.realtime.wire import (
    create_auth_denied_message,
    create_fragment_seeder_message,
    create_generation_message,
    create_update_message,
)
from uniffy.core.types import ContentRole
from uniffy.infrastructure.database.session import open_session

__all__ = ["ClientHandle", "DocKey", "WSSession", "YDocManager", "YDocSession", "ydoc_manager"]

IDLE_EVICTION_SECONDS = 15 * 60
# Bounded so a slow database cannot hold the process past its graceful-shutdown window.
SHUTDOWN_FLUSH_TIMEOUT_SECONDS = 5.0

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
            apply_content_replace=self._apply_content_replace,
            close_stale_user_sessions=self._close_stale_user_sessions,
            close_user_session_by_sid=self._close_user_session_by_sid,
            reauthorize_docs=self._reauthorize_docs,
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
            session_id=ws_session.session_id,
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
            await self.refresh_fragment_seeder(session)
            if not session.clients and session.eviction_task is None:
                session.eviction_task = asyncio.create_task(self._evict_after_idle(key))

    async def release_all(self, ws_session: WSSession) -> None:
        """Tear down every doc attachment on ``ws_session``."""
        for key in list(ws_session.doc_handles.keys()):
            await self.release(key, ws_session.conn_id)

    async def refresh_fragment_seeder(self, session: YDocSession) -> None:
        candidates = [
            f"{self._replica_id}:{handle.conn_id}"
            for handle in session.clients.values()
            if handle.can_edit and not handle.closed
        ]
        owner = await claim_seed(session.key, session.organization_id, candidates, self._replica_id)
        selected = next(
            (
                handle.conn_id
                for handle in session.clients.values()
                if f"{self._replica_id}:{handle.conn_id}" == owner
            ),
            None,
        )
        previous = session.seeder_conn_id
        session.seeder_conn_id = selected
        if previous == selected:
            return
        for handle in session.clients.values():
            if handle.conn_id == selected or handle.conn_id == previous:
                enqueue_for_handle(
                    handle, create_fragment_seeder_message(handle.conn_id == selected), kind="seeder"
                )

    async def flush_all(self, *, timeout: float = SHUTDOWN_FLUSH_TIMEOUT_SECONDS) -> None:
        """Force-flush every live doc; a stopping process must not hold the only copy of edits."""
        sessions = list(self._sessions.values())
        if not sessions:
            return
        try:
            await asyncio.wait_for(
                asyncio.gather(*(self._flush_for_shutdown(session) for session in sessions)),
                timeout,
            )
            logger.info(f"flushed {len(sessions)} live docs on shutdown", component=LOGGER_COMPONENT)
        except TimeoutError:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type="all", reason="shutdown_timeout"
            ).inc()
            logger.warning(
                f"shutdown flush timed out after {timeout}s with {len(sessions)} live docs",
                component=LOGGER_COMPONENT,
            )

    async def _flush_for_shutdown(self, session: YDocSession) -> None:
        try:
            await snapshot_writer.flush(session, force=True)
        except Exception:
            REALTIME_SNAPSHOT_DROPPED_TOTAL.labels(
                content_type=session.key[0].value, reason="shutdown_flush_failed"
            ).inc()
            logger.exception(
                f"shutdown flush failed for {session.key[0].value}:{session.key[1]}",
                component=LOGGER_COMPONENT,
            )

    async def apply_local_update(
        self,
        session: YDocSession,
        update_bytes: bytes,
        *,
        source_conn_id: int,
        generation: str,
    ) -> None:
        """Apply a local client's update, fan out to other local clients, and publish to Valkey."""
        content_type_label = session.key[0].value
        source = session.clients.get(source_conn_id)
        editor_id = source.user_id if source is not None else None
        if editor_id is None:
            return
        await accept_update(
            session.key, session.organization_id, editor_id, generation, update_bytes
        )
        session.last_editor_id = editor_id
        await self.refresh_document(session)

        await publish_doc_update(
            session.key[0],
            session.key[1],
            update_bytes,
            source_conn_id=source_conn_id,
            editor_id=editor_id,
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
            adapter = get_realtime_adapter(content_type)
            await lock_document(db, key, organization_id)
            snapshot = await stage_seed(db, key, organization_id)
            ydoc.apply_update(snapshot.updates)
            await db.commit()
            policy_key = await adapter.policy_key(db, content_id, organization_id)

        REALTIME_HYDRATION_DURATION.labels(content_type=content_type.value, source=source).observe(
            time.perf_counter() - started
        )
        return YDocSession(
            key=key, ydoc=ydoc, organization_id=organization_id, policy_key=policy_key
        )

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

        # Invariant: the force flush completes while the session stays registered,
        # so a concurrent acquire reuses the in-memory doc and can never hydrate
        # from the pre-flush snapshot row.
        try:
            await snapshot_writer.flush(session, force=True)
        except asyncio.CancelledError:
            # A client re-attached mid-flush and cancelled this task; keep the session.
            return
        except Exception:
            logger.exception(
                f"eviction flush failed for {key[0].value}:{key[1]}",
                component=LOGGER_COMPONENT,
            )
            async with self._global_lock:
                if self._sessions.get(key) is session and not session.clients:
                    session.eviction_task = asyncio.create_task(self._evict_after_idle(key))
            return

        async with self._global_lock:
            session = self._sessions.get(key)
            if session is None or session.clients:
                return
            del self._sessions[key]

        router.unregister_doc_session(key)
        REALTIME_ACTIVE_DOCS.labels(content_type=key[0].value).dec()
        logger.info(
            f"evicted idle session {key[0].value}:{key[1]}",
            component=LOGGER_COMPONENT,
        )

    async def _apply_remote_pubsub_update(
        self, session: YDocSession, update_bytes: bytes, editor_id: UUID | None = None
    ) -> None:
        """Apply a peer-replica update and fan out to local clients without re-publishing."""
        await self.refresh_document(session)

    async def refresh_document(self, session: YDocSession) -> None:
        async with session.lock:
            async with open_session() as db:
                snapshot = await load_snapshot(db, session.key)
            if snapshot is None:
                return
            generation = snapshot.generation or ""
            current = session.ydoc.get(DOC_META_FIELD, type=pycrdt.Map).get(DOC_GENERATION_KEY, "")
            if current != generation:
                session.ydoc = decode_snapshot(snapshot)
            else:
                session.ydoc.apply_update(snapshot.updates)
            for peer in list(session.clients.values()):
                enqueue_for_handle(peer, create_generation_message(generation), kind="generation")
                enqueue_for_handle(peer, create_update_message(snapshot.updates), kind="update")
            await self.refresh_fragment_seeder(session)

    async def _apply_content_replace(self, key: DocKey, content: str) -> None:
        session = self._sessions.get(key)
        if session is not None:
            await self.refresh_document(session)

    async def _reauthorize_docs(self, keys: Sequence[DocKey], user_id: UUID | None) -> None:
        """Re-run authorize for attached clients; ``user_id`` narrows to that user's handles.

        One checker per call so authorization facts load once per user and policy row,
        not once per handle.
        """
        targets: list[tuple[YDocSession, list[ClientHandle]]] = []
        for key in keys:
            session = self._sessions.get(key)
            if session is None:
                continue
            handles = [
                handle
                for handle in session.clients.values()
                if user_id is None or handle.user_id == user_id
            ]
            if handles:
                targets.append((session, handles))
        if not targets:
            return

        decisions: list[tuple[YDocSession, ClientHandle, ContentRole | None]] = []
        async with open_session() as db:
            checker = PermissionChecker(db)
            for session, handles in targets:
                adapter = get_realtime_adapter(session.key[0])
                for handle in handles:
                    try:
                        role = await adapter.authorize(
                            db,
                            handle.user_id,
                            session.organization_id,
                            session.key[1],
                            checker=checker,
                        )
                    except Exception:
                        logger.exception("Realtime authorization failed")
                        role = None
                    decisions.append((session, handle, role))
        for session, handle, role in decisions:
            if role is None or not role_can_view(role):
                REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
                    content_type=session.key[0].value, reason="role_revoked"
                ).inc()
                await self._close_handle(handle, WS_CLOSE_FORBIDDEN, "access revoked")
                continue
            can_edit = role_can_edit(role)
            if handle.can_edit and not can_edit:
                enqueue_for_handle(
                    handle, create_auth_denied_message("edit access removed"), kind="auth"
                )
            changed = handle.can_edit != can_edit
            handle.can_edit = can_edit
            if changed:
                await self.refresh_fragment_seeder(session)

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

    async def _close_user_session_by_sid(self, user_id: UUID, session_id: UUID) -> None:
        """Close handles bound to a single revoked session.

        Used for per-session logout / "revoke this device" where the
        user's ``token_version`` does NOT bump - only the matching
        ``sid`` is gone. Handles without a ``session_id`` (legacy
        tokens before sid tracking) are left alone here; the
        ``_close_stale_user_sessions`` path catches the broader bump.
        """
        affected: list[ClientHandle] = []
        for session in self._sessions.values():
            for handle in session.clients.values():
                if handle.user_id != user_id:
                    continue
                if handle.session_id is None or handle.session_id != session_id:
                    continue
                affected.append(handle)

        for handle in affected:
            await self._close_handle(handle, WS_CLOSE_TOKEN_REVOKED, "session revoked")

    async def _close_handle(self, handle: ClientHandle, code: int, reason: str) -> None:
        if handle.closed:
            return
        if code == WS_CLOSE_FORBIDDEN and handle.doc_key is not None:
            enqueue_for_handle(handle, create_auth_denied_message(reason, no_view=True), kind="auth")
            if handle.ws_session is not None:
                handle.ws_session.denied_docs.add(handle.doc_key)
            handle.closed = True
            await self.release(handle.doc_key, handle.conn_id)
            return
        handle.closed = True
        if handle.doc_key is not None:
            session = self._sessions.get(handle.doc_key)
            if session is not None:
                await self.refresh_fragment_seeder(session)
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
