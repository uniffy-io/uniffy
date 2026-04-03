"""Valkey Pub/Sub for real-time notification delivery.

Separate from the ARQ queue pool -- Pub/Sub connections enter a special mode
and cannot be used for regular commands. This module manages dedicated
publisher and subscriber connections.

Channel naming: notifications:{user_id}

Connection resilience:
- Publisher auto-reconnects on transient failures via retry_on_error
- Subscriber connections use the same retry config
- All connections have socket-level timeouts to prevent indefinite hangs
- TCP keepalive detects dead connections through firewalls/load balancers
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis
from loguru import logger
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from uniffy.core.valkey.config import ValkeyConfig
from uniffy.observability.metrics import PUBSUB_ACTIVE_SUBSCRIBERS

# Socket-level timeouts (seconds) for all Valkey connections.
# Prevents indefinite hangs on connect, subscribe, and cleanup.
_SOCKET_CONNECT_TIMEOUT = 5
_SOCKET_TIMEOUT = 5

# Hard ceiling for cleanup during shutdown / generator close.
_CLEANUP_TIMEOUT = 3.0

# Errors that trigger automatic retry (connection lost, read timeout).
_RETRY_ERRORS = [RedisConnectionError, RedisTimeoutError, OSError, ConnectionResetError]

# Number of retries for automatic reconnect on transient errors.
_RETRY_COUNT = 3

# Global publisher connection (initialized per-process)
_publisher: aioredis.Redis | None = None

# Process-wide shutdown event -- set during lifespan shutdown so every
# active subscriber generator breaks on the next poll tick (within 1s)
# instead of waiting for hypercorn's full graceful_timeout.
_shutdown_event: asyncio.Event | None = None

LOGGER_COMPONENT = "pubsub"


def _build_client(url: str) -> aioredis.Redis:
    """Create a Valkey client with resilient connection settings."""
    return aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=_SOCKET_CONNECT_TIMEOUT,
        socket_timeout=_SOCKET_TIMEOUT,
        socket_keepalive=True,
        socket_keepalive_options={},
        retry_on_error=_RETRY_ERRORS,
        retry_on_timeout=True,
        health_check_interval=30,
    )


async def init_pubsub() -> None:
    """
    Initialize the global Pub/Sub publisher connection.

    Should be called during application/worker startup.

    """
    global _publisher, _shutdown_event

    _shutdown_event = asyncio.Event()

    url = ValkeyConfig.from_env().to_url()
    _publisher = _build_client(url)

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


async def _ensure_publisher() -> aioredis.Redis | None:
    """Return the publisher, attempting to reconnect if it was lost."""
    global _publisher

    if _publisher is None:
        return None

    try:
        await _publisher.ping()
        return _publisher
    except Exception:
        logger.warning(
            "Publisher connection lost, attempting reconnect...",
            component=LOGGER_COMPONENT,
        )

    # Reconnect attempt
    try:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(_publisher.aclose(), timeout=_CLEANUP_TIMEOUT)

        url = ValkeyConfig.from_env().to_url()
        _publisher = _build_client(url)
        await _publisher.ping()
        logger.info("Publisher reconnected successfully", component=LOGGER_COMPONENT)
        return _publisher
    except Exception as e:
        logger.error(f"Publisher reconnect failed: {e}", component=LOGGER_COMPONENT)
        _publisher = None
        return None


async def publish_notification(user_id: UUID, payload: dict[str, Any]) -> None:
    """
    Publish a notification to a user's Pub/Sub channel.

    Automatically attempts to reconnect the publisher if the connection
    was lost due to network issues.

    Parameters
    ----------
    user_id : UUID
        Recipient user ID.
    payload : dict
        Notification payload to publish (will be JSON-serialized).

    """
    publisher = await _ensure_publisher()
    if publisher is None:
        logger.warning("publisher not available, skipping publish")
        return

    channel = _channel_name(user_id)
    message = json.dumps(payload)
    try:
        await publisher.publish(channel, message)
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
    subscriber = _build_client(url)
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


async def subscribe_channels(*channels: str) -> AsyncGenerator[dict[str, Any] | None]:
    """Subscribe to multiple Valkey Pub/Sub channels.

    Same semantics as subscribe_user but accepts arbitrary channel names.
    Used by the notification stream to listen to both user notifications
    and org-wide presence changes simultaneously.

    Parameters
    ----------
    *channels : str
        Channel names to subscribe to.

    Yields
    ------
    dict | None
        Parsed payload from any subscribed channel, or None on poll timeout.

    """
    PUBSUB_ACTIVE_SUBSCRIBERS.inc()

    url = ValkeyConfig.from_env().to_url()
    subscriber = _build_client(url)
    channel_label = ",".join(channels)
    pubsub = subscriber.pubsub()

    try:
        await pubsub.subscribe(*channels)
        logger.info(f"subscribed to {channel_label}", component=LOGGER_COMPONENT)

        while True:
            # Check process-wide shutdown before each poll.
            if _shutdown_event is not None and _shutdown_event.is_set():
                logger.info(f"shutdown, closing {channel_label}", component=LOGGER_COMPONENT)
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
                    logger.warning(f"Invalid message on channels {channel_label}")
            else:
                # Timeout tick -- caller can use for heartbeats / cancellation
                yield None
    finally:
        PUBSUB_ACTIVE_SUBSCRIBERS.dec()
        # Hard timeout on cleanup so shutdown / Ctrl+C never hangs here.
        try:
            await asyncio.wait_for(
                _close_subscriber_channels(pubsub, subscriber, channels),
                timeout=_CLEANUP_TIMEOUT,
            )
        except (TimeoutError, BaseException):
            logger.warning(f"cleanup timed out for {channel_label}", component=LOGGER_COMPONENT)
        logger.info(f"unsubscribed from {channel_label}", component=LOGGER_COMPONENT)


async def _close_subscriber_channels(
    pubsub: aioredis.client.PubSub,
    subscriber: aioredis.Redis,
    channels: tuple[str, ...],
) -> None:
    """Close a multi-channel subscriber's Valkey connections."""
    for ch in channels:
        with contextlib.suppress(BaseException):
            await pubsub.unsubscribe(ch)
    with contextlib.suppress(BaseException):
        await pubsub.aclose()
    with contextlib.suppress(BaseException):
        await subscriber.aclose()


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
