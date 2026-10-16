"""Run agent cron tasks: scheduled via ARQ cron plus on-demand via "Run Now".

The agent runs on a session of its own. A failed write tool rolls that session back and expires
every row loaded through it, so task and run-log bookkeeping stays on the job's session.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Self, cast
from uuid import UUID

from loguru import logger

from uniffy.core.database import SESSION_FACTORY_CTX_KEY, SessionFactory
from uniffy.core.models.agents.cron_task import AgentCronRunStatus
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunStatus
from uniffy.core.models.agents.session import AgentSessionKind
from uniffy.core.realtime.buffer import UPDATE_BUFFER_CTX_KEY, UpdateBuffer
from uniffy.core.search import SEARCH_INDEXER_CTX_KEY
from uniffy.core.storage import OBJECT_STORAGE_CTX_KEY, ObjectStorage
from uniffy.domains.calls.lifecycle import CALL_LIFECYCLE_CTX_KEY
from uniffy.domains.chat.lifecycle import ChannelCallLifecycle

logger = logger.bind(component="agents.cron.jobs.jobs")

STALE_PENDING_CUTOFF = timedelta(minutes=30)


@dataclass(frozen=True, slots=True)
class CronRun:
    """The task facts one execution needs, read before anything can expire the task row."""

    task_id: UUID
    name: str
    agent_id: UUID
    organization_id: UUID
    execution_user_id: UUID
    prompt: str

    @classmethod
    def of(cls, task: Any) -> Self:
        return cls(
            task_id=task.id,
            name=task.name,
            agent_id=task.agent_id,
            organization_id=task.organization_id,
            execution_user_id=task.execution_user_id,
            prompt=task.prompt,
        )


async def _send_on_own_session(ctx: dict[str, Any], run: CronRun, session_id: UUID) -> None:
    from uniffy.domains.agents.runtime.operations import RuntimeOperations

    session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])
    async with session_factory() as run_session:
        runtime_ops = RuntimeOperations(
            run_session,
            cast(ObjectStorage, ctx[OBJECT_STORAGE_CTX_KEY]),
            ctx[SEARCH_INDEXER_CTX_KEY],
            cast(UpdateBuffer, ctx[UPDATE_BUFFER_CTX_KEY]),
            session_factory,
            cast(ChannelCallLifecycle, ctx[CALL_LIFECYCLE_CTX_KEY]),
        )
        await runtime_ops.send_message(
            user_id=run.execution_user_id,
            organization_id=run.organization_id,
            session_id=session_id,
            content=run.prompt,
        )


async def _stamp_run_logs(session, run: CronRun, session_id: UUID, since: datetime) -> int:
    """Mark the runtime-written run log rows of this execution as cron runs.

    The runtime writes one ``agents_run_logs`` row per send; stamping it (rather
    than writing a second summary row) keeps token and cost accounting single.
    The session owner can also open the cron session and chat interactively, so
    the stamp is bounded to rows the execution identity wrote within this
    execution's window - never the session's whole unstamped history.
    """
    from sqlalchemy import update

    from uniffy.core.models.agents.run_log import AgentRunLog

    result = await session.execute(
        update(AgentRunLog)
        .where(
            AgentRunLog.session_id == session_id,
            AgentRunLog.cron_task_id.is_(None),
            AgentRunLog.user_id == run.execution_user_id,
            AgentRunLog.created_at >= since,
        )
        .values(cron_task_id=run.task_id, kind=AgentRunKind.CRON)
    )
    await session.commit()
    return int(result.rowcount or 0)


async def _sweep_stale_pending_runs(session) -> int:
    """Fold abandoned trigger-now placeholders into error rows.

    A placeholder stays ``pending`` only while its queued job is alive; if the
    worker dies mid-flight the row would render as a never-finishing run and
    keep counting into usage totals. The cutoff sits well past the egress job
    timeout, so a live execution can never be swept.
    """
    from sqlalchemy import update

    from uniffy.core.models.agents.run_log import AgentRunLog

    cutoff = datetime.now(UTC) - STALE_PENDING_CUTOFF
    result = await session.execute(
        update(AgentRunLog)
        .where(
            AgentRunLog.kind == AgentRunKind.CRON,
            AgentRunLog.status == AgentRunStatus.PENDING,
            AgentRunLog.created_at < cutoff,
        )
        .values(status=AgentRunStatus.ERROR, error="Execution was lost before completing")
    )
    await session.commit()
    return int(result.rowcount or 0)


async def _write_error_log(
    session,
    run: CronRun,
    session_id: UUID | None,
    error: str,
) -> None:
    """Record a failure the runtime never logged (e.g. session setup failed)."""
    from uniffy.core.models.agents.run_log import AgentRunLog

    session.add(
        AgentRunLog(
            session_id=session_id,
            agent_id=run.agent_id,
            user_id=run.execution_user_id,
            organization_id=run.organization_id,
            model="",
            kind=AgentRunKind.CRON,
            cron_task_id=run.task_id,
            status=AgentRunStatus.ERROR,
            error=error[:1000],
        )
    )
    await session.commit()


async def _resolve_pending_log(
    session,
    run: CronRun,
    run_log_id: UUID,
    session_id: UUID | None,
    *,
    stamped: int,
    error: str | None,
) -> None:
    """Drop the trigger-now placeholder once the runtime wrote the real row, else settle it."""
    from sqlalchemy import delete, update

    from uniffy.core.models.agents.run_log import AgentRunLog

    placeholder = AgentRunLog.id == run_log_id
    if stamped:
        await session.execute(delete(AgentRunLog).where(placeholder))
    else:
        values: dict[str, Any] = {
            "status": AgentRunStatus.ERROR if error else AgentRunStatus.SUCCESS,
            "error": error[:1000] if error else None,
            "cron_task_id": run.task_id,
        }
        if session_id is not None:
            values["session_id"] = session_id
        await session.execute(update(AgentRunLog).where(placeholder).values(**values))
    await session.commit()


async def _ensure_cron_session(session, run: CronRun) -> UUID:
    """The task's agent session, created on its first run."""
    from uniffy.core.models.agents.cron_task import AgentCronTask
    from uniffy.domains.agents.sessions.operations import SessionOperations

    # Read through the session, so a task row an earlier rollback expired loads again.
    task = await session.get(AgentCronTask, run.task_id)
    if task is None:
        raise LookupError(f"Cron task {run.task_id} no longer exists")
    if task.session_id:
        return task.session_id
    cron_session = await SessionOperations(session).create_session(
        user_id=run.execution_user_id,
        organization_id=run.organization_id,
        agent_id=run.agent_id,
        kind=AgentSessionKind.CRON,
        display_name=f"Cron: {run.name}",
    )
    task.session_id = cron_session.id
    await session.commit()
    return cron_session.id


