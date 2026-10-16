"""Resident document caches follow PostgreSQL checkpoints and the Valkey update buffer."""

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pycrdt
from loguru import logger

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.auth.permissions.batching import FreshAudience
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.admission import (
    SavingUnavailable,
    admit_update,
    latest_under_lock,
    read_latest,
)
from uniffy.core.realtime.auth import (
    WS_CLOSE_FORBIDDEN,
    WS_CLOSE_TOKEN_REVOKED,
)
from uniffy.core.realtime.buffer import BufferUnavailable, RecoveryRequired, UpdateBuffer
from uniffy.core.realtime.buffer_keys import LatestState, Receipt
from uniffy.core.realtime.identity import replica_id
from uniffy.core.realtime.live import LiveStateUnavailable, accept_seed, claim_seed
from uniffy.core.realtime.markdown import PROSEMIRROR_FRAGMENT_FIELD
from uniffy.core.realtime.metrics import (
    REALTIME_ACTIVE_CLIENTS,
    REALTIME_ACTIVE_DOCS,
    REALTIME_FRAMES_DROPPED_TOTAL,
    REALTIME_GAP_REPAIRS_TOTAL,
    REALTIME_HYDRATION_DURATION,
    REALTIME_PERMISSION_REJECTIONS_TOTAL,
)
from uniffy.core.realtime.multiplex import encode_doc_frame
from uniffy.core.realtime.publisher import publish_doc_update
from uniffy.core.realtime.resident import Continuity, follow, follow_record
from uniffy.core.realtime.router import RealtimeRouter, RemoteUpdate, RouterCallbacks, router
from uniffy.core.realtime.seeding import has_fragment_content
from uniffy.core.realtime.state import (
    ClientHandle,
    DocKey,
    WSSession,
    YDocSession,
    doc_name_for,
)
from uniffy.core.realtime.storage import EditDenied, load_snapshot, lock_document, stage_seed
from uniffy.core.realtime.wire import (
    CheckpointProgress,
    create_auth_denied_message,
    create_checkpoint_progress_message,
    create_fragment_seeder_message,
    create_update_message,
)
from uniffy.core.types import ContentRole
from uniffy.infrastructure.database.session import open_session

logger = logger.bind(component="core.realtime.ydoc_manager")

__all__ = ["ClientHandle", "DocKey", "WSSession", "YDocManager", "YDocSession", "ydoc_manager"]

IDLE_EVICTION_SECONDS = 15 * 60
# Bounded so a slow pubsub cannot hold the process past its graceful-shutdown window.
SHUTDOWN_DRAIN_SECONDS = 5.0
SEED_RETRY_SECONDS = 1.0
_EFFECT_TIMEOUT_SECONDS = 2.0
# Reading the buffer failed; the resident document stays as it is until the next refresh.
_UNVERIFIED = (BufferUnavailable, LookupError, RecoveryRequired, ValueError)


@dataclass(frozen=True, slots=True)
class _Hint:
    """An accepted update peer replicas apply in sequence order."""

    update: bytes
    receipt: Receipt


