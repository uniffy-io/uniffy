"""Valkey package: three connection tiers, one config.

The package is organised around three physical clients per process,
each tuned for its access pattern:

1. **Pubsub** (``valkey.pubsub``) -- long-lived publisher and per-call
   subscriber connections. PUBLISH / SUBSCRIBE / PSUBSCRIBE only.
   Tolerates retries (long-lived; reconnect is normal).
2. **Ops** (``valkey.ops``) -- fail-fast regular-command client used
   by cache, presence, rate-limit, and mention-state. Zero retries,
   ~100ms socket timeouts, 150ms per-call deadline guard. A slow
   Valkey is treated as a miss / no-op so callers fall through to PG.
3. **Queue** (``valkey.queue``) -- ARQ pool for background job
   enqueue / dequeue. Owns its own connection.

Domain-shaped helpers (``presence_*``, ``publish_mention_state``,
``check_rate_limit``) sit on top of the ops client and inherit its
fail-fast semantics.
"""

from uniffy.core.valkey.cache import (
    CACHE_MISS,
    cache_delete,
    cache_get,
    cache_get_many,
    cache_get_or_set,
    cache_get_or_set_locked,
    cache_invalidate_by_tag,
    cache_invalidate_many,
    cache_set,
)
from uniffy.core.valkey.config import ValkeyConfig
from uniffy.core.valkey.mentions import publish_mention_state
from uniffy.core.valkey.ops import (
    CACHE_OP_TIMEOUT_SECONDS,
    close_ops_client,
    init_ops_client,
    ops_call,
)
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
from uniffy.core.valkey.queue import (
    close_queue,
    get_queue,
    get_queue_safe,
    init_queue,
)
from uniffy.core.valkey.rate_limit import check_agent_rate_limits, check_rate_limit

__all__ = [
    "CACHE_MISS",
    "CACHE_OP_TIMEOUT_SECONDS",
    "ValkeyConfig",
    "cache_delete",
    "cache_get",
    "cache_get_many",
    "cache_get_or_set",
    "cache_get_or_set_locked",
    "cache_invalidate_by_tag",
    "cache_invalidate_many",
    "cache_set",
    "check_agent_rate_limits",
    "check_rate_limit",
    "close_ops_client",
    "close_pubsub",
    "close_queue",
    "get_queue",
    "get_queue_safe",
    "init_ops_client",
    "init_pubsub",
    "init_queue",
    "ops_call",
    "presence_get_bulk",
    "presence_publish_change",
    "presence_set",
    "publish_mention_state",
    "publish_notification",
    "signal_pubsub_shutdown",
    "subscribe_channels",
    "subscribe_user",
]
