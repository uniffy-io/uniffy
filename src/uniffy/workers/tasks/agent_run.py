"""ARQ task: drive an agent session run through a Valkey Stream.

Enqueued by ``RuntimeHandlers.stream_send_message`` /
``send_message`` once per direct-agent invocation (the chat-triggered
path uses ``respond_to_chat_message`` instead). The handler
pre-allocates ``run_id`` so it can subscribe to ``agent:run:{run_id}``
immediately; the worker drives the LLM turn, fans events through a
``RunStreamPublisher``, and schedules a follow-up
``delete_run_stream`` job to clean up after a brief reconnect grace
window.

Idempotency: ``SET NX agent_run_lock:{run_id}`` with a 5-minute TTL.
Lock-loss is a no-op so two workers cannot race on the same run if a
duplicate enqueue ever slips through.
"""

import time
from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client
from uniffy.core.valkey.streams import (
    get_run_state,
    run_state_key,
    run_stream_key,
    set_run_state,
    stream_delete,
)
from uniffy.db.session import open_session
from uniffy.domains.agents.runtime.destinations import SessionDestination
from uniffy.domains.agents.runtime.operations import FileContext, RuntimeOperations
from uniffy.domains.agents.runtime.publishers import RunStreamPublisher
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeDoneEvent,
    RuntimeErrorEvent,
)
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.observability.metrics import (
    AGENT_RUN_ACTIVE,
    AGENT_RUN_DURATION,
    AGENT_RUN_QUEUE_LAG,
)

_LOCK_TTL_SECONDS = 300
_LOCK_KEY_TEMPLATE = "agent_run_lock:{run_id}"
_DELETE_DEFER_SECONDS = 60
_ERROR_TRUNCATE_LIMIT = 500


async def _acquire_lock(run_id: UUID) -> bool:
    """Try to acquire the per-run lock. Returns ``True`` on success."""
    client = _get_ops_client()
    if client is None:
        return False
    try:
        return bool(
            await client.set(
                _LOCK_KEY_TEMPLATE.format(run_id=run_id),
                "1",
                ex=_LOCK_TTL_SECONDS,
                nx=True,
            )
        )
    except Exception:
        logger.warning(f"run_agent_session: lock SET NX failed for {run_id}")
        return False


async def _release_lock(run_id: UUID) -> None:
    """Release the per-run lock; safe even if it was never acquired."""
    client = _get_ops_client()
    if client is None:
        return
    try:
        await client.delete(_LOCK_KEY_TEMPLATE.format(run_id=run_id))
    except Exception:
        logger.warning(f"run_agent_session: lock DEL failed for {run_id}")


def _files_from_payload(
    payload: list[dict[str, Any]] | None,
) -> list[FileContext] | None:
    """Rebuild ``FileContext`` instances from the JSON-safe handler payload.

    The handler runs ``_load_files`` (full permission check via
    ``FileOperations.get_by_id``) before enqueuing; the worker only
    rebuilds the typed structs. Missing fields are a malformed handler
    call and surface as ``KeyError``.
    """
    if not payload:
        return None
    return [
        FileContext(
            file_id=str(item["file_id"]),
            media_type=str(item["media_type"]),
            filename=str(item["filename"]),
            storage_key=str(item["storage_key"]),
            extracted_text=item.get("extracted_text"),
            extraction_status=str(item["extraction_status"]),
        )
        for item in payload
    ]


