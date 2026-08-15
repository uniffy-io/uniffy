"""Process-wide Valkey dispatcher.

Four pattern subscribers per process (doc updates, perm changes, defaults, token
revoke) replace per-doc / per-user subscribers. ``YDocManager`` registers
``RouterCallbacks`` at startup; the router calls back into the manager rather
than importing it (cycle with ``snapshot.py``).
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from loguru import logger

from uniffy.core.realtime.identity import replica_id
from uniffy.core.realtime.publisher import (
    RealtimeChannelKind,
    RealtimeChannelNamespace,
    RealtimePayloadKind,
)
from uniffy.core.realtime.state import ClientHandle, DocKey, YDocSession
from uniffy.core.types import ContentType
from uniffy.core.valkey.pubsub import subscribe_patterns
from uniffy.observability.metrics import (
    REALTIME_PUBSUB_LATENCY,
    REALTIME_PUBSUB_RECONNECTS_TOTAL,
)

LOGGER_COMPONENT = "realtime.router"

_DOC_PATTERN = f"{RealtimeChannelNamespace.REALTIME}:{RealtimeChannelKind.DOC}:*"
_PERM_PATTERN = f"{RealtimeChannelNamespace.REALTIME}:{RealtimeChannelKind.PERM}:*"
_DEFAULTS_PATTERN = f"{RealtimeChannelNamespace.REALTIME}:{RealtimeChannelKind.DEFAULTS}:*"
_REVOKE_PATTERN = f"{RealtimeChannelNamespace.AUTH}:{RealtimeChannelKind.REVOKE}:*"
_REVOKE_SID_PATTERN = f"{RealtimeChannelNamespace.AUTH}:{RealtimeChannelKind.REVOKE_SESSION}:*"
_RECONNECT_DELAY_INITIAL = 1.0
_RECONNECT_DELAY_MAX = 30.0


@dataclass
class RouterCallbacks:
    """Hooks the ``YDocManager`` registers to receive routed payloads."""

    apply_remote_update: Callable[[YDocSession, bytes], Awaitable[None]]
    apply_content_replace: Callable[[DocKey, str], Awaitable[None]]
    enforce_role_change: Callable[[ClientHandle, str | None], Awaitable[None]]
    close_stale_user_sessions: Callable[[UUID, int], Awaitable[None]]
    close_user_session_by_sid: Callable[[UUID, UUID], Awaitable[None]]
    reauthorize_doc: Callable[[DocKey], Awaitable[None]]


def _parse_doc_channel(channel: str) -> DocKey | None:
    parts = channel.split(":")
    if (
        len(parts) != 4
        or parts[0] != RealtimeChannelNamespace.REALTIME
        or parts[1] != RealtimeChannelKind.DOC
    ):
        return None
    try:
        return (ContentType[parts[2]], UUID(parts[3]))
    except KeyError, ValueError:
        return None


def _parse_perm_channel(channel: str) -> DocKey | None:
    parts = channel.split(":")
    if (
        len(parts) != 4
        or parts[0] != RealtimeChannelNamespace.REALTIME
        or parts[1] != RealtimeChannelKind.PERM
    ):
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
    """Singleton process-wide dispatcher for the realtime pubsub channels."""

    def __init__(self) -> None:
        self._callbacks: RouterCallbacks | None = None
        # Keyed by ``conn_id`` because ``ClientHandle`` is non-frozen and unhashable.
        self._doc_handles: dict[DocKey, dict[int, ClientHandle]] = {}
        self._user_handles: dict[UUID, dict[int, ClientHandle]] = {}
        self._doc_sessions: dict[DocKey, YDocSession] = {}
        self._self_replica = replica_id()
        self._tasks: list[asyncio.Task[None]] = []
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
        logger.info(
            "realtime router started (5 pattern subscribers)",
            component=LOGGER_COMPONENT,
        )

    async def stop(self) -> None:
        """Cancel the subscriber tasks. Idempotent."""
        if not self._running:
            return
        self._running = False
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []
        logger.info("realtime router stopped", component=LOGGER_COMPONENT)

    def register_doc_session(self, key: DocKey, session: YDocSession) -> None:
        self._doc_sessions[key] = session

    def unregister_doc_session(self, key: DocKey) -> None:
        self._doc_sessions.pop(key, None)

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
                        logger.warning(
                            f"router handler error on {channel}: {exc}",
                            component=LOGGER_COMPONENT,
                        )
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                REALTIME_PUBSUB_RECONNECTS_TOTAL.labels(pattern=pattern).inc()
                logger.warning(
                    f"pattern subscriber {pattern} crashed: {exc}; reconnecting in {delay:.1f}s",
                    component=LOGGER_COMPONENT,
                )
                try:
                    await asyncio.sleep(delay)
                except asyncio.CancelledError:
                    return
                delay = min(delay * 2, _RECONNECT_DELAY_MAX)
                continue
            delay = _RECONNECT_DELAY_INITIAL

    async def _handle_doc_message(self, channel: str, payload: dict[str, object]) -> None:
        if payload.get("kind") == RealtimePayloadKind.CONTENT_REPLACE:
            # Not origin-deduped: the publishing process may hold the session.
            key = _parse_doc_channel(channel)
            if key is None or key not in self._doc_sessions:
                return
            callbacks = self._callbacks
            content = payload.get("content")
            if callbacks is None or not isinstance(content, str):
                return
            _observe_pubsub_latency("doc", payload)
            await callbacks.apply_content_replace(key, content)
            return
        if payload.get("origin_replica") == self._self_replica:
            return
        key = _parse_doc_channel(channel)
        if key is None:
            return
        session = self._doc_sessions.get(key)
        if session is None:
            return
        update_b64 = payload.get("update")
        if not isinstance(update_b64, str):
            return
        try:
            update = base64.b64decode(update_b64)
        except Exception:
            logger.warning(f"router: malformed update on {channel}", component=LOGGER_COMPONENT)
            return
        callbacks = self._callbacks
        if callbacks is None:
            return
        _observe_pubsub_latency("doc", payload)
        await callbacks.apply_remote_update(session, update)

    async def _handle_perm_message(self, channel: str, payload: dict[str, object]) -> None:
        if payload.get("origin_replica") == self._self_replica:
            # Same-replica perm payloads are allowed through: the producer commits to PG
            # and the local session relies on the pubsub bounce, not in-process fan-out.
            pass
        key = _parse_perm_channel(channel)
        if key is None:
            return
        callbacks = self._callbacks
        if callbacks is None:
            return
        _observe_pubsub_latency("perm", payload)
        user_id_raw = payload.get("user_id")
        new_role = payload.get("new_role")
        new_role_str = new_role if isinstance(new_role, str) else None
        if user_id_raw is None:
            await callbacks.reauthorize_doc(key)
            return
        try:
            user_id = UUID(str(user_id_raw))
        except TypeError, ValueError:
            logger.warning(
                f"router: invalid user_id on {channel}: {user_id_raw!r}",
                component=LOGGER_COMPONENT,
            )
            return
        bucket = self._doc_handles.get(key)
        if not bucket:
            return
        for handle in list(bucket.values()):
            if handle.user_id != user_id:
                continue
            await callbacks.enforce_role_change(handle, new_role_str)

    async def _handle_defaults_message(self, channel: str, payload: dict[str, object]) -> None:
        """Re-authorize every doc on this replica matching ``(org_id, content_type)``."""
        parsed = _parse_defaults_channel(channel)
        if parsed is None:
            return
        org_id, content_type = parsed
        callbacks = self._callbacks
        if callbacks is None:
            return
        _observe_pubsub_latency("defaults", payload)
        for key, session in list(self._doc_sessions.items()):
            if key[0] is content_type and session.organization_id == org_id:
                await callbacks.reauthorize_doc(key)

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


router = RealtimeRouter()
