"""Route process-wide realtime signals to locally attached documents."""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from uuid import UUID

from loguru import logger

from uniffy.core.realtime.identity import replica_id
from uniffy.core.realtime.metrics import (
    REALTIME_PUBSUB_LATENCY,
    REALTIME_PUBSUB_RECONNECTS_TOTAL,
)
from uniffy.core.realtime.publisher import (
    RealtimeChannelKind,
    RealtimeChannelNamespace,
    RealtimePayloadKind,
)
from uniffy.core.realtime.state import ClientHandle, DocKey, YDocSession
from uniffy.core.realtime.wire import MAX_WIRE_INTEGER, MAX_WIRE_STRING_BYTES, CheckpointProgress
from uniffy.core.types import ContentType
from uniffy.infrastructure.valkey.pubsub import subscribe_patterns

logger = logger.bind(component="core.realtime.router")

_DOC_PATTERN = f"{RealtimeChannelNamespace.REALTIME}:{RealtimeChannelKind.DOC}:*"
_PERM_PATTERN = f"{RealtimeChannelNamespace.REALTIME}:{RealtimeChannelKind.PERM}:*"
_DEFAULTS_PATTERN = f"{RealtimeChannelNamespace.REALTIME}:{RealtimeChannelKind.DEFAULTS}:*"
_REVOKE_PATTERN = f"{RealtimeChannelNamespace.AUTH}:{RealtimeChannelKind.REVOKE}:*"
_REVOKE_SID_PATTERN = f"{RealtimeChannelNamespace.AUTH}:{RealtimeChannelKind.REVOKE_SESSION}:*"
_RECONNECT_DELAY_INITIAL = 1.0
_RECONNECT_DELAY_MAX = 30.0
# Records past this many queued for one document collapse into one reload of checkpoint plus tail.
_DOC_QUEUE_LIMIT = 1024


@dataclass(frozen=True, slots=True)
class RemoteUpdate:
    """An update another replica accepted, with its place in the buffer epoch."""

    update: bytes
    generation: str
    epoch: str
    sequence: int


@dataclass(frozen=True, slots=True)
class _DocWork:
    """One routed document message waiting for that document's earlier messages."""

    kind: RealtimePayloadKind
    remote: RemoteUpdate | None = None
    progress: CheckpointProgress | None = None


@dataclass
class RouterCallbacks:
    """Hooks the ``YDocManager`` registers to receive routed payloads."""

    apply_remote_update: Callable[[YDocSession, RemoteUpdate], Awaitable[None]]
    apply_checkpoint_progress: Callable[[DocKey, CheckpointProgress], Awaitable[None]]
    reload_document: Callable[[DocKey], Awaitable[None]]
    close_stale_user_sessions: Callable[[UUID, int], Awaitable[None]]
    close_user_session_by_sid: Callable[[UUID, UUID], Awaitable[None]]
    # ``user_id`` narrows to that user's handles; ``None`` re-checks everyone on the docs.
    recheck_access: Callable[[Sequence[DocKey], UUID | None], Awaitable[None]]


def _wire_string(value: object) -> str | None:
    if isinstance(value, str) and len(value.encode()) <= MAX_WIRE_STRING_BYTES:
        return value
    return None


