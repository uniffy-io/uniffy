"""Resident document caches follow PostgreSQL checkpoints and the Valkey update buffer."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pycrdt
from loguru import logger

from uniffy.core.realtime.access import AccessGates
from uniffy.core.realtime.admission import Admitted, RoleRefused, SavingUnavailable, admit_update
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.realtime.buffer_keys import Receipt
from uniffy.core.realtime.fanout import (
    AcceptedEffects,
    AcceptedUpdate,
    broadcast,
    enqueue_for_handle,
)
from uniffy.core.realtime.hydration import hydrate, realign
from uniffy.core.realtime.identity import replica_id
from uniffy.core.realtime.live import LiveStateUnavailable, accept_seed, claim_seed
from uniffy.core.realtime.markdown import PROSEMIRROR_FRAGMENT_FIELD
from uniffy.core.realtime.metrics import (
    REALTIME_ACTIVE_CLIENTS,
    REALTIME_ACTIVE_DOCS,
    REALTIME_GAP_REPAIRS_TOTAL,
)
from uniffy.core.realtime.resident import Continuity, follow_record
from uniffy.core.realtime.router import RealtimeRouter, RemoteUpdate, RouterCallbacks
from uniffy.core.realtime.seeding import has_fragment_content
from uniffy.core.realtime.state import ClientHandle, DocKey, WSSession, YDocSession
from uniffy.core.realtime.storage import EditDenied
from uniffy.core.realtime.wire import (
    CheckpointProgress,
    create_checkpoint_progress_message,
    create_fragment_seeder_message,
    create_update_message,
)

logger = logger.bind(component="core.realtime.ydoc_manager")

__all__ = ["YDocManager"]

IDLE_EVICTION_SECONDS = 15 * 60
# Bounded so a slow pubsub cannot hold the process past its graceful-shutdown window.
SHUTDOWN_DRAIN_SECONDS = 5.0
SEED_RETRY_SECONDS = 1.0


class YDocManager:
    """Registry of the live ``YDocSession`` instances one replica holds."""

    def __init__(
        self,
        *,
        buffer: UpdateBuffer,
        replica: str | None = None,
        idle_eviction_seconds: float = IDLE_EVICTION_SECONDS,
    ) -> None:
        self._sessions: dict[DocKey, YDocSession] = {}
        # Per-key lock so hydration of one doc cannot stall concurrent connects to others.
        self._hydration_locks: dict[DocKey, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()
        self._replica_id = replica or replica_id()
        self._buffer = buffer
        # Shares the replica id so the router drops exactly this manager's own echoes.
        self._router = RealtimeRouter(self._replica_id)
        self._idle_eviction_seconds = idle_eviction_seconds
        self._effects = AcceptedEffects(self._replica_id, self.refresh_fragment_seeder)
        self.access = AccessGates(
            self._sessions, release=self.release, reelect_seeder=self._reelect_seeder
        )

    @property
    def replica_id(self) -> str:
        return self._replica_id

    @property
    def realtime_router(self) -> RealtimeRouter:
        return self._router

    def install(self) -> None:
        """Route this process's document, permission and auth signals to this manager."""
        self._router.register_callbacks(
            RouterCallbacks(
                apply_remote_update=self._apply_remote_update,
                apply_checkpoint_progress=self._apply_checkpoint_progress,
                reload_document=self._reload_document,
                close_stale_user_sessions=self.access.close_stale_user_sessions,
                close_user_session_by_sid=self.access.close_user_session_by_sid,
                recheck_access=self.access.recheck,
            )
        )

    def resident(self, key: DocKey) -> YDocSession | None:
        return self._sessions.get(key)

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
                session = await hydrate(
                    self._buffer, key, ws_session.organization_id, ws_session.user_id
                )
                async with self._global_lock:
                    self._sessions[key] = session
                self._router.register_doc_session(key, session)
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
        self._router.attach_handle(session.key, handle)
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
                handle.closed = True
                self._router.detach_handle(key, handle)
                handle.ws_session.doc_handles.pop(key, None)
                REALTIME_ACTIVE_CLIENTS.labels(content_type=key[0].value).dec()
            if not session.clients and session.eviction_task is None:
                session.eviction_task = asyncio.create_task(self._evict_after_idle(key))
        await self._reelect_seeder(session)

    async def release_all(self, ws_session: WSSession) -> None:
        """Tear down every doc attachment on ``ws_session``."""
        for key in list(ws_session.doc_handles.keys()):
            await self.release(key, ws_session.conn_id)

    async def refresh_fragment_seeder(self, session: YDocSession) -> None:
        async with session.seed_lock:
            candidates = [
                f"{self._replica_id}:{handle.conn_id}"
                for handle in session.clients.values()
                if handle.can_edit and handle.can_seed and not handle.closed
            ]
            initialized = has_fragment_content(
                session.ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, type=pycrdt.XmlFragment)
            )
            try:
                lease = (
                    None
                    if initialized or (not candidates and session.seeder_conn_id is None)
                    else await claim_seed(
                        self._buffer,
                        session.key,
                        session.organization_id,
                        candidates,
                        self._replica_id,
                    )
                )
            except LiveStateUnavailable:
                # The election reads live state; keep the current seeder and ask again shortly.
                self._schedule_seed_refresh(session, SEED_RETRY_SECONDS)
                return
            selected = next(
                (
                    handle.conn_id
                    for handle in session.clients.values()
                    if lease and f"{self._replica_id}:{handle.conn_id}" == lease.owner
                ),
                None,
            )
            token = lease.token if lease else ""
            previous = session.seeder_conn_id
            changed = previous != selected or session.seed_token != token
            session.seeder_conn_id = selected
            session.seed_token = token
            expires_at = lease.expires_at if lease else None
            if (
                session.seed_expires_at != expires_at
                or session.seed_task is None
                or not session.clients
            ):
                session.seed_expires_at = expires_at
                delay = (
                    max(0.01, (expires_at - datetime.now(UTC)).total_seconds())
                    if expires_at
                    else None
                )
                self._schedule_seed_refresh(session, delay)
            if not changed:
                return
            for handle in session.clients.values():
                if handle.conn_id == selected or handle.conn_id == previous:
                    enqueue_for_handle(
                        handle,
                        create_fragment_seeder_message(
                            handle.conn_id == selected, token if handle.conn_id == selected else ""
                        ),
                        kind="seeder",
                    )

    async def _reelect_seeder(self, session: YDocSession) -> None:
        """Re-elect without failing the caller; a failed election retries shortly."""
        try:
            await self.refresh_fragment_seeder(session)
        except Exception:
            logger.exception("Seed refresh failed; retrying")
            self._schedule_seed_refresh(session, SEED_RETRY_SECONDS)

    def _schedule_seed_refresh(self, session: YDocSession, delay: float | None) -> None:
        if session.seed_task is not None and session.seed_task is not asyncio.current_task():
            session.seed_task.cancel()
        session.seed_task = None
        if delay is not None and session.clients:
            session.seed_task = asyncio.create_task(self._refresh_seed_after(session, delay))

    async def _refresh_seed_after(self, session: YDocSession, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        session.seed_task = None
        if session.clients:
            await self._reelect_seeder(session)

    async def drain_for_shutdown(self, *, timeout: float = SHUTDOWN_DRAIN_SECONDS) -> None:
        """Stop seed lease timers and give queued peer hints ``timeout`` to publish.

        Writes no document state: accepted edits already wait in the buffer with their
        checkpoint scheduled.
        """
        for session in list(self._sessions.values()):
            self._schedule_seed_refresh(session, None)
        await self._effects.drain(timeout)

    async def apply_local_update(
        self,
        session: YDocSession,
        update_bytes: bytes,
        *,
        source_conn_id: int,
        generation: str,
        update_id: str,
    ) -> Receipt | None:
        """Admit a client's update into the buffer; local peers receive it once it is accepted.

        ``None`` means PostgreSQL already holds every byte of the update. The role admission read
        under the document lock also applies to the writer's handle, so a write frame needs no
        separate access read.
        """
        source = session.clients.get(source_conn_id)
        if source is None:
            raise EditDenied
        async with session.lock:
            admitted = await self._admit(
                session, source.user_id, generation, update_id, update_bytes
            )
            if isinstance(admitted, Admitted) and admitted.applied:
                broadcast(session, [create_update_message(update_bytes)], skip=source_conn_id)
        await self.access.apply_role(session, source, admitted.role)
        if isinstance(admitted, RoleRefused):
            raise admitted
        receipt = admitted.receipt
        accepted = (
            AcceptedUpdate(update_bytes, receipt)
            if admitted.applied and receipt is not None
            else None
        )
        self._effects.queue(session, accepted)
        return receipt

    async def _admit(
        self,
        session: YDocSession,
        actor_id: UUID,
        generation: str,
        update_id: str,
        update_bytes: bytes,
    ) -> Admitted | RoleRefused:
        try:
            return await admit_update(
                self._buffer, session, actor_id, generation, update_id, update_bytes, broadcast
            )
        except RoleRefused as refused:
            return refused

    async def apply_seed_update(
        self,
        session: YDocSession,
        update_bytes: bytes,
        *,
        source_conn_id: int,
        generation: str,
        seed_token: str,
        seed_base: str,
    ) -> None:
        """Commit a fragment seed proposal synchronously; PostgreSQL holds it on return."""
        source = session.clients.get(source_conn_id)
        if source is None:
            raise EditDenied
        async with session.lock:
            try:
                await accept_seed(
                    self._buffer,
                    session.key,
                    session.organization_id,
                    source.user_id,
                    generation,
                    update_bytes,
                    seed_owner=f"{self._replica_id}:{source_conn_id}",
                    seed_token=seed_token,
                    seed_base=seed_base,
                )
            except LiveStateUnavailable as exc:
                raise SavingUnavailable("live_state_unavailable") from exc
            broadcast(session, await realign(self._buffer, session))
        self._effects.queue(session, None)

    async def refresh_document(self, session: YDocSession) -> None:
        """Realign the resident document with checkpoint plus tail, sending clients the change."""
        async with session.lock:
            broadcast(session, await realign(self._buffer, session))
        await self.refresh_fragment_seeder(session)

    async def _evict_after_idle(self, key: DocKey) -> None:
        """Drop an idle session from memory; buffered edits keep their own checkpoint schedule."""
        try:
            await asyncio.sleep(self._idle_eviction_seconds)
        except asyncio.CancelledError:
            return

        async with self._global_lock:
            session = self._sessions.get(key)
            if session is None or session.clients:
                return
            del self._sessions[key]
        self._schedule_seed_refresh(session, None)
        self._router.unregister_doc_session(key)
        self._buffer.forget(key)
        REALTIME_ACTIVE_DOCS.labels(content_type=key[0].value).dec()
        logger.info(f"evicted idle session {key[0].value}:{key[1]}")

    async def _apply_remote_update(self, session: YDocSession, remote: RemoteUpdate) -> None:
        """Apply a peer replica's record when it continues the head; otherwise reload the tail."""
        continuity = follow_record(
            session, remote.generation, remote.epoch, remote.sequence, remote.update
        )
        if continuity is Continuity.APPLIED:
            broadcast(session, [create_update_message(remote.update)])
        elif continuity is Continuity.GAP:
            same_epoch = (remote.generation, remote.epoch) == (session.generation, session.epoch)
            REALTIME_GAP_REPAIRS_TOTAL.labels(cause="sequence" if same_epoch else "epoch").inc()
            await self.refresh_document(session)

    async def _apply_checkpoint_progress(self, key: DocKey, progress: CheckpointProgress) -> None:
        """Record a committed watermark and tell attached clients which receipts it covers."""
        session = self._sessions.get(key)
        if session is None:
            return
        if (
            (progress.generation, progress.epoch) != (session.generation, session.epoch)
            or progress.checkpoint_revision > session.checkpoint_revision
            or progress.covered_sequence > session.head_seq
        ):
            # Barriers and seeds commit bytes no buffered record carries.
            await self.refresh_document(session)
        if (progress.generation, progress.epoch) != (session.generation, session.epoch):
            return
        # The revision stays with the bytes the resident document applied, so a refresh that
        # failed here still loads that checkpoint later.
        session.checkpoint_seq = max(session.checkpoint_seq, progress.covered_sequence)
        broadcast(
            session,
            [
                create_checkpoint_progress_message(
                    generation=progress.generation,
                    epoch=progress.epoch,
                    covered_sequence=progress.covered_sequence,
                    checkpoint_revision=progress.checkpoint_revision,
                )
            ],
        )

    async def _reload_document(self, key: DocKey) -> None:
        session = self._sessions.get(key)
        if session is not None:
            await self.refresh_document(session)
