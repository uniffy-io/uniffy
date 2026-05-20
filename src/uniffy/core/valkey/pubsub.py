"""Valkey Pub/Sub for real-time notification delivery.

Separate from the ARQ queue pool and from the ops client -- pub/sub
connections enter a special mode and cannot be used for regular
commands. This module manages the dedicated publisher and per-call
subscriber connections.

Channel naming: notifications:{user_id}

Connection resilience:
- Publisher auto-reconnects on transient failures via retry_on_error.
- Subscriber connections use the same retry config.
- Settings come from ``ValkeyConfig.to_pubsub_kwargs()``.
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

# Hard ceiling for cleanup during shutdown / generator close.
_CLEANUP_TIMEOUT = 3.0

# Per-process publisher connection (initialised at startup).
_pubsub_client: aioredis.Redis | None = None

# Process-wide shutdown event -- set during lifespan shutdown so every
# active subscriber generator breaks on the next poll tick (within 1s)
# instead of waiting for granian's full graceful_timeout.
_shutdown_event: asyncio.Event | None = None

LOGGER_COMPONENT = "pubsub"


def _build_client(url: str) -> aioredis.Redis:
    """Create a Valkey client tuned for long-lived pubsub connections."""
    return aioredis.from_url(url, **ValkeyConfig.from_env().to_pubsub_kwargs())


async def init_pubsub() -> None:
    """Initialise the global Pub/Sub publisher connection."""
    global _pubsub_client, _shutdown_event

    _shutdown_event = asyncio.Event()

    url = ValkeyConfig.from_env().to_url()
    _pubsub_client = _build_client(url)

    await _pubsub_client.ping()
    logger.info("Pub/Sub publisher initialized")


async def close_pubsub() -> None:
    """Close the global Pub/Sub publisher connection.

    Sets the shutdown event first so all active subscriber generators
    break within 1 second, then closes the publisher connection.
    """
    global _pubsub_client, _shutdown_event

    signal_pubsub_shutdown()

    # Give subscribers a moment to finish cleanup before closing publisher.
    if PUBSUB_ACTIVE_SUBSCRIBERS._value.get() > 0:
        await asyncio.sleep(0.1)

    if _pubsub_client:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(_pubsub_client.aclose(), timeout=_CLEANUP_TIMEOUT)
        _pubsub_client = None
        logger.info("Pub/Sub publisher closed", component=LOGGER_COMPONENT)


def signal_pubsub_shutdown() -> None:
    """Signal all subscriber generators to stop on the next poll tick."""
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
    global _pubsub_client

    if _pubsub_client is None:
        return None

    try:
        await _pubsub_client.ping()
        return _pubsub_client
    except Exception:
        logger.warning(
            "Publisher connection lost, attempting reconnect...",
            component=LOGGER_COMPONENT,
        )

    try:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(_pubsub_client.aclose(), timeout=_CLEANUP_TIMEOUT)

        url = ValkeyConfig.from_env().to_url()
        _pubsub_client = _build_client(url)
        await _pubsub_client.ping()
        logger.info("Publisher reconnected successfully", component=LOGGER_COMPONENT)
        return _pubsub_client
    except Exception as e:
        logger.error(f"Publisher reconnect failed: {e}", component=LOGGER_COMPONENT)
        _pubsub_client = None
        return None


async def publish_notification(user_id: UUID, payload: dict[str, Any]) -> None:
    """Publish a notification to a user's Pub/Sub channel."""
    await publish_to_channel(_channel_name(user_id), payload)


