"""Binary-safe Valkey client whose pooled connections serve only the verified server instance."""

import asyncio
import contextlib
from collections.abc import Mapping
from dataclasses import dataclass

import valkey.asyncio as aioredis
from loguru import logger
from valkey.asyncio.connection import AbstractConnection, Connection
from valkey.exceptions import ConnectionError as ValkeyConnectionError

from uniffy.infrastructure.valkey.config import ValkeyConfig

logger = logger.bind(component="infrastructure.valkey.binary")

_INIT_PING_TIMEOUT_SECONDS = 1.0
_CLOSE_TIMEOUT_SECONDS = 1.0


@dataclass(frozen=True, slots=True)
class ValkeyIdentity:
    """Serving instance. ``run_id`` changes on every restart, even when persistence kept the keys."""

    run_id: str
    version: str


class ValkeyIdentityChanged(ValkeyConnectionError):
    """A new physical connection reached an instance other than the verified one."""


_binary_client: aioredis.Redis | None = None
_identity: ValkeyIdentity | None = None


def identity_from_info(info: Mapping[str, object]) -> ValkeyIdentity:
    run_id = str(info.get("run_id") or "")
    if not run_id:
        raise ValkeyConnectionError("Valkey INFO server reported no run_id")
    version = info.get("valkey_version") or info.get("redis_version") or ""
    return ValkeyIdentity(run_id=run_id, version=str(version))


async def _read_identity(connection: AbstractConnection) -> ValkeyIdentity:
    await connection.send_command("INFO", "server")
    raw: bytes = await connection.read_response()
    fields: dict[str, str] = {}
    for line in raw.decode().splitlines():
        key, _, value = line.partition(":")
        fields[key] = value
    return identity_from_info(fields)


class _VerifiedConnection(Connection):
    async def on_connect(self) -> None:
        await super().on_connect()
        identity = await _read_identity(self)
        if identity != _identity:
            raise ValkeyIdentityChanged(
                f"Valkey instance changed to run_id {identity.run_id}; call verify_server_identity()"
            )


async def _probe_identity(client: aioredis.Redis) -> ValkeyIdentity:
    connection = Connection(**client.connection_pool.connection_kwargs)
    try:
        await connection.connect()
        return await _read_identity(connection)
    finally:
        await connection.disconnect()


async def init_binary_client() -> None:
    """Initialise the process-wide binary client. Idempotent; records the serving instance first."""
    global _binary_client, _identity

    if _binary_client is not None:
        try:
            async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
                await _binary_client.ping()
            return
        except Exception:
            await close_binary_client()

    config = ValkeyConfig.from_env()
    client = aioredis.from_url(
        config.to_url(),
        **config.to_binary_kwargs(),
        connection_class=_VerifiedConnection,
    )
    try:
        async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
            _identity = await _probe_identity(client)
            await client.ping()
    except Exception:
        _identity = None
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
        raise

    _binary_client = client
    logger.info(
        "Binary client initialised (valkey={version}, run_id={run_id})",
        version=_identity.version,
        run_id=_identity.run_id,
    )


async def close_binary_client() -> None:
    """Close the binary client with a hard 1s timeout."""
    global _binary_client, _identity

    if _binary_client is None:
        return

    client = _binary_client
    _binary_client = None
    _identity = None
    try:
        await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
    except TimeoutError, BaseException:
        logger.warning("Binary client close timed out")
    logger.info("Binary client closed")


def get_binary_client() -> aioredis.Redis | None:
    return _binary_client


def server_identity() -> ValkeyIdentity | None:
    return _identity


async def verify_server_identity() -> ValkeyIdentity:
    """Adopt the serving instance after ``ValkeyIdentityChanged`` and drop pooled connections.

    State bound to the previous identity must be reconciled before the next write.
    """
    global _identity

    client = _binary_client
    if client is None:
        raise ValkeyConnectionError("Valkey binary client is not initialised")
    identity = await _probe_identity(client)
    if identity != _identity:
        previous = _identity
        _identity = identity
        await client.connection_pool.disconnect()
        logger.warning(
            "Valkey instance changed (run_id {previous} -> {current})",
            previous=previous.run_id if previous else None,
            current=identity.run_id,
        )
    return identity
