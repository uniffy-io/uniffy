"""Per-tier Valkey connection profiles. Host/port/password/database come
from env; timeouts are constants.
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
# Each concurrent agent-run subscriber pins one connection for up to SUBSCRIBE_BLOCK_MS;
# sizes the pool to the expected concurrent active runs per pod.
_STREAMS_MAX_CONNECTIONS = int(os.getenv("VALKEY_STREAMS_MAX_CONNECTIONS", "50"))

_ARQ_CONN_TIMEOUT = 10
_ARQ_CONN_RETRIES = 5
_ARQ_CONN_RETRY_DELAY = 1.0


@dataclass
class ValkeyConfig:
    """Valkey connection configuration."""

    host: str
    port: int
    password: str
    database: int = 0

    @classmethod
    def from_env(cls) -> ValkeyConfig:
        """Read ``VALKEY_HOST`` / ``_PORT`` / ``_PASSWORD`` / ``_DATABASE``."""
        return cls(
            host=os.getenv("VALKEY_HOST", "localhost"),
            port=int(os.getenv("VALKEY_PORT", "6380")),
            password=os.getenv("VALKEY_PASSWORD", "uniffy-valkey-dev"),
            database=int(os.getenv("VALKEY_DATABASE", "0")),
        )

    def to_url(self) -> str:
        return f"redis://:{self.password}@{self.host}:{self.port}/{self.database}"

    def to_arq_redis_settings(self) -> RedisSettings:
        """ARQ ``RedisSettings`` for the worker queue pool."""
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
        """``aioredis.from_url`` kwargs for the pubsub publisher / subscribers."""
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
        """``aioredis.from_url`` kwargs for the fail-fast ops client.

        Combined with the 150ms ``ops_call`` deadline guard, the worst-case wall
        time on a Valkey outage is bounded; callers fall through to PG.
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
        """``aioredis.from_url`` kwargs for the streams client.

        The socket timeout must exceed the longest XREAD ``block`` the caller
        passes. No retries - an empty result is "no events this round".
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
