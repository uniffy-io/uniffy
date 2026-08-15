"""In-process LRU for decrypted integration credentials and constructed clients.

Keyed by ``IntegrationConnection.id``. A hit skips the decrypt AND the client
construction, preserving the pyqwest connection pool and circuit-breaker state
across tool calls. TTL 1 hour; the size cap (``INTEGRATION_CLIENT_LRU_SIZE``)
must sit above the deployment's live connection count or every tool call pays
the decrypt + construction again. Cross-pod invalidation lands via the
``integration_connections:invalidate:{connection_id}`` pubsub channel.

The LRU is in-process only: the encrypted credential never leaves PG and the
decrypted material never enters Valkey.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

import valkey.asyncio as aioredis
from loguru import logger
from valkey.exceptions import ConnectionError as ValkeyConnectionError
from valkey.exceptions import TimeoutError as ValkeyTimeoutError

from uniffy.core.valkey.config import ValkeyConfig

logger = logger.bind(component="integrations.client_cache")

if TYPE_CHECKING:
    from uniffy.domains.integrations.http import IntegrationHttpClient

_TTL_SECONDS = 3600
_MAX_SIZE = int(os.getenv("INTEGRATION_CLIENT_LRU_SIZE", "5000"))
_INVALIDATE_PATTERN = "integration_connections:invalidate:*"
_RECONNECT_BACKOFF_SECONDS = 5.0
_POLL_TIMEOUT_SECONDS = 1.0


@dataclass
class _CachedEntry:
    credential: str
    client: IntegrationHttpClient
    cached_at: float


class IntegrationClientLRU:
    """Bounded TTL+LRU keyed by connection id; one asyncio.Lock serialises mutations."""

    def __init__(self) -> None:
        self._entries: OrderedDict[UUID, _CachedEntry] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, connection_id: UUID) -> tuple[str, IntegrationHttpClient] | None:
        async with self._lock:
            entry = self._entries.get(connection_id)
            if entry is None:
                return None
            if time.time() - entry.cached_at > _TTL_SECONDS:
                self._entries.pop(connection_id, None)
                return None
            self._entries.move_to_end(connection_id)
            return entry.credential, entry.client

    async def set(
        self,
        connection_id: UUID,
        credential: str,
        client: IntegrationHttpClient,
    ) -> None:
        async with self._lock:
            self._entries[connection_id] = _CachedEntry(
                credential=credential,
                client=client,
                cached_at=time.time(),
            )
            self._entries.move_to_end(connection_id)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate(self, connection_id: UUID) -> bool:
        async with self._lock:
            return self._entries.pop(connection_id, None) is not None

    async def size(self) -> int:
        async with self._lock:
            return len(self._entries)


_lru: IntegrationClientLRU | None = None
_subscriber_task: asyncio.Task[None] | None = None
_subscriber_shutdown: asyncio.Event | None = None


def get_integration_client_lru() -> IntegrationClientLRU:
    """Return the process-singleton LRU, lazily initialised."""
    global _lru
    if _lru is None:
        _lru = IntegrationClientLRU()
    return _lru


async def init_integration_invalidation_subscriber() -> None:
    """Start the long-lived pubsub listener for connection invalidation. Idempotent."""
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_task is not None and not _subscriber_task.done():
        return

    _subscriber_shutdown = asyncio.Event()
    _subscriber_task = asyncio.create_task(_run_subscriber())
    logger.info("Integration invalidation subscriber started")


async def close_integration_invalidation_subscriber() -> None:
    """Signal shutdown and await the subscriber task. Safe when none is running."""
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_shutdown is not None:
        _subscriber_shutdown.set()

    if _subscriber_task is not None:
        try:
            await asyncio.wait_for(_subscriber_task, timeout=3.0)
        except TimeoutError, asyncio.CancelledError:
            _subscriber_task.cancel()
        except Exception as exc:
            logger.warning(f"Integration invalidation subscriber teardown failed: {exc}")
        _subscriber_task = None

    _subscriber_shutdown = None
    logger.info("Integration invalidation subscriber stopped")


async def _run_subscriber() -> None:
    """Listen on ``integration_connections:invalidate:*`` and drop LRU entries."""
    url = ValkeyConfig.from_env().to_url()

    while _subscriber_shutdown is None or not _subscriber_shutdown.is_set():
        client: aioredis.Redis | None = None
        pubsub = None
        try:
            client = aioredis.from_url(
                url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                socket_keepalive=True,
                health_check_interval=30,
            )
            pubsub = client.pubsub()
            await pubsub.psubscribe(_INVALIDATE_PATTERN)
            logger.info(f"Integration invalidation subscriber listening on {_INVALIDATE_PATTERN}")

            while _subscriber_shutdown is None or not _subscriber_shutdown.is_set():
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=_POLL_TIMEOUT_SECONDS,
                )
                if msg is None:
                    continue
                if msg.get("type") != "pmessage":  # noqa: PLR2004
                    continue
                await _handle_invalidate_message(msg.get("data"))

        except (ValkeyConnectionError, ValkeyTimeoutError, OSError) as exc:
            logger.warning(
                f"Integration invalidation subscriber connection error: {exc}; "
                f"reconnecting in {_RECONNECT_BACKOFF_SECONDS}s"
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                f"Integration invalidation subscriber unexpected error: {exc}; "
                f"reconnecting in {_RECONNECT_BACKOFF_SECONDS}s"
            )
        finally:
            if pubsub is not None:
                with contextlib.suppress(Exception):
                    await pubsub.punsubscribe(_INVALIDATE_PATTERN)
                with contextlib.suppress(Exception):
                    await pubsub.aclose()
            if client is not None:
                with contextlib.suppress(Exception):
                    await client.aclose()

        if _subscriber_shutdown is not None and _subscriber_shutdown.is_set():
            break
        try:
            await asyncio.wait_for(
                _subscriber_shutdown.wait()
                if _subscriber_shutdown is not None
                else asyncio.sleep(_RECONNECT_BACKOFF_SECONDS),
                timeout=_RECONNECT_BACKOFF_SECONDS,
            )
        except TimeoutError:
            pass
        except asyncio.CancelledError:
            raise


async def _handle_invalidate_message(raw: object) -> None:
    """Parse one pubsub payload and drop the matching LRU entry."""
    if raw is None:
        return
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError, TypeError:
        logger.warning(f"Integration invalidate message decode failed: {raw!r}")
        return
    raw_id = payload.get("connection_id") if isinstance(payload, dict) else None
    if not isinstance(raw_id, str):
        return
    try:
        connection_id = UUID(raw_id)
    except ValueError:
        logger.warning(f"Integration invalidate message invalid connection_id: {raw_id!r}")
        return
    dropped = await get_integration_client_lru().invalidate(connection_id)
    if dropped:
        logger.debug(f"Integration client LRU dropped {connection_id}")