def _wire_integer(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= MAX_WIRE_INTEGER:
        return value
    return None


def _parse_remote_update(payload: dict[str, object]) -> RemoteUpdate | None:
    generation = _wire_string(payload.get("generation"))
    epoch = _wire_string(payload.get("epoch"))
    sequence = _wire_integer(payload.get("sequence"))
    encoded = payload.get("update")
    if generation is None or not epoch or not sequence or not isinstance(encoded, str):
        return None
    try:
        update = base64.b64decode(encoded, validate=True)
    except binascii.Error:
        return None
    return RemoteUpdate(update, generation, epoch, sequence)


def _parse_progress(payload: dict[str, object]) -> CheckpointProgress | None:
    generation = _wire_string(payload.get("generation"))
    epoch = _wire_string(payload.get("epoch"))
    covered = _wire_integer(payload.get("covered_sequence"))
    revision = _wire_integer(payload.get("checkpoint_revision"))
    if generation is None or not epoch or covered is None or revision is None:
        return None
    return CheckpointProgress(generation, epoch, covered, revision)


def _parse_content_channel(channel: str, kind: RealtimeChannelKind) -> DocKey | None:
    parts = channel.split(":")
    if len(parts) != 4 or parts[0] != RealtimeChannelNamespace.REALTIME or parts[1] != kind:
        return None
    try:
        return (ContentType[parts[2]], UUID(parts[3]))
    except KeyError, ValueError:
        return None


def _parse_revoke_channel(channel: str) -> UUID | None:
    parts = channel.split(":")
    if (
        len(parts) != 3
        or parts[0] != RealtimeChannelNamespace.AUTH
        or parts[1] != RealtimeChannelKind.REVOKE
    ):
        return None
    try:
        return UUID(parts[2])
    except ValueError:
        return None


def _parse_revoke_sid_channel(channel: str) -> UUID | None:
    parts = channel.split(":")
    if (
        len(parts) != 3
        or parts[0] != RealtimeChannelNamespace.AUTH
        or parts[1] != RealtimeChannelKind.REVOKE_SESSION
    ):
        return None
    try:
        return UUID(parts[2])
    except ValueError:
        return None


def _observe_pubsub_latency(channel_label: str, payload: dict[str, object]) -> None:
    """Observe publish-to-receive latency. No-op without ``published_at``;
    negative deltas clamp to 0.
    """
    raw = payload.get("published_at")
    if not isinstance(raw, (int, float)):
        return
    delta = time.time() - float(raw)
    if delta < 0:
        delta = 0.0
    REALTIME_PUBSUB_LATENCY.labels(channel=channel_label).observe(delta)


def _parse_defaults_channel(channel: str) -> tuple[UUID, ContentType] | None:
    parts = channel.split(":")
    if (
        len(parts) != 4
        or parts[0] != RealtimeChannelNamespace.REALTIME
        or parts[1] != RealtimeChannelKind.DEFAULTS
    ):
        return None
    try:
        return (UUID(parts[2]), ContentType[parts[3]])
    except KeyError, ValueError:
        return None


class RealtimeRouter:
    """Dispatches the realtime pubsub channels to the documents one replica holds."""

    def __init__(self, replica: str | None = None) -> None:
        self._callbacks: RouterCallbacks | None = None
        # Keyed by ``conn_id`` because ``ClientHandle`` is non-frozen and unhashable.
        self._doc_handles: dict[DocKey, dict[int, ClientHandle]] = {}
        self._user_handles: dict[UUID, dict[int, ClientHandle]] = {}
        self._doc_sessions: dict[DocKey, YDocSession] = {}
        self._policy_docs: dict[DocKey, set[DocKey]] = {}
        self._self_replica = replica or replica_id()
        self._tasks: list[asyncio.Task[None]] = []
        # Each document's messages run in order on its own task, so a reload that waits on one
        # document's lock never holds up hints for the others.
        self._doc_work: dict[DocKey, list[_DocWork]] = {}
        self._doc_tasks: dict[DocKey, asyncio.Task[None]] = {}
        self._running = False

    def register_callbacks(self, callbacks: RouterCallbacks) -> None:
        self._callbacks = callbacks

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._tasks = [
            asyncio.create_task(
                self._run_with_reconnect(_DOC_PATTERN, self._handle_doc_message),
                name="realtime-router-doc",
            ),
            asyncio.create_task(
                self._run_with_reconnect(_PERM_PATTERN, self._handle_perm_message),
                name="realtime-router-perm",
            ),
            asyncio.create_task(
                self._run_with_reconnect(_DEFAULTS_PATTERN, self._handle_defaults_message),
                name="realtime-router-defaults",
            ),
            asyncio.create_task(
                self._run_with_reconnect(_REVOKE_PATTERN, self._handle_revoke_message),
                name="realtime-router-revoke",
            ),
            asyncio.create_task(
                self._run_with_reconnect(_REVOKE_SID_PATTERN, self._handle_revoke_sid_message),
                name="realtime-router-revoke-sid",
            ),
        ]
        logger.info("realtime router started (5 pattern subscribers)")

    async def stop(self) -> None:
        """Cancel the subscriber tasks. Idempotent."""
        if not self._running:
            return
        self._running = False
        tasks = [*self._tasks, *self._doc_tasks.values()]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []
        self._doc_tasks.clear()
        self._doc_work.clear()
        logger.info("realtime router stopped")

    def register_doc_session(self, key: DocKey, session: YDocSession) -> None:
        self.unregister_doc_session(key)
        self._doc_sessions[key] = session
        self._policy_docs.setdefault(session.policy_key or key, set()).add(key)

    def unregister_doc_session(self, key: DocKey) -> None:
        session = self._doc_sessions.pop(key, None)
        if session is None:
            return
        policy_key = session.policy_key or key
        bucket = self._policy_docs.get(policy_key)
        if bucket is not None:
            bucket.discard(key)
            if not bucket:
                self._policy_docs.pop(policy_key, None)

    def attach_handle(self, key: DocKey, handle: ClientHandle) -> None:
        self._doc_handles.setdefault(key, {})[handle.conn_id] = handle
        self._user_handles.setdefault(handle.user_id, {})[handle.conn_id] = handle

    def detach_handle(self, key: DocKey, handle: ClientHandle) -> None:
        """Drop the handle from both registries. Idempotent."""
        bucket = self._doc_handles.get(key)
        if bucket is not None:
            bucket.pop(handle.conn_id, None)
            if not bucket:
                self._doc_handles.pop(key, None)
        user_bucket = self._user_handles.get(handle.user_id)
        if user_bucket is not None:
            user_bucket.pop(handle.conn_id, None)
            if not user_bucket:
                self._user_handles.pop(handle.user_id, None)

    async def _run_with_reconnect(
        self,
        pattern: str,
        handler: Callable[[str, dict[str, object]], Awaitable[None]],
    ) -> None:
        """Run a pattern subscriber with exponential-backoff reconnect."""
        delay = _RECONNECT_DELAY_INITIAL
        while self._running:
            try:
                async for envelope in subscribe_patterns(pattern):
                    if envelope is None:
                        continue
                    channel, payload = envelope
                    try:
                        await handler(channel, payload)
                    except Exception as exc:
                        logger.warning(f"router handler error on {channel}: {exc}")
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                REALTIME_PUBSUB_RECONNECTS_TOTAL.labels(pattern=pattern).inc()
                logger.warning(
                    f"pattern subscriber {pattern} crashed: {exc}; reconnecting in {delay:.1f}s"
                )
                try:
                    await asyncio.sleep(delay)
                except asyncio.CancelledError:
                    return
                delay = min(delay * 2, _RECONNECT_DELAY_MAX)
                continue
            delay = _RECONNECT_DELAY_INITIAL

    async def _handle_doc_message(self, channel: str, payload: dict[str, object]) -> None:
        key = _parse_content_channel(channel, RealtimeChannelKind.DOC)
        if key is None or key not in self._doc_sessions or self._callbacks is None:
            return
        kind = payload.get("kind")
        if kind == RealtimePayloadKind.CONTENT_REPLACE:
            # Not origin-deduped: the publishing process may hold the session.
            work = _DocWork(RealtimePayloadKind.CONTENT_REPLACE)
        elif kind == RealtimePayloadKind.CHECKPOINT_PROGRESS:
            # Not origin-deduped either: barriers in this process commit checkpoints too.
            progress = _parse_progress(payload)
            if progress is None:
                logger.warning(f"router: malformed progress on {channel}")
                return
            work = _DocWork(RealtimePayloadKind.CHECKPOINT_PROGRESS, progress=progress)
        elif kind == RealtimePayloadKind.ACCEPTED_UPDATE:
            if payload.get("origin_replica") == self._self_replica:
                return
            remote = _parse_remote_update(payload)
            if remote is None:
                logger.warning(f"router: malformed update on {channel}")
                return
            work = _DocWork(RealtimePayloadKind.ACCEPTED_UPDATE, remote=remote)
        else:
            return
        _observe_pubsub_latency("doc", payload)
        self._queue_doc_work(key, work)

    def _queue_doc_work(self, key: DocKey, work: _DocWork) -> None:
        """Queue behind the document's earlier messages, dropping what later work makes moot.

        A queued reload reads checkpoint plus tail when it runs, so it covers every record
        published before it ran; only the newest checkpoint progress matters.
        """
        queue = self._doc_work.setdefault(key, [])
        reload_queued = any(item.kind is RealtimePayloadKind.CONTENT_REPLACE for item in queue)
        if work.kind is RealtimePayloadKind.ACCEPTED_UPDATE:
            if reload_queued:
                return
            if len(queue) >= _DOC_QUEUE_LIMIT:
                work = _DocWork(RealtimePayloadKind.CONTENT_REPLACE)
        if work.kind is RealtimePayloadKind.CONTENT_REPLACE:
            queue[:] = [
                item for item in queue if item.kind is RealtimePayloadKind.CHECKPOINT_PROGRESS
            ]
        elif work.kind is RealtimePayloadKind.CHECKPOINT_PROGRESS:
            queue[:] = [item for item in queue if item.kind is not work.kind]
        queue.append(work)
        if key not in self._doc_tasks:
            self._doc_tasks[key] = asyncio.create_task(
                self._run_doc_work(key), name="realtime-router-document"
            )

    async def _run_doc_work(self, key: DocKey) -> None:
        try:
            while queue := self._doc_work.get(key):
                work = queue.pop(0)
                if not queue:
                    self._doc_work.pop(key, None)
                try:
                    await self._apply_doc_work(key, work)
                except Exception as exc:
                    logger.warning(f"router document handler error on {key[0].value}: {exc}")
        finally:
            self._doc_tasks.pop(key, None)

    async def _apply_doc_work(self, key: DocKey, work: _DocWork) -> None:
        callbacks = self._callbacks
        session = self._doc_sessions.get(key)
        if callbacks is None or session is None:
            return
        if work.kind is RealtimePayloadKind.CONTENT_REPLACE:
            await callbacks.reload_document(key)
        elif work.progress is not None:
            await callbacks.apply_checkpoint_progress(key, work.progress)
        elif work.remote is not None:
            await callbacks.apply_remote_update(session, work.remote)

    async def _handle_perm_message(self, channel: str, payload: dict[str, object]) -> None:
        # Not origin-deduped: local sessions learn of a committed change only through this bounce.
        key = _parse_content_channel(channel, RealtimeChannelKind.PERM)
        if key is None:
            return
        callbacks = self._callbacks
        if callbacks is None:
            return
        _observe_pubsub_latency("perm", payload)
        user_id_raw = payload.get("user_id")
        targets = tuple(self._policy_docs.get(key) or {key})
        if user_id_raw is None:
            await callbacks.recheck_access(targets, None)
            return
        try:
            user_id = UUID(str(user_id_raw))
        except TypeError, ValueError:
            logger.warning(f"router: invalid user_id on {channel}: {user_id_raw!r}")
            return
        affected = tuple(
            target
            for target in targets
            if any(
                handle.user_id == user_id for handle in self._doc_handles.get(target, {}).values()
            )
        )
        if affected:
            await callbacks.recheck_access(affected, user_id)

    async def _handle_defaults_message(self, channel: str, payload: dict[str, object]) -> None:
        """Recheck access on every doc of this replica whose policy follows these defaults."""
        parsed = _parse_defaults_channel(channel)
        if parsed is None:
            return
        org_id, content_type = parsed
        callbacks = self._callbacks
        if callbacks is None:
            return
        _observe_pubsub_latency("defaults", payload)
        affected = tuple(
            key
            for key, session in list(self._doc_sessions.items())
            if (session.policy_key or key)[0] is content_type and session.organization_id == org_id
        )
        if affected:
            await callbacks.recheck_access(affected, None)

    async def _handle_revoke_message(self, channel: str, payload: dict[str, object]) -> None:
        user_id = _parse_revoke_channel(channel)
        if user_id is None:
            return
        new_version = payload.get("token_version")
        if not isinstance(new_version, int):
            return
        callbacks = self._callbacks
        if callbacks is None:
            return
        if user_id not in self._user_handles:
            return
        _observe_pubsub_latency("revoke", payload)
        await callbacks.close_stale_user_sessions(user_id, new_version)

    async def _handle_revoke_sid_message(self, channel: str, payload: dict[str, object]) -> None:
        """Close a single user session targeted by its access-token ``sid``."""
        user_id = _parse_revoke_sid_channel(channel)
        if user_id is None:
            return
        sid_raw = payload.get("session_id")
        if not isinstance(sid_raw, str):
            return
        try:
            session_id = UUID(sid_raw)
        except ValueError:
            return
        callbacks = self._callbacks
        if callbacks is None:
            return
        if user_id not in self._user_handles:
            return
        _observe_pubsub_latency("revoke_sid", payload)
        await callbacks.close_user_session_by_sid(user_id, session_id)
