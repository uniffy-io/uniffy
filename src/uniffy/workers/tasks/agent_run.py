"""ARQ task: drive an agent session run, fanning events through a Valkey stream.

Idempotent via `SET NX agent_run_lock:{run_id}` (5 min TTL); duplicate enqueues
become a no-op.
"""

import time
from datetime import datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.ops import _get_ops_client
from uniffy.core.valkey.streams import (
    get_run_state,
    is_cancel_requested,
    run_state_key,
    run_stream_key,
    session_active_run_add,
    session_active_run_remove,
    set_run_state,
    stream_delete,
)
from uniffy.db.session import open_session
from uniffy.domains.agents.runtime.destinations import SessionDestination
from uniffy.domains.agents.runtime.file_loader import FileContext
from uniffy.domains.agents.runtime.operations import RuntimeOperations
from uniffy.domains.agents.runtime.publishers import RunStreamPublisher
from uniffy.domains.agents.runtime.stream_events import (
    RuntimeDoneEvent,
    RuntimeErrorEvent,
    RuntimeMessageStoredEvent,
)
from uniffy.domains.agents.sessions.operations import SessionOperations
from uniffy.observability.metrics import (
    AGENT_RUN_ACTIVE,
    AGENT_RUN_DURATION,
    AGENT_RUN_QUEUE_LAG,
)

logger = logger.bind(component="tasks.agent_run")

_LOCK_TTL_SECONDS = 300
_LOCK_KEY_TEMPLATE = "agent_run_lock:{run_id}"
_DELETE_DEFER_SECONDS = 60
_ERROR_TRUNCATE_LIMIT = 500


async def _acquire_lock(run_id: UUID) -> bool:
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
    """Rebuild `FileContext`s from the JSON payload the handler already permission-checked."""
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
    rerun_message_id: str | None = None,
    invoked_skill_id: str | None = None,
) -> dict[str, Any]:
    """Drive one agent run; subscribers attach to `agent:run:{run_id}` for events."""
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
    await session_active_run_add(sid, rid)

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
            cancelled = False
            if rerun_message_id:
                event_stream = runtime_ops.stream_rerun_from_message(
                    user_id=uid,
                    organization_id=oid,
                    message_id=UUID(rerun_message_id),
                    user_timezone=user_timezone,
                )
            else:
                event_stream = runtime_ops.stream_send_message(
                    destination=destination,
                    user_id=uid,
                    organization_id=oid,
                    content=content,
                    files=file_contexts,
                    user_timezone=user_timezone,
                    invoked_skill_id=UUID(invoked_skill_id) if invoked_skill_id else None,
                )
            async for event in event_stream:
                await publisher.publish(event)
                if isinstance(event, RuntimeDoneEvent):
                    done_seen = True
                    break
                # Polling between events keeps the cancel window tight (one HGET per event).
                if await is_cancel_requested(rid):
                    cancelled = True
                    cancelled_msg = await session_ops.add_cancelled_placeholder(
                        session_id=sid,
                    )
                    await publisher.publish(
                        RuntimeMessageStoredEvent(message=cancelled_msg)
                    )
                    await publisher.publish(
                        RuntimeErrorEvent(error="cancelled")
                    )
                    await set_run_state(
                        run_id=rid,
                        user_id=uid,
                        organization_id=oid,
                        session_id=sid,
                        status="cancelled",
                        last_seq=publisher.last_seq,
                    )
                    break

        if (done_seen or cancelled) and redis is not None:
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

        if cancelled:
            return {"status": "cancelled", "run_id": run_id}
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
            await session_active_run_remove(sid, rid)
            await _release_lock(rid)


async def delete_run_stream(
    ctx: dict[str, Any],
    run_id: str,
) -> dict[str, Any]:
    """Drop a run's stream + state hash 60s after completion so reconnects can still replay."""
    try:
        rid = UUID(run_id)
    except ValueError:
        logger.error(f"delete_run_stream: invalid run_id {run_id}")
        return {"status": "error", "error": "invalid_uuid"}

    await stream_delete(run_stream_key(rid), run_state_key(rid))
    return {"status": "success", "run_id": run_id}
