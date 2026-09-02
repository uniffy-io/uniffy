"""Agent run streams, state, cancellation, and active-run tracking."""

import contextlib
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.json_codec import dumps_bytes
from uniffy.infrastructure.valkey import streams as transport
from uniffy.infrastructure.valkey.ops import get_ops_client, ops_call

logger = logger.bind(component="agents.runtime.streams")

RUN_STREAM_DEFAULT_MAXLEN = 200
RUN_STATE_TTL_SECONDS = 300
_NAMESPACE = "agent"

RunStatus = str


def run_stream_key(run_id: UUID | str) -> str:
    return f"agent:run:{run_id}"


def run_state_key(run_id: UUID | str) -> str:
    return f"agent:run:{run_id}:state"


async def stream_xadd(
    stream_key: str,
    payload: dict[str, Any],
    maxlen: int = RUN_STREAM_DEFAULT_MAXLEN,
) -> str | None:
    return await transport.xadd(stream_key, payload, maxlen=maxlen)


async def stream_xread(
    stream_key: str,
    last_id: str = "0",
    count: int = 100,
    block_ms: int = 5000,
) -> list[tuple[str, dict[str, Any]]]:
    return await transport.xread(
        stream_key,
        last_id=last_id,
        count=count,
        block_ms=block_ms,
    )


async def stream_set_state(
    state_key: str,
    state: dict[str, Any],
    ttl: int = RUN_STATE_TTL_SECONDS,
) -> None:
    await transport.set_state(state_key, state, ttl=ttl)


async def stream_get_state(state_key: str) -> dict[str, Any] | None:
    return await transport.get_state(state_key)


async def stream_delete(stream_key: str, state_key: str) -> None:
    await transport.delete(stream_key, state_key)


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
    client = get_ops_client()
    if client is None:
        return
    key = session_active_runs_key(session_id)
    try:
        async with ops_call(_NAMESPACE, "session_run_add"):
            pipe = client.pipeline(transaction=False)
            pipe.sadd(key, str(run_id))
            pipe.expire(key, RUN_STATE_TTL_SECONDS)
            await pipe.execute()
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"session_active_run_add failed for {session_id}")


async def session_active_run_remove(session_id: UUID, run_id: UUID) -> None:
    client = get_ops_client()
    if client is None:
        return
    try:
        async with ops_call(_NAMESPACE, "session_run_remove"):
            await client.srem(session_active_runs_key(session_id), str(run_id))
    except TimeoutError:
        return
    except Exception:
        logger.warning(f"session_active_run_remove failed for {session_id}")


async def session_has_active_run(session_id: UUID) -> bool:
    """True iff any run is active for ``session_id``. Returns ``False`` on
    Valkey error (caller is also gated by audit + permission checks).
    """
    client = get_ops_client()
    if client is None:
        return False
    try:
        async with ops_call(_NAMESPACE, "session_run_check"):
            count = await client.scard(session_active_runs_key(session_id))
        return int(count or 0) > 0
    except TimeoutError:
        return False
    except Exception:
        logger.warning(f"session_has_active_run failed for {session_id}")
        return False


async def request_run_cancel(run_id: UUID) -> bool:
    """Set the ``cancel_requested`` flag; the egress task observes it between tool iterations."""
    state = await get_run_state(run_id)
    if state is None:
        return False
    status = state.get("status")
    if status not in {"queued", "running"}:
        return False

    client = get_ops_client()
    if client is None:
        return False
    try:
        async with ops_call(_NAMESPACE, "request_cancel"):
            await client.hset(
                run_state_key(run_id),
                "cancel_requested",
                dumps_bytes(True),
            )
        return True
    except TimeoutError:
        return False
    except Exception:
        logger.warning(f"request_run_cancel failed for {run_id}")
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
    client = get_ops_client()
    if client is None:
        return
    with contextlib.suppress(TimeoutError, Exception):
        async with ops_call(_NAMESPACE, "touch_state"):
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
    client = get_ops_client()
    if client is None:
        return
    with contextlib.suppress(TimeoutError, Exception):
        async with ops_call(_NAMESPACE, "set_chat_active_run"):
            await client.set(chat_active_run_key(channel_id, agent_id), str(run_id), ex=ttl)


async def get_chat_active_run(channel_id: UUID, agent_id: UUID) -> UUID | None:
    """Return the active run id for ``(channel, agent)`` or ``None``."""
    client = get_ops_client()
    if client is None:
        return None
    try:
        async with ops_call(_NAMESPACE, "get_chat_active_run"):
            raw = await client.get(chat_active_run_key(channel_id, agent_id))
    except TimeoutError, Exception:
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
    client = get_ops_client()
    if client is None:
        return
    with contextlib.suppress(TimeoutError, Exception):
        async with ops_call(_NAMESPACE, "clear_chat_active_run"):
            await client.delete(chat_active_run_key(channel_id, agent_id))
