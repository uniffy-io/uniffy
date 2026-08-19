"""Valkey Pub/Sub publisher + subscriber helpers.

Pub/sub connections enter a special Redis mode and cannot run regular commands,
so the publisher and subscriber connections are separate from the ops client.
Publisher reconnects on transient failures.
"""

import asyncio
import contextlib
from collections.abc import AsyncGenerator
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

import valkey.asyncio as aioredis
from loguru import logger

from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.core.valkey.config import ValkeyConfig
from uniffy.observability.metrics import PUBSUB_ACTIVE_SUBSCRIBERS

_CLEANUP_TIMEOUT = 3.0

_pubsub_client: aioredis.Redis | None = None

# Set during lifespan shutdown so subscriber generators break on the next 1s poll
# tick instead of waiting for granian's full graceful_timeout.
_shutdown_event: asyncio.Event | None = None

LOGGER_COMPONENT = "pubsub"


class NotificationPayloadType(StrEnum):
    FILE_UPDATED = "file_updated"
    PRESENCE_CHANGED = "presence_changed"
    PERMISSIONS_CHANGED = "permissions_changed"
    CONTENT_ACCESS_CHANGED = "content_access_changed"
    MENTION_STATE_CHANGED = "mention_state_changed"
    ACCESS_REQUEST_CHANGED = "access_request_changed"


class ContentAccessAction(StrEnum):
    GRANTED = "granted"
    REVOKED = "revoked"
    ACCESS_MODE_CHANGED = "access_mode_changed"
    CHILD_ADDED = "child_added"


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
        logger.info("Pub/Sub publisher closed", component=LOGGER_COMPONENT)


def signal_pubsub_shutdown() -> None:
    """Signal subscriber generators to stop on the next poll tick."""
    if _shutdown_event is not None:
        _shutdown_event.set()
        logger.info(
            "Pub/Sub shutdown signalled",
            component=LOGGER_COMPONENT,
        )


def _channel_name(user_id: UUID) -> str:
    return f"notifications:{user_id}"


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
    """Publish a notification on ``notifications:{user_id}``."""
    await publish_to_channel(_channel_name(user_id), payload)


async def publish_to_channel(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON payload to an arbitrary channel."""
    publisher = await _ensure_publisher()
    if publisher is None:
        logger.warning("publisher not available, skipping publish")
        return

    try:
        await publisher.publish(channel, dumps_bytes(payload))
        logger.debug(f"published to {channel}", component=LOGGER_COMPONENT)
    except Exception:
        logger.warning(f"Failed to publish to channel {channel}", component=LOGGER_COMPONENT)


def _content_channel_name(organization_id: UUID) -> str:
    return f"content:{organization_id}"


async def publish_content_access_changed(
    *,
    content_type: int,
    content_id: UUID,
    action: ContentAccessAction,
    organization_id: UUID,
    target_user_ids: list[UUID] | None = None,
) -> None:
    """Signal that a user's accessible-content set changed so their sidebar/tree refetches.

    ``content_type`` is the ``common.v1.ContentType`` proto enum value (callers map
    their domain enum via ``content_type_to_proto``). Per-user on ``notifications:{uid}``
    when ``target_user_ids`` is given (explicit share/revoke); org-wide on
    ``content:{org}`` otherwise (OPEN_TO_ORG transitions).
    """
    payload = {
        "_type": NotificationPayloadType.CONTENT_ACCESS_CHANGED,
        "content_type": content_type,
        "content_id": str(content_id),
        "action": action,
    }
    if target_user_ids is None:
        await publish_to_channel(_content_channel_name(organization_id), payload)
        return
    for user_id in target_user_ids:
        await publish_to_channel(_channel_name(user_id), payload)


async def publish_access_request_changed(
    *,
    user_id: UUID,
    request_id: UUID,
    requested_urn: str,
    state: int,
    can_request_again_at: datetime | None = None,
) -> None:
    payload = {
        "_type": NotificationPayloadType.ACCESS_REQUEST_CHANGED,
        "request_id": str(request_id),
        "requested_urn": requested_urn,
        "state": state,
    }
    if can_request_again_at is not None:
        payload["can_request_again_at"] = can_request_again_at.isoformat()
    await publish_to_channel(_channel_name(user_id), payload)


async def subscribe_user(user_id: UUID) -> AsyncGenerator[dict[str, Any] | None]:
    """Subscribe to ``notifications:{user_id}``; yields payloads, or
    ``None`` on each 1s poll tick.
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
            if message is not None and message["type"] == "message":  # noqa: PLR2004
                try:
                    data = loads(message["data"])
                    yield data
                except JSONDecodeError, TypeError:
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
        except TimeoutError, BaseException:
            logger.warning(f"cleanup timed out for {channel}", component=LOGGER_COMPONENT)
        logger.info(f"unsubscribed from {channel} ", component=LOGGER_COMPONENT)


async def subscribe_channels(*channels: str) -> AsyncGenerator[dict[str, Any] | None]:
    """Subscribe to multiple channels; yields payloads, or ``None`` on each poll tick."""
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
            logger.warning(f"cleanup timed out for {channel_label}", component=LOGGER_COMPONENT)
        logger.info(f"unsubscribed from {channel_label}", component=LOGGER_COMPONENT)


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
            if message is not None and message["type"] == "pmessage":  # noqa: PLR2004
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode("utf-8", errors="replace")
                try:
                    data = loads(message["data"])
                    yield channel, data
                except JSONDecodeError, TypeError:
                    logger.warning(f"Invalid pmessage on {channel}", component=LOGGER_COMPONENT)
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
                component=LOGGER_COMPONENT,
            )
        logger.info(f"punsubscribed from {pattern_label}", component=LOGGER_COMPONENT)


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


async def _close_subscriber(
    pubsub: aioredis.client.PubSub,
    subscriber: aioredis.Redis,
    channel: str,
) -> None:
    with contextlib.suppress(BaseException):
        await pubsub.unsubscribe(channel)
    with contextlib.suppress(BaseException):
        await pubsub.aclose()
    with contextlib.suppress(BaseException):
        await subscriber.aclose()