class YDocManager:
    """Process-wide registry of live ``YDocSession`` instances."""

    def __init__(
        self,
        *,
        buffer: UpdateBuffer | None = None,
        realtime_router: RealtimeRouter | None = None,
        replica: str | None = None,
        idle_eviction_seconds: float = IDLE_EVICTION_SECONDS,
    ) -> None:
        self._sessions: dict[DocKey, YDocSession] = {}
        self._outbound_audience = FreshAudience(self._resolve_outbound_audience)
        # Per-key lock so hydration of one doc cannot stall concurrent connects to others.
        self._hydration_locks: dict[DocKey, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()
        self._replica_id = replica or replica_id()
        self._buffer = buffer or UpdateBuffer()
        self._router = realtime_router or router
        self._idle_eviction_seconds = idle_eviction_seconds
        self._effect_tasks: dict[DocKey, asyncio.Task] = {}
        self._pending_hints: dict[DocKey, list[_Hint]] = {}

    @property
    def replica_id(self) -> str:
        return self._replica_id

    @property
    def realtime_router(self) -> RealtimeRouter:
        return self._router

    def router_callbacks(self) -> RouterCallbacks:
        return RouterCallbacks(
            apply_remote_update=self._apply_remote_update,
            apply_checkpoint_progress=self._apply_checkpoint_progress,
            apply_content_replace=self._apply_content_replace,
            close_stale_user_sessions=self._close_stale_user_sessions,
            close_user_session_by_sid=self._close_user_session_by_sid,
            reauthorize_docs=self._reauthorize_docs,
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
                session = await self._hydrate(key, ws_session.organization_id, ws_session.user_id)
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
                if handle.ws_session is not None:
                    handle.ws_session.doc_handles.pop(key, None)
                REALTIME_ACTIVE_CLIENTS.labels(content_type=key[0].value).dec()
            if not session.clients and session.eviction_task is None:
                session.eviction_task = asyncio.create_task(self._evict_after_idle(key))
        try:
            await self.refresh_fragment_seeder(session)
        except Exception:
            logger.exception("Seed refresh failed during document release")
            self._schedule_seed_refresh(session, SEED_RETRY_SECONDS)

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

    def _schedule_seed_refresh(self, session: YDocSession, delay: float | None) -> None:
        if session.seed_task is not None and session.seed_task is not asyncio.current_task():
            session.seed_task.cancel()
        session.seed_task = None
        if delay is not None and session.clients:
            session.seed_task = asyncio.create_task(self._refresh_seed_after(session, delay))

    async def _refresh_seed_after(self, session: YDocSession, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            session.seed_task = None
            if session.clients:
                await self.refresh_fragment_seeder(session)
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("Seed lease refresh failed; retrying")
            self._schedule_seed_refresh(session, SEED_RETRY_SECONDS)

    async def stop_for_shutdown(self, *, timeout: float = SHUTDOWN_DRAIN_SECONDS) -> None:
        """Stop seed timers and let queued update hints go out within ``timeout``.

        Writes no document state: accepted edits already wait in the buffer with their
        checkpoint scheduled.
        """
        for session in list(self._sessions.values()):
            self._schedule_seed_refresh(session, None)
        tasks = list(self._effect_tasks.values())
        if tasks:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout)

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

        ``None`` means PostgreSQL already holds every byte of the update.
        """
        source = session.clients.get(source_conn_id)
        if source is None:
            raise EditDenied
        async with session.lock:
            admitted = await admit_update(
                self._buffer,
                session,
                source.user_id,
                generation,
                update_id,
                update_bytes,
                self._broadcast,
            )
            if admitted.applied:
                self._broadcast(session, [create_update_message(update_bytes)], skip=source_conn_id)
        receipt = admitted.receipt
        hint = _Hint(update_bytes, receipt) if admitted.applied and receipt is not None else None
        self._queue_effects(session, hint)
        return receipt

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
            await self._refresh_locked(session)
        self._queue_effects(session, None)

    def _queue_effects(self, session: YDocSession, hint: _Hint | None) -> None:
        hints = self._pending_hints.setdefault(session.key, [])
        if hint is not None:
            hints.append(hint)
        if session.key not in self._effect_tasks:
            self._effect_tasks[session.key] = asyncio.create_task(self._deliver_effects(session))

    async def _deliver_effects(self, session: YDocSession) -> None:
        """Publish accepted updates in order, then re-elect the seeder; neither delays receipts."""
        key = session.key
        try:
            while key in self._pending_hints:
                for hint in self._pending_hints.pop(key):
                    await self._run_effect(
                        publish_doc_update(
                            key[0],
                            key[1],
                            hint.update,
                            generation=hint.receipt.generation,
                            epoch=hint.receipt.epoch,
                            sequence=hint.receipt.seq,
                            origin_replica=self._replica_id,
                        )
                    )
                await self._run_effect(self.refresh_fragment_seeder(session))
        finally:
            self._effect_tasks.pop(key, None)

    @staticmethod
    async def _run_effect(effect: Awaitable[None]) -> None:
        try:
            async with asyncio.timeout(_EFFECT_TIMEOUT_SECONDS):
                await effect
        except Exception:
            # Peer replicas repair a missed hint on their next resync.
            logger.exception("Realtime effect after acceptance failed")

    def _broadcast(
        self, session: YDocSession, frames: Sequence[bytes], *, skip: int | None = None
    ) -> None:
        for frame in frames:
            for handle in list(session.clients.values()):
                if handle.conn_id != skip:
                    enqueue_for_handle(handle, frame, kind="update")

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
        user_id: UUID | None = None,
    ) -> YDocSession:
        """Resident document from the checkpoint plus its verified buffered tail.

        When the buffer cannot be read the checkpoint alone seeds it, without an epoch, and the
        next refresh realigns it.
        """
        content_type, content_id = key
        started = time.perf_counter()
        adapter = get_realtime_adapter(content_type)
        async with open_session() as db:
            await lock_document(db, key, organization_id)
            if user_id is not None and not role_can_view(
                await adapter.authorize(db, user_id, organization_id, content_id)
            ):
                raise EditDenied
            await stage_seed(db, key, organization_id)
            await db.commit()
            policy_key = await adapter.policy_key(db, content_id, organization_id)
            await lock_document(db, key, organization_id)
            state: LatestState | None = None
            try:
                state = await latest_under_lock(self._buffer, db, key, organization_id)
            except _UNVERIFIED:
                logger.opt(exception=True).warning(
                    "Realtime buffer unreadable; resident document starts from its checkpoint"
                )
                await db.rollback()
            row = None if state is not None else await load_snapshot(db, key)
            await db.commit()
        if row is not None and row.organization_id not in (None, organization_id):
            raise EditDenied

        session = YDocSession(
            key=key, ydoc=pycrdt.Doc(), organization_id=organization_id, policy_key=policy_key
        )
        if state is not None:
            follow(session, state)
        elif row is not None:
            session.ydoc.apply_update(row.updates)
            session.generation = row.generation or ""
        REALTIME_HYDRATION_DURATION.labels(
            content_type=content_type.value, source="buffer" if state else "checkpoint"
        ).observe(time.perf_counter() - started)
        return session

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
            self._broadcast(session, [create_update_message(remote.update)])
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
        self._broadcast(
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

    async def refresh_document(self, session: YDocSession) -> None:
        """Realign the resident document with checkpoint plus tail, sending clients the change."""
        async with session.lock:
            await self._refresh_locked(session)
        await self.refresh_fragment_seeder(session)

    async def _refresh_locked(self, session: YDocSession) -> None:
        try:
            state = await read_latest(self._buffer, session.key, session.organization_id)
        except _UNVERIFIED as exc:
            logger.warning(f"Resident document kept; latest realtime state unverified: {exc!r}")
            return
        if state is not None:
            self._broadcast(session, follow(session, state))

    async def _apply_content_replace(self, key: DocKey, content: str) -> None:
        session = self._sessions.get(key)
        if session is not None:
            await self.refresh_document(session)

    async def _resolve_outbound_audience(
        self,
        key: DocKey,
        actors: list[UUID],
    ) -> dict[UUID, tuple[YDocSession, ContentRole | None]]:
        session = self._sessions.get(key)
        if session is None:
            raise RuntimeError("Document detached before disclosure")
        async with open_session() as db:
            roles = await get_realtime_adapter(key[0]).authorize_many(
                db,
                actors,
                session.organization_id,
                key[1],
            )
        return {actor: (session, roles.get(actor)) for actor in actors}

    async def authorize_outbound(self, key: DocKey, user_id: UUID) -> None:
        session, role = await self._outbound_audience.check(key, user_id)
        if self._sessions.get(key) is not session:
            raise RuntimeError("Document changed before disclosure")
        for handle in list(session.clients.values()):
            if handle.user_id == user_id and not handle.closed:
                await self._apply_role(session, handle, role)

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
                    # Failed lookup stops disclosure without turning an outage into revocation.
                    role = await adapter.authorize(
                        db,
                        handle.user_id,
                        session.organization_id,
                        session.key[1],
                        checker=checker,
                    )
                    decisions.append((session, handle, role))
        for session, handle, role in decisions:
            await self._apply_role(session, handle, role)

    async def _apply_role(
        self,
        session: YDocSession,
        handle: ClientHandle,
        role: ContentRole | None,
    ) -> None:
        if role is None or not role_can_view(role):
            REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
                content_type=session.key[0].value, reason="role_revoked"
            ).inc()
            await self._close_handle(handle, WS_CLOSE_FORBIDDEN, "access revoked")
            return
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
        """Close handles bound to one revoked session; ``token_version`` did not change."""
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
                try:
                    await self.refresh_fragment_seeder(session)
                except Exception:
                    logger.exception("Seed refresh failed while closing socket")
                    self._schedule_seed_refresh(session, SEED_RETRY_SECONDS)
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
        logger.warning(f"outbound queue full for conn {handle.conn_id}; dropping {kind} frame")


ydoc_manager = YDocManager()
router.register_callbacks(ydoc_manager.router_callbacks())
