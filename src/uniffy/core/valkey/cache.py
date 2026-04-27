"""General-purpose Valkey cache layer.

Backed by the fail-fast ops client in ``uniffy.core.valkey.ops``: every
public entry runs under a 150ms ``ops_call`` deadline so a slow / down
Valkey returns ``CACHE_MISS`` (or no-ops the write) instead of stalling
the user request. The caller falls through to PG.

All operations are also non-fatal at the connection level: on
``RedisConnectionError`` / decode failures they log a warning and
degrade gracefully (cache miss on GET, silent no-op on SET/DEL).

A ``"__none__"`` sentinel string is stored when the caller explicitly
caches ``None`` so that a true cache miss (key absent) can be
distinguished from "we checked, and the value is legitimately empty".

Domain-specific cache helpers live in their respective domain modules
(e.g. ``domains/notifications/cache.py``).

Per-namespace kill-switch
-------------------------
Set the env var ``CACHE_DISABLED_NAMESPACES`` to a comma-separated list
to bypass cache reads/writes for those namespaces. Disabled namespaces
still bump miss counters so the dashboards stay populated. The disable
list is read once at import time. Restart the process to flip a
namespace.

Stampede control
----------------
``cache_get_or_set_locked`` uses a short ``SET NX`` lock keyed
``lock:{cache_key}`` (5s TTL) so only one caller runs the loader on a
miss. Lock losers poll the cache key every 100ms up to the lock TTL.
On still-miss they fall through and run their own loader.
"""

import asyncio
import json
import os
import time
from collections.abc import Awaitable, Callable
from enum import Enum, auto
from typing import Any, TypeVar

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client, ops_call
from uniffy.observability.metrics import (
    CACHE_HIT_TOTAL,
    CACHE_INVALIDATE_TOTAL,
    CACHE_LOAD_DURATION,
    CACHE_MISS_TOTAL,
    CACHE_SET_TOTAL,
    CACHE_STAMPEDE_LOCK_WAIT_TOTAL,
)

_SENTINEL = "__none__"
_DEFAULT_TTL_SECONDS = 900
_LOCK_TTL_SECONDS = 5
_LOCK_POLL_INTERVAL_SECONDS = 0.1

_DISABLED_NAMESPACES: frozenset[str] = frozenset(
    ns.strip()
    for ns in os.getenv("CACHE_DISABLED_NAMESPACES", "").split(",")
    if ns.strip()
)

T = TypeVar("T", bound=dict[str, Any] | None)


class _CacheMiss(Enum):
    """Sentinel type distinguishing a cache miss from a cached ``None``."""

    MISS = auto()


CACHE_MISS = _CacheMiss.MISS


def _namespace_for_key(key: str) -> str:
    """Return the metrics namespace for a cache key (segment before first ':')."""
    idx = key.find(":")
    return key if idx < 0 else key[:idx]


def _is_namespace_disabled(key: str) -> bool:
    """Return True when the key falls under a CACHE_DISABLED_NAMESPACES entry."""
    if not _DISABLED_NAMESPACES:
        return False
    if _namespace_for_key(key) in _DISABLED_NAMESPACES:
        return True
    for disabled in _DISABLED_NAMESPACES:
        if ":" in disabled and (key == disabled or key.startswith(f"{disabled}:")):
            return True
    return False


def _tag_key(tag: str) -> str:
    return f"tag:{tag}"


async def cache_get(key: str) -> dict[str, Any] | None | _CacheMiss:
    """Fetch a JSON-serialised value from cache.

    Returns the deserialised dict on hit, ``None`` on a sentinel hit
    (legitimate cached ``None``), or ``CACHE_MISS`` for any other path:
    key absent, namespace disabled, ops client unavailable, Valkey
    error, decode failure, or the per-call deadline tripping.
    """
    namespace = _namespace_for_key(key)

    if _is_namespace_disabled(key):
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    client = _get_ops_client()
    if client is None:
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    try:
        async with ops_call(namespace, "get"):
            raw = await client.get(key)
    except TimeoutError:
        return CACHE_MISS
    except Exception:
        logger.warning(f"Cache GET failed for key {key}", component="cache")
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    if raw is None:
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    if raw == _SENTINEL:
        CACHE_HIT_TOTAL.labels(namespace=namespace).inc()
        return None

    try:
        decoded = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Cache decode failed for key {key}", component="cache")
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    CACHE_HIT_TOTAL.labels(namespace=namespace).inc()
    return decoded


