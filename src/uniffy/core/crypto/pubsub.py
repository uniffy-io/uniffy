"""Cross-pod invalidation for the in-process DEK LRU.

A rotation in any pod publishes once to ``org_deks:invalidate:{org_id}``;
every pod's subscriber drops the matching ``OrgDekLRU`` entries. The
publisher reuses the shared pubsub tier; the subscriber owns a
long-lived ``PSUBSCRIBE`` connection with the same reconnect / shutdown
pattern as ``ProviderClientLRU``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from uuid import UUID

import redis.asyncio as aioredis
from loguru import logger
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from uniffy.core.crypto.cache import get_org_dek_lru
from uniffy.core.valkey.config import ValkeyConfig
from uniffy.core.valkey.pubsub import publish_to_channel

_INVALIDATE_PATTERN = "org_deks:invalidate:*"
_RECONNECT_BACKOFF_SECONDS = 5.0
_POLL_TIMEOUT_SECONDS = 1.0


def org_dek_invalidate_channel(organization_id: UUID) -> str:
    """Pubsub channel name for a per-org DEK invalidation event."""
    return f"org_deks:invalidate:{organization_id}"


async def publish_dek_invalidation(organization_id: UUID) -> None:
    """Tell every pod to drop its cached DEK(s) for an organization."""
    await publish_to_channel(
        org_dek_invalidate_channel(organization_id),
        {"organization_id": str(organization_id)},
    )


_subscriber_task: asyncio.Task[None] | None = None
_subscriber_shutdown: asyncio.Event | None = None


async def subscribe_dek_invalidations() -> None:
    """Start the long-lived pubsub listener for DEK invalidation.

    Idempotent: a second call is a no-op while the first task is alive.
    Mirrors the ``init_provider_invalidation_subscriber`` lifecycle.
    """
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_task is not None and not _subscriber_task.done():
        return

    _subscriber_shutdown = asyncio.Event()
    _subscriber_task = asyncio.create_task(_run_subscriber())
    logger.info("Org DEK invalidation subscriber started")


async def close_dek_invalidation_subscriber() -> None:
    """Signal shutdown and await the subscriber task."""
    global _subscriber_task, _subscriber_shutdown

    if _subscriber_shutdown is not None:
        _subscriber_shutdown.set()

    if _subscriber_task is not None:
        try:
            await asyncio.wait_for(_subscriber_task, timeout=3.0)
        except (TimeoutError, asyncio.CancelledError):
            _subscriber_task.cancel()
        except Exception as exc:
            logger.warning(f"Org DEK invalidation subscriber teardown failed: {exc}")
        _subscriber_task = None

    _subscriber_shutdown = None
    logger.info("Org DEK invalidation subscriber stopped")


async def _run_subscriber() -> None:
    """Listen on ``org_deks:invalidate:*`` and drop matching LRU entries."""
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
                f"Org DEK invalidation subscriber listening on {_INVALIDATE_PATTERN}"
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
                f"Org DEK invalidation subscriber connection error: {exc}; "
                f"reconnecting in {_RECONNECT_BACKOFF_SECONDS}s"
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception(
                f"Org DEK invalidation subscriber unexpected error: {exc}; "
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
    """Parse one pubsub payload and drop the matching LRU entries."""
    if raw is None:
        return
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning(f"Org DEK invalidate message decode failed: {raw!r}")
        return
    raw_id = (
        payload.get("organization_id") if isinstance(payload, dict) else None
    )
    if not isinstance(raw_id, str):
        return
    try:
        organization_id = UUID(raw_id)
    except ValueError:
        logger.warning(
            f"Org DEK invalidate message invalid organization_id: {raw_id!r}"
        )
        return
    dropped = await get_org_dek_lru().invalidate(organization_id)
    if dropped:
        logger.debug(f"Org DEK LRU dropped {dropped} entries for {organization_id}")
