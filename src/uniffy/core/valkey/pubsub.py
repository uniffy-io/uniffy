"""Valkey Pub/Sub for real-time notification delivery.

Separate from the ARQ queue pool -- Pub/Sub connections enter a special mode
and cannot be used for regular commands. This module manages dedicated
publisher and subscriber connections.

Channel naming: notifications:{user_id}
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis
from loguru import logger

from uniffy.core.valkey.config import ValkeyConfig
from uniffy.observability.metrics import PUBSUB_ACTIVE_SUBSCRIBERS

# Socket-level timeouts (seconds) for all Valkey connections.
# Prevents indefinite hangs on connect, subscribe, and cleanup.
_SOCKET_CONNECT_TIMEOUT = 5
_SOCKET_TIMEOUT = 5

# Hard ceiling for cleanup during shutdown / generator close.
_CLEANUP_TIMEOUT = 3.0

# Global publisher connection (initialized per-process)
_publisher: aioredis.Redis | None = None

# Process-wide shutdown event -- set during lifespan shutdown so every
# active subscriber generator breaks on the next poll tick (within 1s)
# instead of waiting for hypercorn's full graceful_timeout.
_shutdown_event: asyncio.Event | None = None

LOGGER_COMPONENT = "pubsub"


async def init_pubsub() -> None:
    """
    Initialize the global Pub/Sub publisher connection.

    Should be called during application/worker startup.

    """
    global _publisher, _shutdown_event

    _shutdown_event = asyncio.Event()

    url = ValkeyConfig.from_env().to_url()
    _publisher = aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=_SOCKET_CONNECT_TIMEOUT,
        socket_timeout=_SOCKET_TIMEOUT,
    )

    # Verify connection
    await _publisher.ping()
    logger.info("Pub/Sub publisher initialized")


async def close_pubsub() -> None:
    """
    Close the global Pub/Sub publisher connection.

    Should be called during application/worker shutdown.

    Sets the shutdown event first so all active subscriber generators
    break within 1 second, then closes the publisher connection.

    """
    global _publisher, _shutdown_event

    # Signal shutdown in case it wasn't already done via signal handler
    # (e.g. worker process, tests, or programmatic shutdown).
    signal_pubsub_shutdown()

    # Give subscribers a moment to finish cleanup before closing publisher.
    if PUBSUB_ACTIVE_SUBSCRIBERS._value.get() > 0:
        await asyncio.sleep(0.1)

    if _publisher:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(_publisher.aclose(), timeout=_CLEANUP_TIMEOUT)
        _publisher = None
        logger.info("Pub/Sub publisher closed", component=LOGGER_COMPONENT)


def signal_pubsub_shutdown() -> None:
    """
    Signal all subscriber generators to stop on the next poll tick.

    Safe to call from a signal handler (non-async, no I/O).
    Should be called as early as possible during process shutdown,
    BEFORE hypercorn's graceful_timeout starts counting.
    """
    if _shutdown_event is not None:
        _shutdown_event.set()
        logger.info(
            "Pub/Sub shutdown signalled",
            component=LOGGER_COMPONENT,
        )


def _channel_name(user_id: UUID) -> str:
    """Build the Pub/Sub channel name for a user."""
    return f"notifications:{user_id}"


async def publish_notification(user_id: UUID, payload: dict[str, Any]) -> None:
    """
    Publish a notification to a user's Pub/Sub channel.

    Parameters
    ----------
    user_id : UUID
        Recipient user ID.
    payload : dict
        Notification payload to publish (will be JSON-serialized).

    """
    if _publisher is None:
        logger.warning("publisher not initialized, skipping publish")
        return

    channel = _channel_name(user_id)
    message = json.dumps(payload)
    try:
        await _publisher.publish(channel, message)
        logger.debug(f"published notification to {channel}", component=LOGGER_COMPONENT)
    except Exception:
        logger.warning(f"Failed to publish to channel {channel}", component=LOGGER_COMPONENT)


async def subscribe_user(user_id: UUID) -> AsyncGenerator[dict[str, Any] | None]:
    """
    Subscribe to a user's notification channel.

    Creates a new subscriber connection per call (each streaming RPC
    gets its own connection). Yields parsed notification payloads, or
    None on poll timeouts (used by callers for heartbeat timing and
    cancellation checks).

    The poll-based approach (get_message with timeout) ensures the
    generator yields control every second, making it reliably
    cancellable via GeneratorExit / CancelledError.

    Parameters
    ----------
    user_id : UUID
        User ID to subscribe to.

    Yields
    ------
    dict | None
        Parsed notification payload, or None on poll timeout.

    """
    PUBSUB_ACTIVE_SUBSCRIBERS.inc()

    url = ValkeyConfig.from_env().to_url()
    subscriber = aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=_SOCKET_CONNECT_TIMEOUT,
        socket_timeout=_SOCKET_TIMEOUT,
    )
    channel = _channel_name(user_id)
    pubsub = subscriber.pubsub()

    try:
        await pubsub.subscribe(channel)
        logger.info(f"subscribed to {channel}", component="pubsub")

        while True:
            # Check process-wide shutdown before each poll.
            if _shutdown_event is not None and _shutdown_event.is_set():
                logger.info(f"shutdown signalled, closing {channel}", component=LOGGER_COMPONENT)
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=1.0,
            )
            if message is not None and message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    yield data
                except (json.JSONDecodeError, TypeError):
                    logger.warning(f"Invalid message on channel {channel}")
            else:
                # Timeout tick -- caller can use for heartbeats / cancellation
                yield None
    finally:
        PUBSUB_ACTIVE_SUBSCRIBERS.dec()
        # Hard timeout on cleanup so shutdown / Ctrl+C never hangs here.
        try:
            await asyncio.wait_for(
                _close_subscriber(pubsub, subscriber, channel),
                timeout=_CLEANUP_TIMEOUT,
            )
        except (TimeoutError, BaseException):
            logger.warning(f"cleanup timed out for {channel}", component=LOGGER_COMPONENT)
        logger.info(f"unsubscribed from {channel} ", component=LOGGER_COMPONENT)


async def _close_subscriber(
    pubsub: aioredis.client.PubSub,
    subscriber: aioredis.Redis,
    channel: str,
) -> None:
    """Close a subscriber's Valkey connections with per-step suppression."""
    with contextlib.suppress(BaseException):
        await pubsub.unsubscribe(channel)
    with contextlib.suppress(BaseException):
        await pubsub.aclose()
    with contextlib.suppress(BaseException):
        await subscriber.aclose()
