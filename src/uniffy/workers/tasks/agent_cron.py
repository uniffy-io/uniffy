"""Agent cron task executor.

Runs every minute via ARQ cron. Finds due scheduled tasks and
executes them by calling RuntimeOperations.send_message() with
the stored user identity. The full 3-layer permission chain is
enforced at execution time.

Also provides ``execute_single_agent_cron_task`` for on-demand
triggering via the "Run Now" button. Both paths share the same
``_execute_single_cron_task`` core logic.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.db import open_session


async def execute_agent_cron_tasks(ctx: dict[str, Any]) -> dict[str, Any]:
    """Cron task: find and execute due agent cron tasks.

    For each due task:
    1. Verify execution_user is still active and an org member
    2. Create or reuse a dedicated cron session
    3. Call RuntimeOperations.send_message() with stored user identity
    4. Log the result, update task state, notify user

    Parameters
    ----------
    ctx : dict
        ARQ worker context.

    Returns
    -------
    dict
        Summary of executed tasks.

    """
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
                    logger.error(
                        f"Cron task {task.id} ({task.name!r}) failed: {exc}",
                        exc_info=True,
                    )
                    await ops.mark_completed(
                        task.id,
                        status="error",
                        error=str(exc)[:500],
                    )
                    errors += 1

    except Exception:
        logger.error("Error in cron task executor", exc_info=True)

    if executed or errors:
        logger.info(f"Cron executor: {executed} succeeded, {errors} failed")

    return {"executed": executed, "errors": errors}


async def execute_single_agent_cron_task(
    ctx: dict[str, Any],
    task_id: str,
    run_log_id: str,
) -> dict[str, Any]:
    """Execute a single cron task on demand via the worker.

    Enqueued by ``CronTaskOperations.trigger_now()`` when a user
    clicks "Run Now". Receives the ID of a pre-created "pending"
    run log entry and updates it with the execution result.

    Parameters
    ----------
    ctx : dict
        ARQ worker context.
    task_id : str
        UUID of the cron task to execute.
    run_log_id : str
        UUID of the pre-created "pending" run log to update with results.

    Returns
    -------
    dict
        Execution result summary.

    """
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
            # Load task
            result = await session.execute(
                select(AgentCronTask).where(AgentCronTask.id == task_uuid)
            )
            task = result.scalar_one_or_none()
            if not task:
                logger.error(f"Cron task {task_id} not found for on-demand execution")
                return {"status": "error", "error": "Task not found"}

            # Load the pre-created run log
            log_result = await session.execute(
                select(AgentCronRunLog).where(AgentCronRunLog.id == log_uuid)
            )
            run_log = log_result.scalar_one_or_none()
            if not run_log:
                logger.error(f"Run log {run_log_id} not found for on-demand execution")
                return {"status": "error", "error": "Run log not found"}

            # Ensure dedicated cron session exists
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

                    logger.error(
                        f"On-demand cron task {task_id}: session setup failed: {exc}",
                        exc_info=True,
                    )
                    return {"status": "error", "task_id": task_id}

            # Execute via RuntimeOperations - full permission chain applies
            try:
                runtime_ops = RuntimeOperations(session)
                _user_msg, assistant_msg, _model = await runtime_ops.send_message(
                    user_id=task.execution_user_id,
                    organization_id=task.organization_id,
                    session_id=session_id,
                    content=task.prompt,
                )

                # Update run log with success
                run_log.status = "success"
                run_log.result_summary = (
                    assistant_msg.content[:500] if assistant_msg.content else None
                )
                run_log.input_tokens = assistant_msg.input_tokens or 0
                run_log.output_tokens = assistant_msg.output_tokens or 0
                run_log.completed_at = datetime.now(UTC)
                run_log.session_id = session_id
                await session.commit()

                # Update task state
                ops = CronTaskOperations(session)
                await ops.mark_completed(task.id, status="success")

                logger.info(f"On-demand cron task {task_id} ({task.name!r}) completed successfully")
                return {"status": "success", "task_id": task_id}

            except Exception as exc:
                await session.rollback()

                # Update run log with error
                run_log.status = "error"
                run_log.error = str(exc)[:1000]
                run_log.completed_at = datetime.now(UTC)
                await session.commit()

                # Update task state
                ops = CronTaskOperations(session)
                await ops.mark_completed(
                    task.id,
                    status="error",
                    error=str(exc)[:500],
                )

                logger.error(
                    f"On-demand cron task {task_id} ({task.name!r}) failed: {exc}",
                    exc_info=True,
                )
                return {"status": "error", "task_id": task_id}

    except Exception:
        logger.error(
            f"Error in on-demand cron task executor for {task_id}",
            exc_info=True,
        )
        return {"status": "error", "task_id": task_id}


async def _execute_single_cron_task(session, task) -> None:
    """Execute a single cron task with full permission chain.

    Permission checks happen inside RuntimeOperations.send_message():
    1. require_org_member(task.execution_user_id, task.organization_id)
    2. AgentOperations.get_by_id() - 3-layer check on the agent
    3. Each tool call uses ToolContext(user_id=task.execution_user_id)

    Always creates an AgentCronRunLog entry, regardless of success or
    failure, so execution history is always available in the UI.

    Parameters
    ----------
    session : AsyncSession
        Database session.
    task : AgentCronTask
        The cron task to execute.

    """
    from uniffy.core.models.agents.cron_run_log import AgentCronRunLog
    from uniffy.domains.agents.runtime.operations import RuntimeOperations
    from uniffy.domains.agents.sessions.operations import SessionOperations

    started_at = datetime.now(UTC)
    session_id = task.session_id

    # Ensure dedicated cron session exists
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
            # Store session_id on the task for future runs
            task.session_id = session_id
            await session.commit()
    except Exception as exc:
        # Session creation failed - log it and re-raise
        await session.rollback()
        completed_at = datetime.now(UTC)
        run_log = AgentCronRunLog(
            cron_task_id=task.id,
            organization_id=task.organization_id,
            session_id=session_id or task.id,  # fallback if no session yet
            status="error",
            error=f"Session setup failed: {exc}",
            started_at=started_at,
            completed_at=completed_at,
        )
        session.add(run_log)
        await session.commit()
        raise

    # Execute via RuntimeOperations - full permission chain applies
    try:
        runtime_ops = RuntimeOperations(session)
        user_msg, assistant_msg, model = await runtime_ops.send_message(
            user_id=task.execution_user_id,
            organization_id=task.organization_id,
            session_id=session_id,
            content=task.prompt,
        )
    except Exception as exc:
        # LLM / tool execution failed - create error run log
        # Rollback any dirty session state before writing the log
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

        logger.error(
            f"Cron task {task.id} ({task.name!r}) failed: {error_text}",
            exc_info=True,
        )
        raise

    completed_at = datetime.now(UTC)
    duration_ms = int((completed_at - started_at).total_seconds() * 1000)

    # Create success run log
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
