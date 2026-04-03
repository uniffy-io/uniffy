"""Shared Valkey connection configuration.

Centralizes environment-variable reading for all Valkey consumers
(ARQ queue, Pub/Sub publisher, Pub/Sub subscribers).
"""

import os
from dataclasses import dataclass

from arq.connections import RedisSettings


@dataclass
class ValkeyConfig:
    """
    Valkey connection configuration.

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
    conn_timeout : int
        Connection timeout in seconds (default: 10).
    conn_retries : int
        Number of connection retry attempts (default: 5).
    conn_retry_delay : float
        Delay between retries in seconds (default: 1.0).
    socket_keepalive : bool
        Enable TCP keepalive on connections (default: True).

    """

    host: str
    port: int
    password: str
    database: int = 0
    conn_timeout: int = 10
    conn_retries: int = 5
    conn_retry_delay: float = 1.0
    socket_keepalive: bool = True

    @classmethod
    def from_env(cls) -> ValkeyConfig:
        """
        Create config from environment variables.

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
        VALKEY_CONN_TIMEOUT : int
            Connection timeout in seconds (default: 10)
        VALKEY_CONN_RETRIES : int
            Number of connection retry attempts (default: 5)
        VALKEY_CONN_RETRY_DELAY : float
            Delay between retries in seconds (default: 1.0)

        """
        return cls(
            host=os.getenv("VALKEY_HOST", "localhost"),
            port=int(os.getenv("VALKEY_PORT", "6380")),
            password=os.getenv("VALKEY_PASSWORD", "uniffy-valkey-dev"),
            database=int(os.getenv("VALKEY_DATABASE", "0")),
            conn_timeout=int(os.getenv("VALKEY_CONN_TIMEOUT", "10")),
            conn_retries=int(os.getenv("VALKEY_CONN_RETRIES", "5")),
            conn_retry_delay=float(os.getenv("VALKEY_CONN_RETRY_DELAY", "1.0")),
        )

    def to_redis_settings(self) -> RedisSettings:
        """
        Convert to ARQ RedisSettings.

        Returns
        -------
        RedisSettings
            ARQ-compatible Redis connection settings with retry and timeout
            configuration for network resilience.

        """
        return RedisSettings(
            host=self.host,
            port=self.port,
            password=self.password,
            database=self.database,
            conn_timeout=self.conn_timeout,
            conn_retries=self.conn_retries,
            conn_retry_delay=self.conn_retry_delay,
        )

    def to_url(self) -> str:
        """
        Build a redis:// URL for use with redis-py async client.

        Returns
        -------
        str
            Connection URL in the form ``redis://:password@host:port/db``.

        """
        return f"redis://:{self.password}@{self.host}:{self.port}/{self.database}"