async def execute_agent_cron_tasks(ctx: dict[str, Any]) -> dict[str, Any]:
    """ARQ cron tick: execute every due agent task and update its run log."""
    executed = 0
    errors = 0
    session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])

    try:
        async with session_factory() as session:
            from uniffy.domains.agents.cron.operations import CronTaskOperations

            ops = CronTaskOperations(session, ctx[SEARCH_INDEXER_CTX_KEY])
            swept = await _sweep_stale_pending_runs(session)
            if swept:
                logger.warning(f"Marked {swept} stale pending cron run(s) as error")

            due_tasks = await ops.get_due_tasks()

            if not due_tasks:
                return {"executed": 0, "errors": 0}

            logger.info(f"Found {len(due_tasks)} due cron task(s)")

            for run in [CronRun.of(task) for task in due_tasks]:
                try:
                    await _execute_single_cron_task(ctx, session, run)
                    await ops.mark_completed(run.task_id, status=AgentCronRunStatus.SUCCESS)
                    executed += 1
                except Exception as exc:
                    logger.exception(f"Cron task {run.task_id} ({run.name!r}) failed: {exc}")
                    await session.rollback()
                    await ops.mark_completed(
                        run.task_id,
                        status=AgentCronRunStatus.ERROR,
                        error=str(exc)[:500],
                    )
                    errors += 1

    except Exception:
        logger.exception("Error in cron task executor")

    if executed or errors:
        logger.info(f"Cron executor: {executed} succeeded, {errors} failed")

    return {"executed": executed, "errors": errors}


