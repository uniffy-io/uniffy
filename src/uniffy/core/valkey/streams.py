"""Valkey Streams helpers split across two client tiers.

Streams replace pubsub for runtime events: a single conceptual
subscriber per ``run_id`` that needs replay (so a client tab reload
mid-stream picks up where it left off). Pubsub stays the right tool
for chat fan-out (multi-subscriber, no replay needed).

Two client tiers carry the work:

- **Ops client** (fail-fast, 100ms read, 150ms ``ops_call`` guard) --
  used by the non-blocking writes and reads: ``stream_xadd``,
  ``stream_set_state``, ``stream_get_state``, ``stream_delete``.
  These are sub-millisecond on a healthy node; a slow Valkey returns
  the conservative outcome (``None`` on read, silent no-op on write).
- **Streams client** (long socket timeout, retry-free) -- used by
  ``stream_xread``. XREAD with ``block`` waits inside Valkey for new
  entries; the ops client's 100ms socket timeout would abort the
  block on every call. The streams tier owns its own connection pool
  with a 30s socket timeout so the block actually blocks. The 150ms
  ``ops_call`` guard is intentionally NOT applied to XREAD -- a long
  block is the point.

Run-scoped key layout:

- ``agent:run:{run_id}`` -- the events stream (XADD with ``MAXLEN
  ~200`` so a runaway publisher cannot blow the box).
- ``agent:run:{run_id}:state`` -- a hash with run metadata: who can
  subscribe, current status, last sequence, started/expires
  timestamps. TTL ``RUN_STATE_TTL_SECONDS`` (300s); refreshed on
  every publish so an active run never expires under us.
"""

import asyncio
import contextlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis
from loguru import logger
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from uniffy.core.valkey.config import ValkeyConfig
from uniffy.core.valkey.ops import _get_ops_client, ops_call

STREAMS_NAMESPACE = "stream"
RUN_STREAM_DEFAULT_MAXLEN = 200
RUN_STATE_TTL_SECONDS = 300

LOGGER_COMPONENT = "valkey.streams"
_INIT_PING_TIMEOUT_SECONDS = 1.0
_CLOSE_TIMEOUT_SECONDS = 1.0

RunStatus = str

_streams_client: aioredis.Redis | None = None


async def init_streams_client() -> None:
    """Initialise the process-wide streams client.

    Idempotent: if a healthy client already exists, the call is a
    no-op. A bound PING verifies the connection so a misconfigured
    host fails fast at startup rather than on the first XREAD.
    """
    global _streams_client

    if _streams_client is not None:
        try:
            async with asyncio.timeout(_INIT_PING_TIMEOUT_SECONDS):
                await _streams_client.ping()
            return
        except Exception:
            with contextlib.suppress(BaseException):
                await asyncio.wait_for(
                    _streams_client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS
                )
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
    logger.info("Streams client initialised", component=LOGGER_COMPONENT)


async def close_streams_client() -> None:
    """Close the streams client with a hard 1s timeout."""
    global _streams_client

    if _streams_client is None:
        return

    client = _streams_client
    _streams_client = None
    try:
        await asyncio.wait_for(client.aclose(), timeout=_CLOSE_TIMEOUT_SECONDS)
    except (TimeoutError, BaseException):
        logger.warning("Streams client close timed out", component=LOGGER_COMPONENT)
    logger.info("Streams client closed", component=LOGGER_COMPONENT)


def _get_streams_client() -> aioredis.Redis | None:
    """Return the shared streams client, or ``None`` if not initialised."""
    return _streams_client


def run_stream_key(run_id: UUID | str) -> str:
    """Return the Valkey key for a run's events stream."""
    return f"agent:run:{run_id}"


def run_state_key(run_id: UUID | str) -> str:
    """Return the Valkey key for a run's state hash."""
    return f"agent:run:{run_id}:state"


async def stream_xadd(
    stream_key: str,
    payload: dict[str, Any],
    maxlen: int = RUN_STREAM_DEFAULT_MAXLEN,
) -> str | None:
    """Append a single event to ``stream_key``.

    The payload is JSON-encoded under the ``"data"`` field so XADD only
    sees a flat ``str -> str`` map (Valkey requirement). Returns the
    Valkey-assigned message id, or ``None`` when the ops client is
    unavailable or the per-call deadline trips (caller treats as
    transient and moves on).
    """
    client = _get_ops_client()
    if client is None:
        return None

    encoded = {"data": json.dumps(payload)}
    try:
        async with ops_call(STREAMS_NAMESPACE, "xadd"):
            return await client.xadd(
                stream_key,
                encoded,
                maxlen=maxlen,
                approximate=True,
            )
    except TimeoutError:
        return None
    except Exception:
        logger.warning(f"Stream XADD failed for {stream_key}", component=LOGGER_COMPONENT)
        return None