async def cache_get_many(
    keys: list[str],
) -> tuple[dict[str, dict[str, Any] | None], list[str]]:
    """Bulk variant of ``cache_get`` backed by a single Valkey MGET.

    Returns ``(hits, misses)``:
    - ``hits``: ``key -> dict`` for present entries, ``key -> None`` when
      the cached value is the explicit-None sentinel.
    - ``misses``: keys that were not present (or whose namespace is
      disabled, or whose decoded payload was malformed, or where the
      MGET tripped the per-call deadline). Order matches the input
      order so callers can re-issue PG queries deterministically.
    """
    if not keys:
        return {}, []

    hits: dict[str, dict[str, Any] | None] = {}
    misses: list[str] = []

    enabled_keys: list[str] = []
    for key in keys:
        if _is_namespace_disabled(key):
            CACHE_MISS_TOTAL.labels(namespace=_namespace_for_key(key)).inc()
            misses.append(key)
        else:
            enabled_keys.append(key)

    if not enabled_keys:
        return hits, misses

    client = _get_ops_client()
    if client is None:
        for key in enabled_keys:
            CACHE_MISS_TOTAL.labels(namespace=_namespace_for_key(key)).inc()
            misses.append(key)
        return hits, misses

    namespace = _namespace_for_key(enabled_keys[0])
    try:
        async with ops_call(namespace, "get_many"):
            raws = await client.mget(*enabled_keys)
    except TimeoutError:
        for key in enabled_keys:
            CACHE_MISS_TOTAL.labels(namespace=_namespace_for_key(key)).inc()
            misses.append(key)
        return hits, misses
    except Exception:
        logger.warning(
            f"Cache MGET failed for {len(enabled_keys)} keys", component="cache"
        )
        for key in enabled_keys:
            CACHE_MISS_TOTAL.labels(namespace=_namespace_for_key(key)).inc()
            misses.append(key)
        return hits, misses

    for key, raw in zip(enabled_keys, raws, strict=True):
        ns = _namespace_for_key(key)
        if raw is None:
            CACHE_MISS_TOTAL.labels(namespace=ns).inc()
            misses.append(key)
            continue
        if raw == _SENTINEL:
            CACHE_HIT_TOTAL.labels(namespace=ns).inc()
            hits[key] = None
            continue
        try:
            decoded = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning(f"Cache decode failed for key {key}", component="cache")
            CACHE_MISS_TOTAL.labels(namespace=ns).inc()
            misses.append(key)
            continue
        CACHE_HIT_TOTAL.labels(namespace=ns).inc()
        hits[key] = decoded

    return hits, misses


async def cache_set(
    key: str,
    value: dict[str, Any] | None,
    ttl: int = _DEFAULT_TTL_SECONDS,
    *,
    tags: list[str] | None = None,
) -> None:
    """Store a JSON-serializable value in cache.

    ``value=None`` is stored as a sentinel. ``tags`` adds the key to each
    ``tag:{tag}`` set so ``cache_invalidate_by_tag`` can wipe related
    entries in one call; the tag set's TTL is bumped to ``ttl + 60``.
    """
    if _is_namespace_disabled(key):
        return

    client = _get_ops_client()
    if client is None:
        return

    namespace = _namespace_for_key(key)
    serialized = _SENTINEL if value is None else json.dumps(value)

    try:
        async with ops_call(namespace, "set"):
            if tags:
                tag_ttl = ttl + 60
                pipe = client.pipeline(transaction=False)
                pipe.set(key, serialized, ex=ttl)
                for tag in tags:
                    tk = _tag_key(tag)
                    pipe.sadd(tk, key)
                    pipe.expire(tk, tag_ttl)
                await pipe.execute()
            else:
                await client.set(key, serialized, ex=ttl)
        CACHE_SET_TOTAL.labels(namespace=namespace).inc()
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Cache SET failed for key {key}", component="cache")


async def cache_delete(key: str) -> None:
    """Delete a single key from cache."""
    client = _get_ops_client()
    if client is None:
        return

    namespace = _namespace_for_key(key)
    try:
        async with ops_call(namespace, "delete"):
            await client.delete(key)
        CACHE_INVALIDATE_TOTAL.labels(namespace=namespace).inc()
        logger.debug(f"Cache invalidated key {key}", component="cache")
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Cache DEL failed for key {key}", component="cache")


async def cache_invalidate_many(*keys: str) -> None:
    """Delete multiple keys in a single Valkey DEL round-trip."""
    if not keys:
        return

    client = _get_ops_client()
    if client is None:
        return

    namespace = _namespace_for_key(keys[0])
    try:
        async with ops_call(namespace, "invalidate_many"):
            await client.delete(*keys)
        for key in keys:
            CACHE_INVALIDATE_TOTAL.labels(namespace=_namespace_for_key(key)).inc()
    except TimeoutError:
        return
    except Exception:
        logger.warning(
            f"Cache DEL many failed for {len(keys)} keys", component="cache"
        )


