"""In-process LRU and cross-process invalidation for decrypted provider clients."""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

from loguru import logger

from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.domains.agents.metrics import (
    LLM_PROVIDER_LRU_HIT_TOTAL,
    LLM_PROVIDER_LRU_MISS_TOTAL,
)
from uniffy.infrastructure.valkey.pubsub import subscribe_patterns

logger = logger.bind(component="agents.providers.clients")

if TYPE_CHECKING:
    from uniffy.domains.agents.providers.base import LLMProvider


_TTL_SECONDS = 3600
_MAX_SIZE = int(os.getenv("PROVIDER_CLIENT_LRU_SIZE", "5000"))
_INVALIDATE_PATTERN = "provider_keys:invalidate:*"
_RECONNECT_BACKOFF_SECONDS = 5.0


@dataclass
class _CachedEntry:
    credential: str
    provider: LLMProvider
    cached_at: float


class ProviderClientLRU:
    """Bounded TTL+LRU keyed by provider-key id; a single asyncio.Lock serialises mutations."""

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
    """Start the long-lived pubsub listener for provider-key invalidation. Idempotent."""
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_task is not None and not _subscriber_task.done():
        return

    _subscriber_shutdown = asyncio.Event()
    _subscriber_task = asyncio.create_task(_run_subscriber())
    logger.info("Provider invalidation subscriber started")


async def close_provider_invalidation_subscriber() -> None:
    """Signal shutdown and await the subscriber task. Safe when no subscriber is running."""
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_shutdown is not None:
        _subscriber_shutdown.set()

    if _subscriber_task is not None:
        try:
            await asyncio.wait_for(_subscriber_task, timeout=3.0)
        except TimeoutError, asyncio.CancelledError:
            _subscriber_task.cancel()
        except Exception as exc:
            logger.warning(f"Provider invalidation subscriber teardown failed: {exc}")
        _subscriber_task = None

    _subscriber_shutdown = None
    logger.info("Provider invalidation subscriber stopped")


async def _run_subscriber() -> None:
    while _subscriber_shutdown is None or not _subscriber_shutdown.is_set():
        try:
            logger.info(f"Provider invalidation subscriber listening on {_INVALIDATE_PATTERN}")
            async with contextlib.aclosing(subscribe_patterns(_INVALIDATE_PATTERN)) as messages:
                async for item in messages:
                    if _subscriber_shutdown is not None and _subscriber_shutdown.is_set():
                        break
                    if item is not None:
                        _channel, payload = item
                        await _handle_invalidate_message(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                f"Provider invalidation subscriber unexpected error: {exc}; "
                f"reconnecting in {_RECONNECT_BACKOFF_SECONDS}s"
            )
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
    if isinstance(raw, dict):
        payload = raw
    else:
        try:
            payload = loads(raw)
        except JSONDecodeError, TypeError:
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
