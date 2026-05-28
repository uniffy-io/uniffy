"""Process-wide watcher that kicks streaming RPCs on token / session revoke.

ConnectRPC's ``AuthRevocationInterceptor`` runs once at stream open. A
long-lived server-streaming method (chat stream, notifications, agent
runtime) authenticates there and then runs until the client disconnects
- a mid-stream ``token_version`` bump or per-session revoke never kicks
it. This coordinator closes that window.

Design notes:

* **Two pattern subscribers per process.** ``auth:revoke:*`` covers
  bulk token-version bumps; ``auth:revoke_sid:*`` covers single-session
  revokes. Per-stream subscribers would multiply Valkey connections in
  proportion to traffic and collapse the same way per-user subscribers
  did in the realtime layer.
* **The cancel signal is the disconnect event** set by
  :class:`StreamDisconnectMiddleware`. Streaming handlers already
  break out when it's set, so this coordinator does not need its own
  cancellation contract.
* **Fail-quiet.** Valkey outage means no proactive kick - the stream
  rides out to natural disconnect, identical to today's behaviour.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import UUID

from loguru import logger

from uniffy.core.realtime.identity import replica_id
from uniffy.core.valkey.pubsub import subscribe_patterns

LOGGER_COMPONENT = "streaming.revoke"

_REVOKE_PATTERN = "auth:revoke:*"
_REVOKE_SID_PATTERN = "auth:revoke_sid:*"
_RECONNECT_DELAY_INITIAL = 1.0
_RECONNECT_DELAY_MAX = 30.0


@dataclass
class StreamRegistration:
    """One live streaming RPC bound to a single user / token / session."""

    user_id: UUID
    token_version: int | None
    session_id: UUID | None
    disconnect: asyncio.Event


def _parse_revoke_channel(channel: str) -> UUID | None:
    parts = channel.split(":")
    if len(parts) != 3 or parts[0] != "auth" or parts[1] != "revoke":
        return None
    try:
        return UUID(parts[2])
    except ValueError:
        return None


def _parse_revoke_sid_channel(channel: str) -> UUID | None:
    parts = channel.split(":")
    if len(parts) != 3 or parts[0] != "auth" or parts[1] != "revoke_sid":
        return None
    try:
        return UUID(parts[2])
    except ValueError:
        return None


class StreamRevokeCoordinator:
    """Singleton: PSUBSCRIBE once, fanout to registered streams."""

    def __init__(self) -> None:
        self._streams_by_user: dict[UUID, set[int]] = {}
        self._streams_by_id: dict[int, StreamRegistration] = {}
        self._next_id: int = 0
        self._lock = asyncio.Lock()
        self._tasks: list[asyncio.Task[None]] = []
        self._running = False
        self._self_replica = replica_id()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._tasks = [
            asyncio.create_task(
                self._run_with_reconnect(_REVOKE_PATTERN, self._handle_revoke),
                name="stream-revoke-coordinator-revoke",
            ),
            asyncio.create_task(
                self._run_with_reconnect(_REVOKE_SID_PATTERN, self._handle_revoke_sid),
                name="stream-revoke-coordinator-revoke-sid",
            ),
        ]
        logger.info(
            "stream revoke coordinator started", component=LOGGER_COMPONENT
        )

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._tasks = []
        logger.info(
            "stream revoke coordinator stopped", component=LOGGER_COMPONENT
        )

    async def register(
        self,
        *,
        user_id: UUID,
        token_version: int | None,
        session_id: UUID | None,
        disconnect: asyncio.Event,
    ) -> int:
        """Register one live stream; returns the id to pass to :meth:`unregister`."""
        async with self._lock:
            sid_token = self._next_id
            self._next_id += 1
            self._streams_by_id[sid_token] = StreamRegistration(
                user_id=user_id,
                token_version=token_version,
                session_id=session_id,
                disconnect=disconnect,
            )
            self._streams_by_user.setdefault(user_id, set()).add(sid_token)
            return sid_token

    async def unregister(self, registration_id: int) -> None:
        async with self._lock:
            reg = self._streams_by_id.pop(registration_id, None)
            if reg is None:
                return
            bucket = self._streams_by_user.get(reg.user_id)
            if bucket is not None:
                bucket.discard(registration_id)
                if not bucket:
                    self._streams_by_user.pop(reg.user_id, None)

    async def _run_with_reconnect(
        self,
        pattern: str,
        handler: Callable[[str, dict[str, object]], Awaitable[None]],
    ) -> None:
        delay = _RECONNECT_DELAY_INITIAL
        while self._running:
            try:
                async for envelope in subscribe_patterns(pattern):
                    if envelope is None:
                        continue
                    channel, payload = envelope
                    try:
                        await handler(channel, payload)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning(
                            f"stream revoke handler error on {channel}: {exc}",
                            component=LOGGER_COMPONENT,
                        )
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    f"stream revoke subscriber {pattern} crashed: {exc}; "
                    f"reconnecting in {delay:.1f}s",
                    component=LOGGER_COMPONENT,
                )
                try:
                    await asyncio.sleep(delay)
                except asyncio.CancelledError:
                    return
                delay = min(delay * 2, _RECONNECT_DELAY_MAX)
                continue
            delay = _RECONNECT_DELAY_INITIAL

    async def _handle_revoke(self, channel: str, payload: dict[str, object]) -> None:
        user_id = _parse_revoke_channel(channel)
        if user_id is None:
            return
        new_version = payload.get("token_version")
        if not isinstance(new_version, int):
            return
        async with self._lock:
            ids = list(self._streams_by_user.get(user_id, ()))
            targets = [
                self._streams_by_id[i]
                for i in ids
                if i in self._streams_by_id
                and (
                    self._streams_by_id[i].token_version is None
                    or self._streams_by_id[i].token_version < new_version
                )
            ]
        for reg in targets:
            reg.disconnect.set()

    async def _handle_revoke_sid(
        self, channel: str, payload: dict[str, object]
    ) -> None:
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
        async with self._lock:
            ids = list(self._streams_by_user.get(user_id, ()))
            targets = [
                self._streams_by_id[i]
                for i in ids
                if i in self._streams_by_id
                and self._streams_by_id[i].session_id == session_id
            ]
        for reg in targets:
            reg.disconnect.set()


coordinator = StreamRevokeCoordinator()