async def cache_invalidate_by_tag(tag: str) -> None:
    """Delete every key registered under ``tag`` plus the tag set itself."""
    client = _get_ops_client()
    if client is None:
        return

    tag_key = _tag_key(tag)
    namespace = "tag"

    try:
        async with ops_call(namespace, "invalidate_by_tag"):
            members = await client.smembers(tag_key)
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Cache tag SMEMBERS failed for {tag_key}", component="cache")
        return

    if not members:
        try:
            async with ops_call(namespace, "invalidate_by_tag"):
                await client.delete(tag_key)
        except TimeoutError:
            return
        except Exception:
            logger.warning(f"Cache tag DEL failed for {tag_key}", component="cache")
        return

    keys = list(members)
    try:
        async with ops_call(namespace, "invalidate_by_tag"):
            await client.delete(*keys, tag_key)
        for key in keys:
            CACHE_INVALIDATE_TOTAL.labels(namespace=_namespace_for_key(key)).inc()
    except TimeoutError:
        return
    except Exception:
        logger.warning(
            f"Cache tag invalidate DEL failed for {tag_key}", component="cache"
        )


async def cache_get_or_set(
    key: str,
    loader: Callable[[], Awaitable[dict[str, Any] | None]],
    ttl: int = _DEFAULT_TTL_SECONDS,
    *,
    tags: list[str] | None = None,
) -> dict[str, Any] | None:
    """Return cached value, or run ``loader`` on miss and cache the result.

    No locking. Multiple concurrent callers all run the loader on a cold
    miss (acceptable when the loader is cheap or hit rate dominates). For
    expensive loaders that are vulnerable to thundering herds, use
    ``cache_get_or_set_locked`` instead.
    """
    cached = await cache_get(key)
    if cached is not CACHE_MISS:
        return cached  # type: ignore[return-value]

    namespace = _namespace_for_key(key)
    start = time.perf_counter()
    value = await loader()
    CACHE_LOAD_DURATION.labels(namespace=namespace).observe(
        time.perf_counter() - start
    )

    await cache_set(key, value, ttl=ttl, tags=tags)
    return value


async def cache_get_or_set_locked(
    key: str,
    loader: Callable[[], Awaitable[dict[str, Any] | None]],
    ttl: int = _DEFAULT_TTL_SECONDS,
    *,
    tags: list[str] | None = None,
) -> dict[str, Any] | None:
    """Stampede-protected ``cache_get_or_set``."""
    cached = await cache_get(key)
    if cached is not CACHE_MISS:
        return cached  # type: ignore[return-value]

    namespace = _namespace_for_key(key)
    client = _get_ops_client()

    if client is None or _is_namespace_disabled(key):
        return await _load_and_store(key, loader, ttl, tags, namespace)

    lock_key = f"lock:{key}"
    acquired = False
    try:
        async with ops_call(namespace, "get_or_set_locked"):
            acquired = bool(
                await client.set(lock_key, "1", ex=_LOCK_TTL_SECONDS, nx=True)
            )
    except TimeoutError:
        acquired = False
    except Exception:
        logger.warning(f"Cache lock SET NX failed for {lock_key}", component="cache")
        acquired = False

    if acquired:
        try:
            return await _load_and_store(key, loader, ttl, tags, namespace)
        finally:
            try:
                async with ops_call(namespace, "get_or_set_locked"):
                    await client.delete(lock_key)
            except TimeoutError:
                pass
            except Exception:
                logger.warning(
                    f"Cache lock DEL failed for {lock_key}", component="cache"
                )

    CACHE_STAMPEDE_LOCK_WAIT_TOTAL.labels(namespace=namespace).inc()
    deadline = time.monotonic() + _LOCK_TTL_SECONDS
    while time.monotonic() < deadline:
        await asyncio.sleep(_LOCK_POLL_INTERVAL_SECONDS)
        cached = await cache_get(key)
        if cached is not CACHE_MISS:
            return cached  # type: ignore[return-value]

    return await _load_and_store(key, loader, ttl, tags, namespace)


async def _load_and_store(
    key: str,
    loader: Callable[[], Awaitable[dict[str, Any] | None]],
    ttl: int,
    tags: list[str] | None,
    namespace: str,
) -> dict[str, Any] | None:
    start = time.perf_counter()
    value = await loader()
    CACHE_LOAD_DURATION.labels(namespace=namespace).observe(
        time.perf_counter() - start
    )
    await cache_set(key, value, ttl=ttl, tags=tags)
    return value