async def run_agent_session(
    ctx: dict[str, Any],
    run_id: str,
    user_id: str,
    organization_id: str,
    session_id: str,
    content: str,
    files: list[dict[str, Any]] | None,
    user_timezone: str | None,
) -> dict[str, Any]:
    """Drive a single agent session run, fanning events to a per-run stream.

    Parameters
    ----------
    ctx : dict
        ARQ worker context. ``ctx["redis"]`` is the egress pool that
        schedules the deferred ``delete_run_stream`` cleanup job.
    run_id : str
        UUID pre-allocated by the RPC handler. Subscribers attach to
        ``agent:run:{run_id}``; the worker MUST NOT mint a new one.
    user_id : str
        UUID of the human user who triggered the run.
    organization_id : str
        UUID of the organisation scope.
    session_id : str
        UUID of the ``AgentSession`` whose history this run extends.
    content : str
        The user's message text (already stripped by the handler).
    files : list[dict] | None
        File contexts permission-checked + JSON-serialised by the
        handler. Each entry has the shape::

            {
                "file_id": str,
                "media_type": str,
                "filename": str,
                "storage_key": str,
                "extracted_text": str | None,
                "extraction_status": str,
            }
    user_timezone : str | None
        IANA timezone used by the system prompt's "current date/time"
        line.

    Returns
    -------
    dict
        Execution summary. ``status`` is one of ``success`` / ``error``
        / ``skipped``; on ``error`` an ``error`` field carries the
        truncated reason. Re-raises on driver exceptions so ARQ records
        the failure (after a synthetic ``RuntimeErrorEvent`` is
        published so subscribers see a terminal event).

    """
    try:
        rid = UUID(run_id)
        uid = UUID(user_id)
        oid = UUID(organization_id)
        sid = UUID(session_id)
    except ValueError:
        logger.error(
            f"run_agent_session: invalid UUID args run={run_id} "
            f"user={user_id} org={organization_id} session={session_id}"
        )
        return {"status": "error", "error": "invalid_uuid"}

    if not await _acquire_lock(rid):
        return {"status": "skipped", "reason": "lock_held", "run_id": run_id}

    queued_state = await get_run_state(rid)
    if queued_state is not None:
        queued_at_raw = queued_state.get("started_at")
        if isinstance(queued_at_raw, str):
            try:
                queued_at = datetime.fromisoformat(queued_at_raw)
                lag = (datetime.now(queued_at.tzinfo) - queued_at).total_seconds()
                if lag >= 0:
                    AGENT_RUN_QUEUE_LAG.observe(lag)
            except ValueError:
                pass

    publisher = RunStreamPublisher(
        run_id=rid,
        user_id=uid,
        organization_id=oid,
        session_id=sid,
    )
    file_contexts = _files_from_payload(files)
    redis = ctx.get("redis")
    run_started = time.monotonic()
    AGENT_RUN_ACTIVE.inc()

    try:
        async with open_session() as session:
            session_ops = SessionOperations(session)
            await session_ops.get_session(
                user_id=uid,
                organization_id=oid,
                session_id=sid,
            )

            runtime_ops = RuntimeOperations(session)
            destination = SessionDestination(session_id=sid)
            done_seen = False
            async for event in runtime_ops.stream_send_message(
                destination=destination,
                user_id=uid,
                organization_id=oid,
                content=content,
                files=file_contexts,
                user_timezone=user_timezone,
            ):
                await publisher.publish(event)
                if isinstance(event, RuntimeDoneEvent):
                    done_seen = True

        if done_seen and redis is not None:
            try:
                await redis.enqueue_job(
                    "delete_run_stream",
                    run_id,
                    _defer_by=_DELETE_DEFER_SECONDS,
                )
            except Exception:
                logger.warning(
                    f"run_agent_session: failed to schedule delete_run_stream "
                    f"for run={run_id}"
                )

        return {"status": "success", "run_id": run_id}

    except Exception as exc:
        error_text = str(exc)[:_ERROR_TRUNCATE_LIMIT]
        logger.exception(f"run_agent_session failed for run={run_id}: {exc}")
        try:
            await publisher.publish(RuntimeErrorEvent(error=error_text))
        except Exception:
            logger.exception(
                f"run_agent_session: failed to publish error event for "
                f"run={run_id}"
            )
        try:
            await set_run_state(
                run_id=rid,
                user_id=uid,
                organization_id=oid,
                session_id=sid,
                status="error",
                last_seq=publisher.last_seq,
                error=error_text,
            )
        except Exception:
            logger.exception(
                f"run_agent_session: failed to write error state for "
                f"run={run_id}"
            )
        raise
    finally:
        try:
            AGENT_RUN_DURATION.observe(time.monotonic() - run_started)
            AGENT_RUN_ACTIVE.dec()
            await publisher.close()
        finally:
            await _release_lock(rid)


async def delete_run_stream(
    ctx: dict[str, Any],
    run_id: str,
) -> dict[str, Any]:
    """Drop a run's events stream + state hash explicitly.

    Scheduled 60s after ``RuntimeDoneEvent`` so a late
    ``SubscribeToRun`` reconnect within that window still replays the
    full event sequence. The state-hash TTL (300s) is the safety net
    if this task ever fails to run.
    """
    try:
        rid = UUID(run_id)
    except ValueError:
        logger.error(f"delete_run_stream: invalid run_id {run_id}")
        return {"status": "error", "error": "invalid_uuid"}

    await stream_delete(run_stream_key(rid), run_state_key(rid))
    return {"status": "success", "run_id": run_id}
