"""
Valkey (Redis-compatible) client for background job queue.

Uses ARQ for async job processing with Valkey as the broker.
Valkey is a Redis-compatible, high-performance key-value store.
"""

import os
from dataclasses import dataclass

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from loguru import logger


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


# Global queue pool instance (initialized on app startup)
_queue_pool: ArqRedis | None = None


async def init_queue() -> ArqRedis:
    """
    Initialize the global queue pool.

    Should be called during application startup. Creates an ARQ
    connection pool to Valkey for enqueuing background jobs.

    Returns
    -------
    ArqRedis
        Initialized ARQ Redis connection pool.

    """
    global _queue_pool

    config = ValkeyConfig.from_env()
    _queue_pool = await create_pool(config.to_redis_settings())

    logger.info(f"Queue pool initialized: {config.host}:{config.port}")
    return _queue_pool


async def close_queue() -> None:
    """
    Close the global queue pool.

    Should be called during application shutdown. Gracefully
    closes all connections in the pool.

    """
    global _queue_pool

    if _queue_pool:
        await _queue_pool.close(close_connection_pool=True)
        _queue_pool = None
        logger.info("Queue pool closed")


def get_queue() -> ArqRedis:
    """
    Get the global queue pool.

    Returns
    -------
    ArqRedis
        The initialized queue pool for enqueuing jobs.

    Raises
    ------
    RuntimeError
        If pool not initialized. Call init_queue() first.

    """
    if _queue_pool is None:
        raise RuntimeError("Queue pool not initialized. Call init_queue() first.")
    return _queue_pool