async def stream_xread(
    stream_key: str,
    last_id: str = "0",
    count: int = 100,
    block_ms: int = 5000,
) -> list[tuple[str, dict[str, Any]]]:
    """Read events newer than ``last_id`` from ``stream_key``.

    Blocks up to ``block_ms`` waiting for new entries. Returns a list of
    ``(message_id, payload)`` tuples; ``payload`` is the JSON-decoded
    ``"data"`` field. An empty list means "no new events in this round";
    callers loop on the last seen id.

    Runs on the streams-tier client (30s socket timeout) so the inner
    Valkey BLOCK actually blocks. The 150ms ``ops_call`` deadline guard
    is intentionally NOT applied here -- a long block is the point.
    Redis connection / timeout errors are logged at DEBUG and converted
    into an empty round; the caller's wall-budget loop is the real
    stop condition.
    """
    client = _get_streams_client()
    if client is None:
        return []

    try:
        result = await client.xread(
            streams={stream_key: last_id},
            count=count,
            block=block_ms,
        )
    except (RedisTimeoutError, RedisConnectionError) as exc:
        logger.debug(
            f"Stream XREAD transient error for {stream_key}: {exc!r}",
            component=LOGGER_COMPONENT,
        )
        return []
    except TimeoutError:
        return []
    except Exception as exc:
        logger.warning(
            f"Stream XREAD failed for {stream_key}: {exc!r}",
            component=LOGGER_COMPONENT,
        )
        return []

    if not result:
        return []

    entries: list[tuple[str, dict[str, Any]]] = []
    for _stream_name, messages in result:
        for message_id, fields in messages:
            raw = fields.get("data")
            if raw is None:
                continue
            try:
                entries.append((message_id, json.loads(raw)))
            except (json.JSONDecodeError, TypeError):
                logger.warning(
                    f"Stream payload decode failed (stream={stream_key}, id={message_id})",
                    component=LOGGER_COMPONENT,
                )
    return entries


async def stream_set_state(
    state_key: str,
    state: dict[str, Any],
    ttl: int = RUN_STATE_TTL_SECONDS,
) -> None:
    """Write or refresh a run state hash with ``ttl`` seconds.

    Values are JSON-encoded so non-string fields round-trip cleanly.
    ``HSET`` + ``EXPIRE`` run in one pipeline so the TTL never lags
    behind the write under load.
    """
    client = _get_ops_client()
    if client is None:
        return

    encoded = {k: json.dumps(v) for k, v in state.items()}
    try:
        async with ops_call(STREAMS_NAMESPACE, "set_state"):
            pipe = client.pipeline(transaction=False)
            pipe.hset(state_key, mapping=encoded)
            pipe.expire(state_key, ttl)
            await pipe.execute()
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"Stream set_state failed for {state_key}", component=LOGGER_COMPONENT)


async def stream_get_state(state_key: str) -> dict[str, Any] | None:
    """Read a run state hash. ``None`` if the key is absent or unreadable."""
    client = _get_ops_client()
    if client is None:
        return None

    try:
        async with ops_call(STREAMS_NAMESPACE, "get_state"):
            raw = await client.hgetall(state_key)
    except TimeoutError:
        return None
    except Exception:
        logger.warning(f"Stream get_state failed for {state_key}", component=LOGGER_COMPONENT)
        return None

    if not raw:
        return None

    decoded: dict[str, Any] = {}
    for key, value in raw.items():
        try:
            decoded[key] = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            decoded[key] = value
    return decoded


async def stream_delete(stream_key: str, state_key: str) -> None:
    """Drop a run's stream and state hash explicitly.

    The TTL on the state hash is the safety net; this is the primary
    cleanup path called once the worker is finished and any reconnect
    grace window has elapsed.
    """
    client = _get_ops_client()
    if client is None:
        return

    try:
        async with ops_call(STREAMS_NAMESPACE, "delete"):
            await client.delete(stream_key, state_key)
    except TimeoutError:
        return
    except Exception:
        logger.warning(
            f"Stream delete failed (stream={stream_key}, state={state_key})",
            component=LOGGER_COMPONENT,
        )


async def set_run_state(
    *,
    run_id: UUID,
    user_id: UUID,
    organization_id: UUID,
    session_id: UUID,
    status: RunStatus,
    last_seq: int = 0,
    error: str | None = None,
    started_at: datetime | None = None,
    ttl: int = RUN_STATE_TTL_SECONDS,
) -> None:
    """Write the canonical state hash for a run.

    The full snapshot is rewritten on every status transition so a
    reader that lands mid-stream sees a consistent view (``status`` and
    ``last_seq`` together) without partial-update races.
    """
    started = started_at or datetime.now(UTC)
    expires_at = started + timedelta(seconds=ttl)
    payload: dict[str, Any] = {
        "run_id": str(run_id),
        "user_id": str(user_id),
        "organization_id": str(organization_id),
        "session_id": str(session_id),
        "status": status,
        "last_seq": last_seq,
        "started_at": started.isoformat(),
        "expires_at": expires_at.isoformat(),
        "error": error,
    }
    await stream_set_state(run_state_key(run_id), payload, ttl=ttl)


async def get_run_state(run_id: UUID) -> dict[str, Any] | None:
    """Read the run state hash for ``run_id``. ``None`` if expired."""
    return await stream_get_state(run_state_key(run_id))
