"""Generic Valkey stream and state-hash operations."""

import asyncio
import contextlib
from typing import Any

import valkey.asyncio as aioredis
from loguru import logger
from valkey.exceptions import ConnectionError as ValkeyConnectionError
from valkey.exceptions import TimeoutError as ValkeyTimeoutError

from uniffy.core.json_codec import JSONDecodeError, dumps_bytes, loads
from uniffy.infrastructure.valkey.config import ValkeyConfig
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

logger = logger.bind(component="infrastructure.valkey.streams")

_NAMESPACE = "stream"
_INIT_PING_TIMEOUT_SECONDS = 1.0
_CLOSE_TIMEOUT_SECONDS = 1.0

_streams_client: aioredis.Redis | None = None


async def init_streams_client() -> None:
    global _streams_client

    if _streams_client is not None:
        try:
            async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
                await _streams_client.ping()
            return
        except Exception:
            with contextlib.suppress(BaseException):
                await asyncio.wait_for(_streams_client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
            _streams_client = None

    config = ValkeyConfig.from_env()
    client = aioredis.from_url(config.to_url(), **config.to_streams_kwargs())
    try:
        async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
            await client.ping()
    except Exception:
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
        raise

    _streams_client = client
    logger.info("Streams client initialised")


async def close_streams_client() -> None:
    global _streams_client

    if _streams_client is None:
        return

    client = _streams_client
    _streams_client = None
    try:
        await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
    except TimeoutError, BaseException:
        logger.warning("Streams client close timed out")
    logger.info("Streams client closed")


def _get_streams_client() -> aioredis.Redis | None:
    return _streams_client


async def xadd(stream: str, payload: dict[str, Any], *, maxlen: int) -> str | None:
    client = get_ops_client()
    if client is None:
        return None

    try:
        async with ops_call(_NAMESPACE, "xadd"):
            return await client.xadd(
                stream,
                {"data": dumps_bytes(payload)},
                maxlen=maxlen,
                approximate=True,
            )
    except TimeoutError:
        return None
    except Exception:
        logger.warning(f"Stream XADD failed for {stream}")
        return None


async def xread(
    stream: str,
    *,
    last_id: str = "0",
    count: int = 100,
    block_ms: int = 5000,
) -> list[tuple[str, dict[str, Any]]]:
    client = _get_streams_client()
    if client is None:
        return []

    try:
        result = await client.xread(
            streams={stream: last_id},
            count=count,
            block=block_ms,
        )
    except (ValkeyTimeoutError, ValkeyConnectionError) as exc:
        logger.debug(f"Stream XREAD transient error for {stream}: {exc!r}")
        return []
    except TimeoutError:
        return []
    except Exception as exc:
        logger.warning(f"Stream XREAD failed for {stream}: {exc!r}")
        return []

    entries: list[tuple[str, dict[str, Any]]] = []
    for _stream_name, messages in result or []:
        for message_id, fields in messages:
            raw = fields.get("data")
            if raw is None:
                continue
            try:
                entries.append((message_id, loads(raw)))
            except JSONDecodeError, TypeError:
                logger.warning(f"Stream payload decode failed (stream={stream}, id={message_id})")
    return entries


async def set_state(key: str, state: dict[str, Any], *, ttl: int) -> None:
    client = get_ops_client()
    if client is None:
        return

    try:
        async with ops_call(_NAMESPACE, "set_state"):
            pipe = client.pipeline(transaction=False)
            pipe.hset(key, mapping={name: dumps_bytes(value) for name, value in state.items()})
            pipe.expire(key, ttl)
            await pipe.execute()
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Stream state write failed for {key}")


async def get_state(key: str) -> dict[str, Any] | None:
    client = get_ops_client()
    if client is None:
        return None

    try:
        async with ops_call(_NAMESPACE, "get_state"):
            raw = await client.hgetall(key)
    except TimeoutError:
        return None
    except Exception:
        logger.warning(f"Stream state read failed for {key}")
        return None

    if not raw:
        return None

    decoded: dict[str, Any] = {}
    for name, value in raw.items():
        try:
            decoded[name] = loads(value)
        except JSONDecodeError, TypeError:
            decoded[name] = value
    return decoded


async def delete(*keys: str) -> None:
    client = get_ops_client()
    if client is None or not keys:
        return

    try:
        async with ops_call(_NAMESPACE, "delete"):
            await client.delete(*keys)
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Stream delete failed for {len(keys)} keys")
