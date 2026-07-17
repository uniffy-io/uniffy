"""Valkey Streams helpers backing per-``run_id`` event streams with replay.

Two client tiers: non-blocking writes/reads run on the fail-fast ops client;
``stream_xread`` uses the streams tier (30s socket timeout) because the inner
Valkey BLOCK must actually block. The 150ms ``ops_call`` guard is NOT applied to
XREAD - a long block is the point.

Keys: ``agent:run:{run_id}`` (events, ``MAXLEN ~200``) and
``agent:run:{run_id}:state`` (hash with metadata, TTL ``RUN_STATE_TTL_SECONDS``
refreshed on every publish).
"""

import asyncio
import contextlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import valkey.asyncio as aioredis
from loguru import logger
from valkey.exceptions import ConnectionError as ValkeyConnectionError
from valkey.exceptions import TimeoutError as ValkeyTimeoutError

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
    """Initialise the process-wide streams client. Idempotent; a bound
    PING verifies the connection.
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
    return _streams_client


def run_stream_key(run_id: UUID | str) -> str:
    return f"agent:run:{run_id}"


def run_state_key(run_id: UUID | str) -> str:
    return f"agent:run:{run_id}:state"


async def stream_xadd(
    stream_key: str,
    payload: dict[str, Any],
    maxlen: int = RUN_STREAM_DEFAULT_MAXLEN,
) -> str | None:
    """Append one JSON-encoded event; returns the message id or ``None`` on a Valkey miss."""
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
    """Block up to ``block_ms`` for events past ``last_id``; empty list
    means "no events this round".
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
    except (ValkeyTimeoutError, ValkeyConnectionError) as exc:
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
    """Write/refresh a run state hash; ``HSET`` + ``EXPIRE`` run in one
    pipeline so TTL never lags.
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
    """Read a run state hash; ``None`` when absent or unreadable."""
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
    """Explicit cleanup of a run's stream and state hash; the state-hash TTL is the safety net."""
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
    """Write the canonical state hash. The full snapshot is rewritten so
    readers see a consistent view.
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
    """Run state hash for ``run_id``; ``None`` if expired."""
    return await stream_get_state(run_state_key(run_id))


def session_active_runs_key(session_id: UUID | str) -> str:
    """Set key tracking ``queued`` / ``running`` runs for a session; TTL
    matches the run-state hash.
    """
    return f"agent:session:{session_id}:active_runs"


async def session_active_run_add(session_id: UUID, run_id: UUID) -> None:
    """Mark ``run_id`` active for ``session_id``. Best-effort - the egress
    lock + state hash are the real guard.
    """
    client = _get_ops_client()
    if client is None:
        return
    key = session_active_runs_key(session_id)
    try:
        async with ops_call(STREAMS_NAMESPACE, "session_run_add"):
            pipe = client.pipeline(transaction=False)
            pipe.sadd(key, str(run_id))
            pipe.expire(key, RUN_STATE_TTL_SECONDS)
            await pipe.execute()
    except TimeoutError:
        return
    except Exception:
        logger.warning(
            f"session_active_run_add failed for {session_id}",
            component=LOGGER_COMPONENT,
        )


async def session_active_run_remove(session_id: UUID, run_id: UUID) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        async with ops_call(STREAMS_NAMESPACE, "session_run_remove"):
            await client.srem(session_active_runs_key(session_id), str(run_id))
    except TimeoutError:
        return
    except Exception:
        logger.warning(
            f"session_active_run_remove failed for {session_id}",
            component=LOGGER_COMPONENT,
        )


async def session_has_active_run(session_id: UUID) -> bool:
    """True iff any run is active for ``session_id``. Returns ``False`` on
    Valkey error (caller is also gated by audit + permission checks).
    """
    client = _get_ops_client()
    if client is None:
        return False
    try:
        async with ops_call(STREAMS_NAMESPACE, "session_run_check"):
            count = await client.scard(session_active_runs_key(session_id))
        return int(count or 0) > 0
    except TimeoutError:
        return False
    except Exception:
        logger.warning(
            f"session_has_active_run failed for {session_id}",
            component=LOGGER_COMPONENT,
        )
        return False


async def request_run_cancel(run_id: UUID) -> bool:
    """Set the ``cancel_requested`` flag; the egress task observes it between tool iterations."""
    state = await get_run_state(run_id)
    if state is None:
        return False
    status = state.get("status")
    if status not in {"queued", "running"}:
        return False

    client = _get_ops_client()
    if client is None:
        return False
    try:
        async with ops_call(STREAMS_NAMESPACE, "request_cancel"):
            await client.hset(
                run_state_key(run_id),
                "cancel_requested",
                json.dumps(True),
            )
        return True
    except TimeoutError:
        return False
    except Exception:
        logger.warning(
            f"request_run_cancel failed for {run_id}",
            component=LOGGER_COMPONENT,
        )
        return False


async def is_cancel_requested(run_id: UUID) -> bool:
    """True iff a cancel has been requested on ``run_id``."""
    state = await get_run_state(run_id)
    if state is None:
        return False
    return bool(state.get("cancel_requested"))


async def touch_run_state(run_id: UUID, ttl: int = RUN_STATE_TTL_SECONDS) -> None:
    """Bump the run-state TTL without rewriting fields.

    A full ``set_run_state`` would clobber ``cancel_requested``; long turns
    (multiple image generations) need their state kept alive without dropping a
    pending cancel, so this only refreshes the expiry.
    """
    client = _get_ops_client()
    if client is None:
        return
    with contextlib.suppress(TimeoutError, Exception):
        async with ops_call(STREAMS_NAMESPACE, "touch_state"):
            await client.expire(run_state_key(run_id), ttl)


def chat_active_run_key(channel_id: UUID, agent_id: UUID) -> str:
    """Maps a (channel, agent) pair to its currently active run id."""
    return f"agent:chat:activerun:{channel_id}:{agent_id}"


async def set_chat_active_run(
    channel_id: UUID,
    agent_id: UUID,
    run_id: UUID,
    ttl: int = RUN_STATE_TTL_SECONDS,
) -> None:
    """Record ``run_id`` as the active chat run for ``(channel, agent)``."""
    client = _get_ops_client()
    if client is None:
        return
    with contextlib.suppress(TimeoutError, Exception):
        async with ops_call(STREAMS_NAMESPACE, "set_chat_active_run"):
            await client.set(chat_active_run_key(channel_id, agent_id), str(run_id), ex=ttl)


async def get_chat_active_run(channel_id: UUID, agent_id: UUID) -> UUID | None:
    """Return the active run id for ``(channel, agent)`` or ``None``."""
    client = _get_ops_client()
    if client is None:
        return None
    try:
        async with ops_call(STREAMS_NAMESPACE, "get_chat_active_run"):
            raw = await client.get(chat_active_run_key(channel_id, agent_id))
    except (TimeoutError, Exception):
        return None
    if not raw:
        return None
    value = raw.decode() if isinstance(raw, bytes) else str(raw)
    try:
        return UUID(value)
    except ValueError:
        return None


async def clear_chat_active_run(channel_id: UUID, agent_id: UUID) -> None:
    """Drop the active-run pointer for ``(channel, agent)``."""
    client = _get_ops_client()
    if client is None:
        return
    with contextlib.suppress(TimeoutError, Exception):
        async with ops_call(STREAMS_NAMESPACE, "clear_chat_active_run"):
            await client.delete(chat_active_run_key(channel_id, agent_id))
