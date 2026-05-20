"""Shared Valkey connection configuration.

Four connection tiers, each tuned for its access pattern:

- **ARQ queue** -- ``to_arq_redis_settings()``. Long-lived job dequeue
  pool. 10s socket timeout, 5 retries. ARQ owns its own pool.
- **Pub/Sub publisher + subscribers** -- ``to_pubsub_kwargs()``. 5s
  socket timeout, retry on transient errors, 30s health check. Pubsub
  connections enter a special mode and cannot be used for regular
  commands.
- **Ops client** -- ``to_ops_kwargs()``. Fail-fast profile for cache,
  presence, rate-limit and mention-state. 200ms connect, 100ms read,
  zero retries, no health checks. Sub-millisecond on a healthy node;
  hard-fails fast when Valkey is slow / down so callers fall through
  to PG inside the per-call deadline guard (see ``valkey.ops``).
- **Streams client** -- ``to_streams_kwargs()``. Blocking XREAD on
  ``agent:run:{run_id}`` streams. The socket timeout must exceed the
  longest block the caller passes; 30s gives ample headroom over the
  5s block currently used by the runtime subscribe loop. No retries
  -- caller treats an empty round as "no events this tick" and loops.

The host/port/password/database fields are the only env-driven values.
Per-tier timeouts are constants here -- a single dial, set centrally.
"""

import os
from dataclasses import dataclass
from typing import Any

from arq.connections import RedisSettings
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

_PUBSUB_SOCKET_CONNECT_TIMEOUT = 5
_PUBSUB_SOCKET_TIMEOUT = 5
_PUBSUB_HEALTH_CHECK_INTERVAL = 30
_PUBSUB_RETRY_ERRORS = (
    RedisConnectionError,
    RedisTimeoutError,
    OSError,
    ConnectionResetError,
)

_OPS_SOCKET_CONNECT_TIMEOUT = 0.2
_OPS_SOCKET_TIMEOUT = 0.1
_OPS_MAX_CONNECTIONS = int(os.getenv("VALKEY_OPS_MAX_CONNECTIONS", "10"))

_STREAMS_SOCKET_CONNECT_TIMEOUT = 2.0
_STREAMS_SOCKET_TIMEOUT = 30.0
_STREAMS_HEALTH_CHECK_INTERVAL = 30
# Each concurrent agent-run subscriber pins one streams connection for
# up to SUBSCRIBE_BLOCK_MS. Size for the expected concurrent active runs
# per pod; the 21st caller otherwise waits up to STREAMS_SOCKET_TIMEOUT
# on pool acquisition.
_STREAMS_MAX_CONNECTIONS = int(os.getenv("VALKEY_STREAMS_MAX_CONNECTIONS", "50"))

_ARQ_CONN_TIMEOUT = 10
_ARQ_CONN_RETRIES = 5
_ARQ_CONN_RETRY_DELAY = 1.0


@dataclass
class ValkeyConfig:
    """Valkey connection configuration.

    Attributes
    ----------
    host : str
        Valkey server hostname.
    port : int
        Valkey server port.
    password : str
        Authentication password.
    database : int
        Database number (default: 0).

    """

    host: str
    port: int
    password: str
    database: int = 0

    @classmethod
    def from_env(cls) -> ValkeyConfig:
        """Create config from environment variables.

        Environment Variables
        ---------------------
        VALKEY_HOST : str
            Valkey server hostname (default: localhost)
        VALKEY_PORT : int
            Valkey server port (default: 6380)
        VALKEY_PASSWORD : str
            Valkey password (default: uniffy-valkey-dev)
        VALKEY_DATABASE : int
            Database number (default: 0)

        """
        return cls(
            host=os.getenv("VALKEY_HOST", "localhost"),
            port=int(os.getenv("VALKEY_PORT", "6380")),
            password=os.getenv("VALKEY_PASSWORD", "uniffy-valkey-dev"),
            database=int(os.getenv("VALKEY_DATABASE", "0")),
        )

    def to_url(self) -> str:
        """Build a redis:// URL for use with the redis-py async client."""
        return f"redis://:{self.password}@{self.host}:{self.port}/{self.database}"

    def to_arq_redis_settings(self) -> RedisSettings:
        """ARQ-compatible Redis settings for the worker queue pool."""
        return RedisSettings(
            host=self.host,
            port=self.port,
            password=self.password,
            database=self.database,
            conn_timeout=_ARQ_CONN_TIMEOUT,
            conn_retries=_ARQ_CONN_RETRIES,
            conn_retry_delay=_ARQ_CONN_RETRY_DELAY,
        )

    def to_pubsub_kwargs(self) -> dict[str, Any]:
        """Kwargs for ``aioredis.from_url`` on the pubsub publisher / subscribers."""
        return {
            "decode_responses": True,
            "socket_connect_timeout": _PUBSUB_SOCKET_CONNECT_TIMEOUT,
            "socket_timeout": _PUBSUB_SOCKET_TIMEOUT,
            "socket_keepalive": True,
            "socket_keepalive_options": {},
            "retry_on_error": list(_PUBSUB_RETRY_ERRORS),
            "retry_on_timeout": True,
            "health_check_interval": _PUBSUB_HEALTH_CHECK_INTERVAL,
        }

    def to_ops_kwargs(self) -> dict[str, Any]:
        """Kwargs for ``aioredis.from_url`` on the fail-fast ops client.

        Tuned so a single cache call costs at most ~100ms when Valkey is
        slow / unreachable. Combined with the 150ms ``ops_call`` deadline
        guard in ``valkey.ops``, the worst-case wall time on a Valkey
        outage is bounded; callers fall through to PG immediately.
        """
        return {
            "decode_responses": True,
            "socket_connect_timeout": _OPS_SOCKET_CONNECT_TIMEOUT,
            "socket_timeout": _OPS_SOCKET_TIMEOUT,
            "retry_on_error": [],
            "retry_on_timeout": False,
            "health_check_interval": 0,
            "max_connections": _OPS_MAX_CONNECTIONS,
        }

    def to_streams_kwargs(self) -> dict[str, Any]:
        """Kwargs for ``aioredis.from_url`` on the streams client.

        XREAD with ``block`` waits inside Valkey for new entries. The
        socket timeout must exceed the longest block the caller passes
        (today the subscribe loop caps at 5s); 30s gives 6x headroom and
        leaves room to raise the block budget without re-tuning here.
        Health checks keep long-lived connections from being killed by
        idle middleboxes during quiet runs. No retries -- the caller
        treats an empty XREAD result as "no events this round" and
        loops on its own wall budget.
        """
        return {
            "decode_responses": True,
            "socket_connect_timeout": _STREAMS_SOCKET_CONNECT_TIMEOUT,
            "socket_timeout": _STREAMS_SOCKET_TIMEOUT,
            "retry_on_error": [],
            "retry_on_timeout": False,
            "health_check_interval": _STREAMS_HEALTH_CHECK_INTERVAL,
            "max_connections": _STREAMS_MAX_CONNECTIONS,
        }
