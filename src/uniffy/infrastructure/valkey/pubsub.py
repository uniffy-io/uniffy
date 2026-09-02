"""Generic Valkey publish/subscribe transport with process-owned connections."""

import asyncio
import contextlib
from collections.abc import AsyncGenerator
from typing import Any

import valkey.asyncio as aioredis
from loguru import logger

from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.infrastructure.valkey.metrics import PUBSUB_ACTIVE_SUBSCRIBERS

logger = logger.bind(component="infrastructure.valkey.pubsub")

_CLEANUP_TIMEOUT = 3.0

_pubsub_client: aioredis.Redis | None = None

# Set during lifespan shutdown so subscriber generators break on the next 1s poll
# tick instead of waiting for granian's full graceful_timeout.
_shutdown_event: asyncio.Event | None = None


def _build_client(url: str) -> aioredis.Redis:
    return aioredis.from_url(url, **ValkeyConfig.from_env().to_pubsub_kwargs())


async def init_pubsub() -> None:
    """Initialise the process-wide publisher connection."""
    global _pubsub_client, _shutdown_event

    _shutdown_event = asyncio.Event()

    url = ValkeyConfig.from_env().to_url()
    _pubsub_client = _build_client(url)

    await _pubsub_client.ping()
    logger.info("Pub/Sub publisher initialized")


async def close_pubsub() -> None:
    """Signal shutdown so subscribers break within 1s, then close the publisher."""
    global _pubsub_client, _shutdown_event

    signal_pubsub_shutdown()

    if PUBSUB_ACTIVE_SUBSCRIBERS._value.get() > 0:
        await asyncio.sleep(0.1)

    if _pubsub_client:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(_pubsub_client.aclose(), timeout=_CLEANUP_TIMEOUT)
        _pubsub_client = None
        logger.info("Pub/Sub publisher closed")


def signal_pubsub_shutdown() -> None:
    """Signal subscriber generators to stop on the next poll tick."""
    if _shutdown_event is not None:
        _shutdown_event.set()
        logger.info("Pub/Sub shutdown signalled")


async def _ensure_publisher() -> aioredis.Redis | None:
    """Return the publisher; reconnect once if the existing one is gone."""
    global _pubsub_client

    if _pubsub_client is None:
        return None

    try:
        await _pubsub_client.ping()
        return _pubsub_client
    except Exception:
        logger.warning(
            "Publisher connection lost, attempting reconnect...",
        )

    try:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(_pubsub_client.aclose(), timeout=_CLEANUP_TIMEOUT)

        url = ValkeyConfig.from_env().to_url()
        _pubsub_client = _build_client(url)
        await _pubsub_client.ping()
        logger.info("Publisher reconnected successfully")
        return _pubsub_client
    except Exception as e:
        logger.error(f"Publisher reconnect failed: {e}")
        _pubsub_client = None
        return None


async def publish_to_channel(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON payload to an arbitrary channel."""
    await publish_bytes(channel, dumps_bytes(payload))


async def publish_bytes(channel: str, payload: bytes) -> None:
    """Publish bytes to an arbitrary channel."""
    publisher = await _ensure_publisher()
    if publisher is None:
        logger.warning("publisher not available, skipping publish")
        return

    try:
        await publisher.publish(channel, payload)
        logger.debug(f"published to {channel}")
    except Exception:
        logger.warning(f"Failed to publish to channel {channel}")


async def publish_many(messages: list[tuple[str, bytes]]) -> None:
    """Publish distinct byte payloads in one pipeline."""
    if not messages:
        return
    publisher = await _ensure_publisher()
    if publisher is None:
        logger.warning("publisher not available, skipping publish batch")
        return
    try:
        async with publisher.pipeline(transaction=False) as pipe:
            for channel, payload in messages:
                pipe.publish(channel, payload)
            await pipe.execute()
    except Exception:
        logger.warning(f"Failed to publish batch to {len(messages)} channels")


async def subscribe_channels(*channels: str) -> AsyncGenerator[dict[str, Any] | None]:
    """Subscribe to multiple channels; yields payloads, or ``None`` on each poll tick."""
    PUBSUB_ACTIVE_SUBSCRIBERS.inc()

    url = ValkeyConfig.from_env().to_url()
    subscriber = _build_client(url)
    channel_label = ",".join(channels)
    pubsub = subscriber.pubsub()

    try:
        await pubsub.subscribe(*channels)
        logger.info(f"subscribed to {channel_label}")

        while True:
            if _shutdown_event is not None and _shutdown_event.is_set():
                logger.info(f"shutdown, closing {channel_label}")
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=1.0,
            )
            if message is not None and message["type"] == "message":  # noqa: PLR2004
                try:
                    data = loads(message["data"])
                    yield data
                except JSONDecodeError, TypeError:
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
        except TimeoutError, BaseException:
            logger.warning(f"cleanup timed out for {channel_label}")
        logger.info(f"unsubscribed from {channel_label}")


async def subscribe_patterns(
    *patterns: str,
) -> AsyncGenerator[tuple[str, dict[str, Any]] | None]:
    """``PSUBSCRIBE`` yielding ``(channel, payload)`` or ``None`` on each poll tick.

    One subscriber connection covers any number of matched channels - the
    realtime router relies on this to keep the connection count flat.
    """
    PUBSUB_ACTIVE_SUBSCRIBERS.inc()

    url = ValkeyConfig.from_env().to_url()
    subscriber = _build_client(url)
    pattern_label = ",".join(patterns)
    pubsub = subscriber.pubsub()

    try:
        await pubsub.psubscribe(*patterns)
        logger.info(f"psubscribed to {pattern_label}")

        while True:
            if _shutdown_event is not None and _shutdown_event.is_set():
                logger.info(
                    f"shutdown, closing psubscribe {pattern_label}",
                )
                break

            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=1.0,
            )
            if message is not None and message["type"] == "pmessage":  # noqa: PLR2004
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode("utf-8", errors="replace")
                try:
                    data = loads(message["data"])
                    yield channel, data
                except JSONDecodeError, TypeError:
                    logger.warning(f"Invalid pmessage on {channel}")
            else:
                yield None
    finally:
        PUBSUB_ACTIVE_SUBSCRIBERS.dec()
        try:
            await asyncio.wait_for(
                _close_psubscriber(pubsub, subscriber, patterns),
                timeout=_CLEANUP_TIMEOUT,
            )
        except TimeoutError, BaseException:
            logger.warning(
                f"cleanup timed out for psubscribe {pattern_label}",
            )
        logger.info(f"punsubscribed from {pattern_label}")


async def _close_psubscriber(
    pubsub: aioredis.client.PubSub,
    subscriber: aioredis.Redis,
    patterns: tuple[str, ...],
) -> None:
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
    for ch in channels:
        with contextlib.suppress(BaseException):
            await pubsub.unsubscribe(ch)
    with contextlib.suppress(BaseException):
        await pubsub.aclose()
    with contextlib.suppress(BaseException):
        await subscriber.aclose()
