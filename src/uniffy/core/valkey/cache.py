"""General-purpose Valkey cache.

Every public entry runs under the 150ms ``ops_call`` deadline; a slow / down
Valkey returns ``CACHE_MISS`` (or no-ops the write) and the caller falls through
to PG. A ``"__none__"`` sentinel distinguishes a cached ``None`` from a miss.

``CACHE_DISABLED_NAMESPACES`` (env, comma-separated) bypasses reads/writes per
namespace; miss counters still increment so dashboards stay populated.

``cache_get_or_set_locked`` uses a ``SET NX`` lock at ``lock:{cache_key}`` (5s)
to prevent loader stampedes; lock losers poll every 100ms then fall through.
"""

import asyncio
import os
import time
from collections.abc import Awaitable, Callable
from enum import Enum, auto
from typing import Any

from loguru import logger

from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.core.valkey.ops import _get_ops_client, ops_call
from uniffy.observability.metrics import (
    CACHE_HIT_TOTAL,
    CACHE_INVALIDATE_TOTAL,
    CACHE_LOAD_DURATION,
    CACHE_MISS_TOTAL,
    CACHE_SET_TOTAL,
    CACHE_STAMPEDE_LOCK_WAIT_TOTAL,
)

logger = logger.bind(component="core.valkey.cache")

_SENTINEL = "__none__"
_DEFAULT_TTL_SECONDS = 900
_LOCK_TTL_SECONDS = 5
_LOCK_POLL_INTERVAL_SECONDS = 0.1
_DISABLED_NAMESPACES: frozenset[str] = frozenset(
    ns.strip() for ns in os.getenv("CACHE_DISABLED_NAMESPACES", "").split(",") if ns.strip()
)


class _CacheMiss(Enum):
    """Sentinel distinguishing a true miss from a cached ``None``."""

    MISS = auto()


CACHE_MISS = _CacheMiss.MISS


def _namespace_for_key(key: str) -> str:
    idx = key.find(":")
    return key if idx < 0 else key[:idx]


def _is_namespace_disabled(key: str) -> bool:
    if not _DISABLED_NAMESPACES:
        return False
    if _namespace_for_key(key) in _DISABLED_NAMESPACES:
        return True
    for disabled in _DISABLED_NAMESPACES:
        if ":" in disabled and (key == disabled or key.startswith(f"{disabled}:")):  # noqa: PLR2004
            return True
    return False


def _tag_key(tag: str) -> str:
    return f"tag:{tag}"


async def cache_get(key: str) -> dict[str, Any] | None | _CacheMiss:
    """Returns the dict on hit, ``None`` on a sentinel hit, or ``CACHE_MISS`` otherwise."""
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
        logger.warning(f"Cache GET failed for key {key}")
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    if raw is None:
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    if raw == _SENTINEL:
        CACHE_HIT_TOTAL.labels(namespace=namespace).inc()
        return None

    try:
        decoded = loads(raw)
    except JSONDecodeError, TypeError:
        logger.warning(f"Cache decode failed for key {key}")
        CACHE_MISS_TOTAL.labels(namespace=namespace).inc()
        return CACHE_MISS

    CACHE_HIT_TOTAL.labels(namespace=namespace).inc()
    return decoded


async def cache_get_many(
    keys: list[str],
) -> tuple[dict[str, dict[str, Any] | None], list[str]]:
    """MGET-backed bulk ``cache_get``. Misses preserve input order for downstream PG."""
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
        logger.warning(f"Cache MGET failed for {len(enabled_keys)} keys")
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
            decoded = loads(raw)
        except JSONDecodeError, TypeError:
            logger.warning(f"Cache decode failed for key {key}")
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
    """Store a JSON value. ``value=None`` becomes a sentinel; ``tags``
    registers the key on each ``tag:{tag}`` set.
    """
    if _is_namespace_disabled(key):
        return

    client = _get_ops_client()
    if client is None:
        return

    namespace = _namespace_for_key(key)
    serialized = _SENTINEL if value is None else dumps_bytes(value)

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
        logger.warning(f"Cache SET failed for key {key}")


async def cache_delete(key: str) -> None:
    client = _get_ops_client()
    if client is None:
        return

    namespace = _namespace_for_key(key)
    try:
        async with ops_call(namespace, "delete"):
            await client.delete(key)
        CACHE_INVALIDATE_TOTAL.labels(namespace=namespace).inc()
        logger.debug(f"Cache invalidated key {key}")
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Cache DEL failed for key {key}")


async def cache_invalidate_many(*keys: str) -> None:
    """DEL multiple keys in one round-trip."""
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
        logger.warning(f"Cache DEL many failed for {len(keys)} keys")


async def cache_invalidate_by_tag(tag: str) -> None:
    """Delete every key registered under ``tag`` and the tag set itself."""
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
        logger.warning(f"Cache tag SMEMBERS failed for {tag_key}")
        return

    if not members:
        try:
            async with ops_call(namespace, "invalidate_by_tag"):
                await client.delete(tag_key)
        except TimeoutError:
            return
        except Exception:
            logger.warning(f"Cache tag DEL failed for {tag_key}")
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
        logger.warning(f"Cache tag invalidate DEL failed for {tag_key}")


async def cache_get_or_set(
    key: str,
    loader: Callable[[], Awaitable[dict[str, Any] | None]],
    ttl: int = _DEFAULT_TTL_SECONDS,
    *,
    tags: list[str] | None = None,
) -> dict[str, Any] | None:
    """Cached value or ``loader()``; no stampede protection (use ``_locked``
    for expensive loaders).
    """
    cached = await cache_get(key)
    if cached is not CACHE_MISS:
        return cached  # type: ignore[return-value]

    namespace = _namespace_for_key(key)
    start = time.perf_counter()
    value = await loader()
    CACHE_LOAD_DURATION.labels(namespace=namespace).observe(time.perf_counter() - start)

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
            acquired = bool(await client.set(lock_key, "1", ex=_LOCK_TTL_SECONDS, nx=True))
    except TimeoutError:
        acquired = False
    except Exception:
        logger.warning(f"Cache lock SET NX failed for {lock_key}")
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
                logger.warning(f"Cache lock DEL failed for {lock_key}")

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
    CACHE_LOAD_DURATION.labels(namespace=namespace).observe(time.perf_counter() - start)
    await cache_set(key, value, ttl=ttl, tags=tags)
    return value
