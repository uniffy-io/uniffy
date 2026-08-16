"""Four physical Valkey clients per process, one config.

- **Pubsub** (``valkey.pubsub``) - long-lived PUBLISH/SUBSCRIBE.
- **Ops** (``valkey.ops``) - fail-fast regular commands; zero retries, 150ms
  per-call deadline. A slow Valkey returns miss/no-op and callers fall through
  to PG.
- **Streams** (``valkey.streams``) - blocking XREAD on agent-run streams; 30s
  socket timeout.
- **Queue** (``valkey.queue``) - ARQ pool for background work.
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
    NotificationPayloadType,
    close_pubsub,
    init_pubsub,
    publish_access_request_changed,
    publish_content_access_changed,
    publish_notification,
    signal_pubsub_shutdown,
    subscribe_channels,
    subscribe_user,
)
from uniffy.core.valkey.queue import (
    QueueName,
    close_queue,
    get_queue,
    get_queue_safe,
    init_queue,
)
from uniffy.core.valkey.rate_limit import check_agent_rate_limits, check_rate_limit
from uniffy.core.valkey.streams import (
    RUN_STATE_TTL_SECONDS,
    RUN_STREAM_DEFAULT_MAXLEN,
    close_streams_client,
    get_run_state,
    init_streams_client,
    run_state_key,
    run_stream_key,
    set_run_state,
    stream_delete,
    stream_get_state,
    stream_set_state,
    stream_xadd,
    stream_xread,
)

__all__ = [
    "CACHE_MISS",
    "CACHE_OP_TIMEOUT_SECONDS",
    "RUN_STATE_TTL_SECONDS",
    "RUN_STREAM_DEFAULT_MAXLEN",
    "QueueName",
    "NotificationPayloadType",
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
    "close_streams_client",
    "get_queue",
    "get_queue_safe",
    "get_run_state",
    "init_ops_client",
    "init_pubsub",
    "init_queue",
    "init_streams_client",
    "ops_call",
    "presence_get_bulk",
    "presence_publish_change",
    "presence_set",
    "publish_content_access_changed",
    "publish_access_request_changed",
    "publish_mention_state",
    "publish_notification",
    "run_state_key",
    "run_stream_key",
    "set_run_state",
    "signal_pubsub_shutdown",
    "stream_delete",
    "stream_get_state",
    "stream_set_state",
    "stream_xadd",
    "stream_xread",
    "subscribe_channels",
    "subscribe_user",
]