async def execute_single_agent_cron_task(
    ctx: dict[str, Any],
    task_id: str,
    run_log_id: str,
) -> dict[str, Any]:
    """Execute a single cron task on demand and resolve its pending run log.

    ``run_log_id`` is the placeholder ``agents_run_logs`` row TriggerCronTask
    pre-created; it is deleted once the runtime has written the real row, or
    updated in place when the failure happened before any send.
    """
    from sqlalchemy import select

    from uniffy.core.models.agents.cron_task import AgentCronTask
    from uniffy.core.models.agents.run_log import AgentRunLog
    from uniffy.domains.agents.cron.operations import CronTaskOperations

    task_uuid = UUID(task_id)
    log_uuid = UUID(run_log_id)
    session_factory = cast(SessionFactory, ctx[SESSION_FACTORY_CTX_KEY])

    try:
        async with session_factory() as session:
            result = await session.execute(
                select(AgentCronTask).where(AgentCronTask.id == task_uuid)
            )
            task = result.scalar_one_or_none()
            if not task:
                logger.error(f"Cron task {task_id} not found for on-demand execution")
                return {"status": "error", "error": "Task not found"}
            run = CronRun.of(task)
            has_placeholder = (
                await session.scalar(select(AgentRunLog.id).where(AgentRunLog.id == log_uuid))
            ) is not None
            ops = CronTaskOperations(session, ctx[SEARCH_INDEXER_CTX_KEY])

            try:
                session_id = await _ensure_cron_session(session, run)
            except Exception as exc:
                await session.rollback()
                if has_placeholder:
                    await _resolve_pending_log(
                        session,
                        run,
                        log_uuid,
                        None,
                        stamped=0,
                        error=f"Session setup failed: {exc}",
                    )
                logger.exception(f"On-demand cron task {task_id}: session setup failed: {exc}")
                return {"status": "error", "task_id": task_id}

            send_started_at = datetime.now(UTC)
            try:
                await _send_on_own_session(ctx, run, session_id)
            except Exception as exc:
                stamped = await _stamp_run_logs(session, run, session_id, send_started_at)
                if has_placeholder:
                    await _resolve_pending_log(
                        session, run, log_uuid, session_id, stamped=stamped, error=str(exc)
                    )
                elif not stamped:
                    await _write_error_log(session, run, session_id, str(exc))
                await ops.mark_completed(
                    run.task_id,
                    status=AgentCronRunStatus.ERROR,
                    error=str(exc)[:500],
                )
                logger.exception(f"On-demand cron task {task_id} ({run.name!r}) failed: {exc}")
                return {"status": "error", "task_id": task_id}

            stamped = await _stamp_run_logs(session, run, session_id, send_started_at)
            if has_placeholder:
                await _resolve_pending_log(
                    session, run, log_uuid, session_id, stamped=stamped, error=None
                )
            await ops.mark_completed(run.task_id, status=AgentCronRunStatus.SUCCESS)
            logger.info(f"On-demand cron task {task_id} ({run.name!r}) completed successfully")
            return {"status": "success", "task_id": task_id}

    except Exception:
        logger.exception(f"Error in on-demand cron task executor for {task_id}")
        return {"status": "error", "task_id": task_id}


async def _execute_single_cron_task(ctx: dict[str, Any], session, run: CronRun) -> None:
    """Execute one cron task; its run log rows land in ``agents_run_logs``."""
    started_at = datetime.now(UTC)

    try:
        session_id = await _ensure_cron_session(session, run)
    except Exception as exc:
        await session.rollback()
        await _write_error_log(session, run, None, f"Session setup failed: {exc}")
        raise

    send_started_at = datetime.now(UTC)
    try:
        await _send_on_own_session(ctx, run, session_id)
    except Exception as exc:
        stamped = await _stamp_run_logs(session, run, session_id, send_started_at)
        if not stamped:
            await _write_error_log(session, run, session_id, str(exc))

        logger.exception(f"Cron task {run.task_id} ({run.name!r}) failed: {str(exc)[:1000]}")
        raise

    await _stamp_run_logs(session, run, session_id, send_started_at)

    duration_ms = int((datetime.now(UTC) - started_at).total_seconds() * 1000)
    logger.info(f"Cron task {run.task_id} ({run.name!r}) completed successfully in {duration_ms}ms")
