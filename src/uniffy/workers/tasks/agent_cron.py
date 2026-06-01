"""Run agent cron tasks: scheduled via ARQ cron plus on-demand via "Run Now"."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.db import open_session

logger = logger.bind(component="tasks.agent_cron")


async def execute_agent_cron_tasks(ctx: dict[str, Any]) -> dict[str, Any]:
    """ARQ cron tick: execute every due agent task and update its run log."""
    executed = 0
    errors = 0

    try:
        async with open_session() as session:
            from uniffy.domains.agents.cron.operations import CronTaskOperations

            ops = CronTaskOperations(session)
            due_tasks = await ops.get_due_tasks()

            if not due_tasks:
                return {"executed": 0, "errors": 0}

            logger.info(f"Found {len(due_tasks)} due cron task(s)")

            for task in due_tasks:
                try:
                    await _execute_single_cron_task(session, task)
                    await ops.mark_completed(task.id, status="success")
                    executed += 1
                except Exception as exc:
                    logger.exception(
                        f"Cron task {task.id} ({task.name!r}) failed: {exc}"
                    )
                    await ops.mark_completed(
                        task.id,
                        status="error",
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
    """Execute a single cron task on demand and update its pre-created run log."""
    from sqlalchemy import select

    from uniffy.core.models.agents.cron_run_log import AgentCronRunLog
    from uniffy.core.models.agents.cron_task import AgentCronTask
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

            log_result = await session.execute(
                select(AgentCronRunLog).where(AgentCronRunLog.id == log_uuid)
            )
            run_log = log_result.scalar_one_or_none()
            if not run_log:
                logger.error(f"Run log {run_log_id} not found for on-demand execution")
                return {"status": "error", "error": "Run log not found"}

            session_id = task.session_id
            if not session_id:
                try:
                    session_ops = SessionOperations(session)
                    cron_session = await session_ops.create_session(
                        user_id=task.execution_user_id,
                        organization_id=task.organization_id,
                        agent_id=task.agent_id,
                        kind="cron",
                        display_name=f"Cron: {task.name}",
                    )
                    session_id = cron_session.id
                    task.session_id = session_id
                    run_log.session_id = session_id
                    await session.commit()
                except Exception as exc:
                    await session.rollback()
                    run_log.status = "error"
                    run_log.error = f"Session setup failed: {exc}"
                    run_log.completed_at = datetime.now(UTC)
                    await session.commit()

                    logger.exception(
                        f"On-demand cron task {task_id}: session setup failed: {exc}"
                    )
                    return {"status": "error", "task_id": task_id}

            try:
                runtime_ops = RuntimeOperations(session)
                _user_msg, assistant_msg, _model = await runtime_ops.send_message(
                    user_id=task.execution_user_id,
                    organization_id=task.organization_id,
                    session_id=session_id,
                    content=task.prompt,
                )

                run_log.status = "success"
                run_log.result_summary = (
                    assistant_msg.content[:500] if assistant_msg.content else None
                )
                run_log.input_tokens = assistant_msg.input_tokens or 0
                run_log.output_tokens = assistant_msg.output_tokens or 0
                run_log.completed_at = datetime.now(UTC)
                run_log.session_id = session_id
                await session.commit()

                ops = CronTaskOperations(session)
                await ops.mark_completed(task.id, status="success")

                logger.info(f"On-demand cron task {task_id} ({task.name!r}) completed successfully")
                return {"status": "success", "task_id": task_id}

            except Exception as exc:
                await session.rollback()

                run_log.status = "error"
                run_log.error = str(exc)[:1000]
                run_log.completed_at = datetime.now(UTC)
                await session.commit()

                ops = CronTaskOperations(session)
                await ops.mark_completed(
                    task.id,
                    status="error",
                    error=str(exc)[:500],
                )

                logger.exception(
                    f"On-demand cron task {task_id} ({task.name!r}) failed: {exc}"
                )
                return {"status": "error", "task_id": task_id}

    except Exception:
        logger.exception(
            f"Error in on-demand cron task executor for {task_id}"
        )
        return {"status": "error", "task_id": task_id}


async def _execute_single_cron_task(session, task) -> None:
    """Execute one cron task; always writes an AgentCronRunLog row."""
    from uniffy.core.models.agents.cron_run_log import AgentCronRunLog
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
                kind="cron",
                display_name=f"Cron: {task.name}",
            )
            session_id = cron_session.id
            task.session_id = session_id
            await session.commit()
    except Exception as exc:
        await session.rollback()
        completed_at = datetime.now(UTC)
        run_log = AgentCronRunLog(
            cron_task_id=task.id,
            organization_id=task.organization_id,
            session_id=session_id or task.id,
            status="error",
            error=f"Session setup failed: {exc}",
            started_at=started_at,
            completed_at=completed_at,
        )
        session.add(run_log)
        await session.commit()
        raise

    try:
        runtime_ops = RuntimeOperations(session)
        user_msg, assistant_msg, model = await runtime_ops.send_message(
            user_id=task.execution_user_id,
            organization_id=task.organization_id,
            session_id=session_id,
            content=task.prompt,
        )
    except Exception as exc:
        await session.rollback()
        completed_at = datetime.now(UTC)
        error_text = str(exc)[:1000]
        run_log = AgentCronRunLog(
            cron_task_id=task.id,
            organization_id=task.organization_id,
            session_id=session_id,
            status="error",
            error=error_text,
            started_at=started_at,
            completed_at=completed_at,
        )
        session.add(run_log)
        await session.commit()

        logger.exception(
            f"Cron task {task.id} ({task.name!r}) failed: {error_text}"
        )
        raise

    completed_at = datetime.now(UTC)
    duration_ms = int((completed_at - started_at).total_seconds() * 1000)

    run_log = AgentCronRunLog(
        cron_task_id=task.id,
        organization_id=task.organization_id,
        session_id=session_id,
        status="success",
        result_summary=(assistant_msg.content[:500] if assistant_msg.content else None),
        started_at=started_at,
        completed_at=completed_at,
        input_tokens=assistant_msg.input_tokens or 0,
        output_tokens=assistant_msg.output_tokens or 0,
    )
    session.add(run_log)
    await session.commit()

    logger.info(f"Cron task {task.id} ({task.name!r}) completed successfully in {duration_ms}ms")
