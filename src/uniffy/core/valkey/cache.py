"""General-purpose Valkey cache layer.

Provides generic get / set / delete operations on top of the existing
Pub/Sub publisher connection (a regular ``aioredis.Redis`` client that is
not in subscribe mode and can therefore run arbitrary commands).

All operations are **non-fatal**: on connection errors they log a warning
and degrade gracefully (cache miss on GET, silent no-op on SET/DEL).

A ``"__none__"`` sentinel string is stored when the caller explicitly
caches ``None`` so that a true cache miss (key absent) can be
distinguished from "we checked, and the value is legitimately empty".

Domain-specific cache helpers live in their respective domain modules
(e.g. ``domains/notifications/cache.py``).
"""

import json
from enum import Enum, auto
from typing import Any

from loguru import logger

_SENTINEL = "__none__"
_DEFAULT_TTL_SECONDS = 900


class _CacheMiss(Enum):
    """Sentinel type distinguishing a cache miss from a cached ``None``."""

    MISS = auto()


CACHE_MISS = _CacheMiss.MISS


def _get_client():
    """Return the Pub/Sub publisher connection (lazy import to avoid cycles)."""
    from uniffy.core.valkey.pubsub import _publisher

    return _publisher


async def cache_get(key: str) -> dict[str, Any] | None | _CacheMiss:
    """
    Fetch a JSON-serialized value from cache.

    Returns
    -------
    dict
        The cached value (deserialized).
    None
        A sentinel was stored -- the value is legitimately empty.
    _CacheMiss.MISS
        Key not in cache or client unavailable.

    """
    client = _get_client()
    if client is None:
        return CACHE_MISS

    try:
        raw = await client.get(key)
    except Exception:
        logger.warning(f"Cache GET failed for key {key}", component="cache")
        return CACHE_MISS

    if raw is None:
        return CACHE_MISS

    if raw == _SENTINEL:
        return None

    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Cache decode failed for key {key}", component="cache")
        return CACHE_MISS


async def cache_set(
    key: str,
    value: dict[str, Any] | None,
    ttl: int = _DEFAULT_TTL_SECONDS,
) -> None:
    """
    Store a JSON-serializable value in cache.

    Parameters
    ----------
    key : str
        Cache key.
    value : dict | None
        Value to cache.  ``None`` is stored as a sentinel string.
    ttl : int
        Expiry in seconds (default 900 = 15 min).

    """
    client = _get_client()
    if client is None:
        return

    serialized = _SENTINEL if value is None else json.dumps(value)

    try:
        await client.set(key, serialized, ex=ttl)
    except Exception:
        logger.warning(f"Cache SET failed for key {key}", component="cache")


async def cache_delete(key: str) -> None:
    """Delete a key from cache."""
    client = _get_client()
    if client is None:
        return

    try:
        await client.delete(key)
        logger.debug(f"Cache invalidated key {key}", component="cache")
    except Exception:
        logger.warning(f"Cache DEL failed for key {key}", component="cache")
