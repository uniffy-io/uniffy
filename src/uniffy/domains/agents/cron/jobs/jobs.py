"""Run agent cron tasks: scheduled via ARQ cron plus on-demand via "Run Now"."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.models.agents.cron_task import AgentCronRunStatus
from uniffy.core.models.agents.run_log import AgentRunKind, AgentRunStatus
from uniffy.core.models.agents.session import AgentSessionKind
from uniffy.db import open_session

logger = logger.bind(component="agents.cron.jobs.jobs")

STALE_PENDING_CUTOFF = timedelta(minutes=30)


async def _stamp_run_logs(session, task, session_id: UUID, since: datetime) -> int:
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
            AgentRunLog.user_id == task.execution_user_id,
            AgentRunLog.created_at >= since,
        )
        .values(cron_task_id=task.id, kind=AgentRunKind.CRON)
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
    task,
    session_id: UUID | None,
    error: str,
) -> None:
    """Record a failure the runtime never logged (e.g. session setup failed)."""
    from uniffy.core.models.agents.run_log import AgentRunLog

    session.add(
        AgentRunLog(
            session_id=session_id,
            agent_id=task.agent_id,
            user_id=task.execution_user_id,
            organization_id=task.organization_id,
            model="",
            kind=AgentRunKind.CRON,
            cron_task_id=task.id,
            status=AgentRunStatus.ERROR,
            error=error[:1000],
        )
    )
    await session.commit()


async def execute_agent_cron_tasks(ctx: dict[str, Any]) -> dict[str, Any]:
    """ARQ cron tick: execute every due agent task and update its run log."""
    executed = 0
    errors = 0

    try:
        async with open_session() as session:
            from uniffy.domains.agents.cron.operations import CronTaskOperations

            ops = CronTaskOperations(session)
            swept = await _sweep_stale_pending_runs(session)
            if swept:
                logger.warning(f"Marked {swept} stale pending cron run(s) as error")

            due_tasks = await ops.get_due_tasks()

            if not due_tasks:
                return {"executed": 0, "errors": 0}

            logger.info(f"Found {len(due_tasks)} due cron task(s)")

            for task in due_tasks:
                try:
                    await _execute_single_cron_task(session, task)
                    await ops.mark_completed(task.id, status=AgentCronRunStatus.SUCCESS)
                    executed += 1
                except Exception as exc:
                    logger.exception(f"Cron task {task.id} ({task.name!r}) failed: {exc}")
                    await ops.mark_completed(
                        task.id,
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
    from uniffy.domains.agents.runtime.operations import RuntimeOperations
    from uniffy.domains.agents.sessions.operations import SessionOperations

    task_uuid = UUID(task_id)
    log_uuid = UUID(run_log_id)

    try:
        async with open_session() as session:
            result = await session.execute(
                select(AgentCronTask).where(AgentCronTask.id == task_uuid)
            )
            task = result.scalar_one_or_none()
            if not task:
                logger.error(f"Cron task {task_id} not found for on-demand execution")
                return {"status": "error", "error": "Task not found"}

            log_result = await session.execute(select(AgentRunLog).where(AgentRunLog.id == log_uuid))
            pending_log = log_result.scalar_one_or_none()

            async def _resolve_pending(*, error: str | None, since: datetime) -> None:
                if pending_log is None:
                    return
                stamped = await _stamp_run_logs(session, task, task.session_id, since)
                if stamped and error is None:
                    # The runtime wrote the real row; the placeholder is noise.
                    await session.delete(pending_log)
                else:
                    pending_log.status = AgentRunStatus.ERROR if error else AgentRunStatus.SUCCESS
                    pending_log.error = error[:1000] if error else None
                    pending_log.session_id = task.session_id
                    pending_log.cron_task_id = task.id
                await session.commit()

            session_id = task.session_id
            if not session_id:
                try:
                    session_ops = SessionOperations(session)
                    cron_session = await session_ops.create_session(
                        user_id=task.execution_user_id,
                        organization_id=task.organization_id,
                        agent_id=task.agent_id,
                        kind=AgentSessionKind.CRON,
                        display_name=f"Cron: {task.name}",
                    )
                    session_id = cron_session.id
                    task.session_id = session_id
                    await session.commit()
                except Exception as exc:
                    await session.rollback()
                    if pending_log is not None:
                        pending_log.status = AgentRunStatus.ERROR
                        pending_log.error = f"Session setup failed: {exc}"[:1000]
                        pending_log.cron_task_id = task.id
                        await session.commit()

                    logger.exception(f"On-demand cron task {task_id}: session setup failed: {exc}")
                    return {"status": "error", "task_id": task_id}

            send_started_at = datetime.now(UTC)
            try:
                runtime_ops = RuntimeOperations(session)
                await runtime_ops.send_message(
                    user_id=task.execution_user_id,
                    organization_id=task.organization_id,
                    session_id=session_id,
                    content=task.prompt,
                )
                await _resolve_pending(error=None, since=send_started_at)

                ops = CronTaskOperations(session)
                await ops.mark_completed(task.id, status=AgentCronRunStatus.SUCCESS)

                logger.info(f"On-demand cron task {task_id} ({task.name!r}) completed successfully")
                return {"status": "success", "task_id": task_id}

            except Exception as exc:
                await session.rollback()
                stamped = await _stamp_run_logs(session, task, session_id, send_started_at)
                if pending_log is not None:
                    if stamped:
                        await session.delete(pending_log)
                    else:
                        pending_log.status = AgentRunStatus.ERROR
                        pending_log.error = str(exc)[:1000]
                        pending_log.session_id = session_id
                        pending_log.cron_task_id = task.id
                    await session.commit()
                elif not stamped:
                    await _write_error_log(session, task, session_id, str(exc))

                ops = CronTaskOperations(session)
                await ops.mark_completed(
                    task.id,
                    status=AgentCronRunStatus.ERROR,
                    error=str(exc)[:500],
                )

                logger.exception(f"On-demand cron task {task_id} ({task.name!r}) failed: {exc}")
                return {"status": "error", "task_id": task_id}

    except Exception:
        logger.exception(f"Error in on-demand cron task executor for {task_id}")
        return {"status": "error", "task_id": task_id}


async def _execute_single_cron_task(session, task) -> None:
    """Execute one cron task; its run log rows land in ``agents_run_logs``."""
    from uniffy.domains.agents.runtime.operations import RuntimeOperations
    from uniffy.domains.agents.sessions.operations import SessionOperations

    started_at = datetime.now(UTC)
    session_id = task.session_id

    try:
        if not session_id:
            session_ops = SessionOperations(session)
            cron_session = await session_ops.create_session(
                user_id=task.execution_user_id,
                organization_id=task.organization_id,
                agent_id=task.agent_id,
                kind=AgentSessionKind.CRON,
                display_name=f"Cron: {task.name}",
            )
            session_id = cron_session.id
            task.session_id = session_id
            await session.commit()
    except Exception as exc:
        await session.rollback()
        await _write_error_log(session, task, None, f"Session setup failed: {exc}")
        raise

    send_started_at = datetime.now(UTC)
    try:
        runtime_ops = RuntimeOperations(session)
        await runtime_ops.send_message(
            user_id=task.execution_user_id,
            organization_id=task.organization_id,
            session_id=session_id,
            content=task.prompt,
        )
    except Exception as exc:
        await session.rollback()
        stamped = await _stamp_run_logs(session, task, session_id, send_started_at)
        if not stamped:
            await _write_error_log(session, task, session_id, str(exc))

        logger.exception(f"Cron task {task.id} ({task.name!r}) failed: {str(exc)[:1000]}")
        raise

    await _stamp_run_logs(session, task, session_id, send_started_at)

    duration_ms = int((datetime.now(UTC) - started_at).total_seconds() * 1000)
    logger.info(f"Cron task {task.id} ({task.name!r}) completed successfully in {duration_ms}ms")
