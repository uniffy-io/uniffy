"""In-process LRU for decrypted provider credentials and clients.

Every agent turn previously decrypted the Fernet-encrypted provider
credential and rebuilt the provider client from scratch. Anthropic /
OpenAI SDKs each carry their own ``httpx`` connection pool, so
re-instantiating throws away the warm TLS handshakes that the next
request would otherwise reuse.

This module exposes a process-singleton ``ProviderClientLRU`` keyed by
``ProviderKey.id``. Entries hold the decrypted credential AND the
constructed provider client, so a cache hit skips the Fernet decrypt and
the provider construction. TTL: 1 hour. Size cap: 256.

Cross-pod invalidation lands via the existing pubsub channel
``provider_keys:invalidate:{key_id}`` (published by
``invalidate_provider_metadata`` in ``domains/agents/cache.py``).
``init_provider_invalidation_subscriber`` starts a long-lived asyncio
task that ``PSUBSCRIBE``s to the pattern and drops the matching LRU
entry on every received message.

The LRU is in-process only: the encrypted credential never leaves PG
and the decrypted material never enters Valkey.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

import redis.asyncio as aioredis
from loguru import logger
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from uniffy.core.valkey.config import ValkeyConfig
from uniffy.observability.metrics import (
    LLM_PROVIDER_LRU_HIT_TOTAL,
    LLM_PROVIDER_LRU_MISS_TOTAL,
)

if TYPE_CHECKING:
    from uniffy.domains.agents.providers.base import LLMProvider


_TTL_SECONDS = 3600
_MAX_SIZE = 256
_INVALIDATE_PATTERN = "provider_keys:invalidate:*"
_RECONNECT_BACKOFF_SECONDS = 5.0
_POLL_TIMEOUT_SECONDS = 1.0


@dataclass
class _CachedEntry:
    credential: str
    provider: LLMProvider
    cached_at: float


class ProviderClientLRU:
    """Bounded TTL+LRU keyed by provider-key id.

    Concurrency model: a single ``asyncio.Lock`` serialises mutations.
    Reads are short and the cache is local to one process so the lock
    contention is negligible compared to the cost of a Fernet decrypt.
    """

    def __init__(self) -> None:
        self._entries: OrderedDict[UUID, _CachedEntry] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, key_id: UUID) -> tuple[str, LLMProvider] | None:
        async with self._lock:
            entry = self._entries.get(key_id)
            if entry is None:
                return None
            if time.time() - entry.cached_at > _TTL_SECONDS:
                self._entries.pop(key_id, None)
                return None
            self._entries.move_to_end(key_id)
            return entry.credential, entry.provider

    async def set(
        self,
        key_id: UUID,
        credential: str,
        provider: LLMProvider,
    ) -> None:
        async with self._lock:
            self._entries[key_id] = _CachedEntry(
                credential=credential,
                provider=provider,
                cached_at=time.time(),
            )
            self._entries.move_to_end(key_id)
            while len(self._entries) > _MAX_SIZE:
                self._entries.popitem(last=False)

    async def invalidate(self, key_id: UUID) -> bool:
        async with self._lock:
            return self._entries.pop(key_id, None) is not None

    async def size(self) -> int:
        async with self._lock:
            return len(self._entries)


_lru: ProviderClientLRU | None = None
_subscriber_task: asyncio.Task[None] | None = None
_subscriber_shutdown: asyncio.Event | None = None


def get_provider_lru() -> ProviderClientLRU:
    """Return the process-singleton LRU, lazily initialised."""
    global _lru
    if _lru is None:
        _lru = ProviderClientLRU()
    return _lru


def record_lru_hit() -> None:
    LLM_PROVIDER_LRU_HIT_TOTAL.inc()


def record_lru_miss() -> None:
    LLM_PROVIDER_LRU_MISS_TOTAL.inc()


async def init_provider_invalidation_subscriber() -> None:
    """Start the long-lived pubsub listener for provider-key invalidation.

    Idempotent: a second call is a no-op while the first task is alive.
    Mirrors the ``init_pubsub`` lifecycle pattern used elsewhere.
    """
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_task is not None and not _subscriber_task.done():
        return

    _subscriber_shutdown = asyncio.Event()
    _subscriber_task = asyncio.create_task(_run_subscriber())
    logger.info("Provider invalidation subscriber started")


async def close_provider_invalidation_subscriber() -> None:
    """Signal shutdown and await the subscriber task.

    Safe to call when no subscriber is running.
    """
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_shutdown is not None:
        _subscriber_shutdown.set()

    if _subscriber_task is not None:
        try:
            await asyncio.wait_for(_subscriber_task, timeout=3.0)
        except (TimeoutError, asyncio.CancelledError):
            _subscriber_task.cancel()
        except Exception as exc:
            logger.warning(f"Provider invalidation subscriber teardown failed: {exc}")
        _subscriber_task = None

    _subscriber_shutdown = None
    logger.info("Provider invalidation subscriber stopped")


async def _run_subscriber() -> None:
    """Listen on ``provider_keys:invalidate:*`` and drop LRU entries."""
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
            logger.info(
                f"Provider invalidation subscriber listening on {_INVALIDATE_PATTERN}"
            )

            while _subscriber_shutdown is None or not _subscriber_shutdown.is_set():
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=_POLL_TIMEOUT_SECONDS,
                )
                if msg is None:
                    continue
                if msg.get("type") != "pmessage":
                    continue
                await _handle_invalidate_message(msg.get("data"))

        except (RedisConnectionError, RedisTimeoutError, OSError) as exc:
            logger.warning(
                f"Provider invalidation subscriber connection error: {exc}; "
                f"reconnecting in {_RECONNECT_BACKOFF_SECONDS}s"
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                f"Provider invalidation subscriber unexpected error: {exc}; "
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
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Provider invalidate message decode failed: {raw!r}")
        return
    raw_id = payload.get("key_id") if isinstance(payload, dict) else None
    if not isinstance(raw_id, str):
        return
    try:
        key_id = UUID(raw_id)
    except ValueError:
        logger.warning(f"Provider invalidate message invalid key_id: {raw_id!r}")
        return
    dropped = await get_provider_lru().invalidate(key_id)
    if dropped:
        logger.debug(f"Provider LRU dropped {key_id}")
