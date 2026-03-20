"""Unified Valkey module for queue, Pub/Sub, cache, and rate limiting."""

from uniffy.core.valkey.cache import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_set,
)
from uniffy.core.valkey.config import ValkeyConfig
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.core.valkey.presence import (
    presence_get_bulk,
    presence_publish_change,
    presence_set,
)
from uniffy.core.valkey.pubsub import (
    close_pubsub,
    init_pubsub,
    publish_notification,
    signal_pubsub_shutdown,
    subscribe_channels,
    subscribe_user,
)
from uniffy.core.valkey.queue import close_queue, get_queue, init_queue
from uniffy.core.valkey.rate_limit import check_agent_rate_limits, check_rate_limit

__all__ = [
    "CACHE_MISS",
    "ValkeyConfig",
    "cache_delete",
    "cache_get",
    "cache_set",
    "check_agent_rate_limits",
    "check_rate_limit",
    "close_pubsub",
    "close_queue",
    "get_queue",
    "init_pubsub",
    "init_queue",
    "presence_get_bulk",
    "presence_publish_change",
    "presence_set",
    "publish_mention_state",
    "publish_notification",
    "signal_pubsub_shutdown",
    "subscribe_channels",
    "subscribe_user",
]
