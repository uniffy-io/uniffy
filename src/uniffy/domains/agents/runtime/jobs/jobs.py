"""ARQ job: drive an agent session run, fanning events through a Valkey stream.

Idempotent via an owned `SET NX agent_run_lock:{run_id}` lease; duplicate
enqueues become a no-op and only the current owner can release the lock.
"""

import asyncio
import time
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from loguru import logger

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.jobs.locks import acquire_owned_job_lock, release_owned_job_lock
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
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
from uniffy.domains.agents.metrics import (
    AGENT_RUN_ACTIVE,
    AGENT_RUN_DURATION,
    AGENT_RUN_QUEUE_LAG,
)
from uniffy.domains.agents.providers.base import EventType, StreamEvent
from uniffy.domains.agents.runtime.destinations import SessionDestination
from uniffy.domains.agents.runtime.files import FileContext
from uniffy.domains.agents.runtime.jobs.contracts import DELETE_RUN_STREAM
from uniffy.domains.agents.runtime.operations import RuntimeOperations
from uniffy.domains.agents.runtime.publishers import RunStreamPublisher
from uniffy.domains.agents.runtime.settings.operations import get_runtime_settings
from uniffy.domains.agents.sessions.operations import SessionOperations

logger = logger.bind(component="agents.runtime.jobs.jobs")

RUN_AGENT_SESSION_JOB_TIMEOUT_SECONDS = 900
_LOCK_TTL_SECONDS = RUN_AGENT_SESSION_JOB_TIMEOUT_SECONDS + 30
_LOCK_KEY_TEMPLATE = "agent_run_lock:{run_id}"
_DELETE_DEFER_SECONDS = 60
_ERROR_TRUNCATE_LIMIT = 500


async def _acquire_lock(run_id: UUID) -> str | None:
    client = _get_ops_client()
    if client is None:
        return None
    try:
        return await acquire_owned_job_lock(
            client,
            _LOCK_KEY_TEMPLATE.format(run_id=run_id),
            _LOCK_TTL_SECONDS,
        )
    except Exception:
        logger.warning(f"run_agent_session: lock SET NX failed for {run_id}")
        return None


async def _release_lock(run_id: UUID, token: str) -> None:
    client = _get_ops_client()
    if client is None:
        return
    try:
        await release_owned_job_lock(
            client,
            _LOCK_KEY_TEMPLATE.format(run_id=run_id),
            token,
        )
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

    lock_token = await _acquire_lock(rid)
    if lock_token is None:
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
    valkey = ctx.get("valkey")
    run_started = time.monotonic()
    AGENT_RUN_ACTIVE.inc()
    await session_active_run_add(sid, rid)

    try:
        session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
        async with session_factory() as session:
            session_ops = SessionOperations(session)
            await session_ops.get_session(
                user_id=uid,
                organization_id=oid,
                session_id=sid,
            )

            storage = cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY])
            runtime_ops = RuntimeOperations(
                session,
                storage,
                ctx[SEARCH_INDEXER_CTX_KEY],
                session_factory,
            )
            runtime_settings = await get_runtime_settings(session, oid)
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
            try:
                async with asyncio.timeout(runtime_settings.send_deadline_seconds):
                    async for event in event_stream:
                        await publisher.publish(event)
                        if event.type is EventType.DONE:
                            done_seen = True
                            break
                        # Polling between events keeps the cancel window tight (one HGET per event).
                        if await is_cancel_requested(rid):
                            cancelled = True
                            cancelled_msg = await session_ops.add_cancelled_placeholder(
                                session_id=sid,
                            )
                            await publisher.publish(
                                StreamEvent(type=EventType.MESSAGE_STORED, message=cancelled_msg)
                            )
                            await publisher.publish(
                                StreamEvent(type=EventType.ERROR, error="cancelled")
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
            except TimeoutError:
                logger.warning(f"run_agent_session deadline exceeded for run={run_id}")
                await publisher.publish(
                    StreamEvent(type=EventType.ERROR, error="agent_deadline_exceeded")
                )
                return {
                    "status": "error",
                    "error": "agent_deadline_exceeded",
                    "run_id": run_id,
                }

        if (done_seen or cancelled) and valkey is not None:
            try:
                await valkey.enqueue_job(
                    DELETE_RUN_STREAM.name,
                    run_id,
                    _defer_by=_DELETE_DEFER_SECONDS,
                )
            except Exception:
                logger.warning(
                    f"run_agent_session: failed to schedule delete_run_stream for run={run_id}"
                )

        if cancelled:
            return {"status": "cancelled", "run_id": run_id}
        return {"status": "success", "run_id": run_id}

    except Exception as exc:
        error_text = str(exc)[:_ERROR_TRUNCATE_LIMIT]
        logger.exception(f"run_agent_session failed for run={run_id}: {exc}")
        try:
            await publisher.publish(StreamEvent(type=EventType.ERROR, error=error_text))
        except Exception:
            logger.exception(f"run_agent_session: failed to publish error event for run={run_id}")
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
            logger.exception(f"run_agent_session: failed to write error state for run={run_id}")
        raise
    finally:
        try:
            AGENT_RUN_DURATION.observe(time.monotonic() - run_started)
            AGENT_RUN_ACTIVE.dec()
            await publisher.close()
        finally:
            await session_active_run_remove(sid, rid)
            await _release_lock(rid, lock_token)


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