async def publish_to_channel(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON payload to an arbitrary Pub/Sub channel.

    Used by domains that maintain their own channel naming convention
    (realtime collaboration, perm fanout, token revocation, etc.).
    """
    publisher = await _ensure_publisher()
    if publisher is None:
        logger.warning("publisher not available, skipping publish")
        return

    try:
        await publisher.publish(channel, json.dumps(payload))
        logger.debug(f"published to {channel}", component=LOGGER_COMPONENT)
    except Exception:
        logger.warning(f"Failed to publish to channel {channel}", component=LOGGER_COMPONENT)


async def subscribe_user(user_id: UUID) -> AsyncGenerator[dict[str, Any] | None]:
    """Subscribe to a user's notification channel.

    Creates a new subscriber connection per call (each streaming RPC
    gets its own connection). Yields parsed notification payloads, or
    None on poll timeouts (used by callers for heartbeat timing and
    cancellation checks).
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
                yield None
    finally:
        PUBSUB_ACTIVE_SUBSCRIBERS.dec()
        try:
            await asyncio.wait_for(
                _close_subscriber(pubsub, subscriber, channel),
                timeout=_CLEANUP_TIMEOUT,
            )
        except (TimeoutError, BaseException):
            logger.warning(f"cleanup timed out for {channel}", component=LOGGER_COMPONENT)
        logger.info(f"unsubscribed from {channel} ", component=LOGGER_COMPONENT)


async def subscribe_channels(*channels: str) -> AsyncGenerator[dict[str, Any] | None]:
    """Subscribe to multiple Valkey Pub/Sub channels."""
    PUBSUB_ACTIVE_SUBSCRIBERS.inc()

    url = ValkeyConfig.from_env().to_url()
    subscriber = _build_client(url)
    channel_label = ",".join(channels)
    pubsub = subscriber.pubsub()

    try:
        await pubsub.subscribe(*channels)
        logger.info(f"subscribed to {channel_label}", component=LOGGER_COMPONENT)

        while True:
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
                yield None
    finally:
        PUBSUB_ACTIVE_SUBSCRIBERS.dec()
        try:
            await asyncio.wait_for(
                _close_subscriber_channels(pubsub, subscriber, channels),
                timeout=_CLEANUP_TIMEOUT,
            )
        except (TimeoutError, BaseException):
            logger.warning(f"cleanup timed out for {channel_label}", component=LOGGER_COMPONENT)
        logger.info(f"unsubscribed from {channel_label}", component=LOGGER_COMPONENT)


async def subscribe_patterns(
    *patterns: str,
) -> AsyncGenerator[tuple[str, dict[str, Any]] | None]:
    """Subscribe to Valkey pubsub PATTERNS (``PSUBSCRIBE``).

    Yields ``(channel, payload)`` per matched message, or ``None`` on
    the 1s poll timeout so callers can run cancellation checks. One
    subscriber connection per call covers any number of matched
    channels - the realtime router relies on this to keep the total
    connection count flat regardless of active docs.
    """
    PUBSUB_ACTIVE_SUBSCRIBERS.inc()

    url = ValkeyConfig.from_env().to_url()
    subscriber = _build_client(url)
    pattern_label = ",".join(patterns)
    pubsub = subscriber.pubsub()

    try:
        await pubsub.psubscribe(*patterns)
        logger.info(f"psubscribed to {pattern_label}", component=LOGGER_COMPONENT)

        while True:
            if _shutdown_event is not None and _shutdown_event.is_set():
                logger.info(
                    f"shutdown, closing psubscribe {pattern_label}",
                    component=LOGGER_COMPONENT,
                )
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=1.0,
            )
            if message is not None and message["type"] == "pmessage":
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode("utf-8", errors="replace")
                try:
                    data = json.loads(message["data"])
                    yield channel, data
                except (json.JSONDecodeError, TypeError):
                    logger.warning(
                        f"Invalid pmessage on {channel}", component=LOGGER_COMPONENT
                    )
            else:
                yield None
    finally:
        PUBSUB_ACTIVE_SUBSCRIBERS.dec()
        try:
            await asyncio.wait_for(
                _close_psubscriber(pubsub, subscriber, patterns),
                timeout=_CLEANUP_TIMEOUT,
            )
        except (TimeoutError, BaseException):
            logger.warning(
                f"cleanup timed out for psubscribe {pattern_label}",
                component=LOGGER_COMPONENT,
            )
        logger.info(f"punsubscribed from {pattern_label}", component=LOGGER_COMPONENT)


async def _close_psubscriber(
    pubsub: aioredis.client.PubSub,
    subscriber: aioredis.Redis,
    patterns: tuple[str, ...],
) -> None:
    """Close a pattern subscriber's Valkey connections with per-step suppression."""
    for p in patterns:
        with contextlib.suppress(BaseException):
            await pubsub.punsubscribe(p)
    with contextlib.suppress(BaseException):
        await pubsub.aclose()
    with contextlib.suppress(BaseException):
        await subscriber.aclose()


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
