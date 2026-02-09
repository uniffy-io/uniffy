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

    """

    host: str
    port: int
    password: str
    database: int = 0

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

        """
        return cls(
            host=os.getenv("VALKEY_HOST", "localhost"),
            port=int(os.getenv("VALKEY_PORT", "6380")),
            password=os.getenv("VALKEY_PASSWORD", "uniffy-valkey-dev"),
            database=int(os.getenv("VALKEY_DATABASE", "0")),
        )

    def to_redis_settings(self) -> RedisSettings:
        """
        Convert to ARQ RedisSettings.

        Returns
        -------
        RedisSettings
            ARQ-compatible Redis connection settings.

        """
        return RedisSettings(
            host=self.host,
            port=self.port,
            password=self.password,
            database=self.database,
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
