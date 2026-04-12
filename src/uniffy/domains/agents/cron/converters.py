"""Proto <-> domain converters for cron tasks."""

from uniffy_proto.agents.v1.cron_pb2 import CronRunLogInfo, CronTaskInfo

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.agents.cron_run_log import AgentCronRunLog
from uniffy.core.models.agents.cron_task import AgentCronTask


def cron_task_to_proto(
    task: AgentCronTask,
    agent_name: str | None = None,
) -> CronTaskInfo:
    """Convert AgentCronTask model to proto CronTaskInfo.

    Parameters
    ----------
    task : AgentCronTask
        Database model instance.
    agent_name : str | None
        Optional agent display name.

    Returns
    -------
    CronTaskInfo
        Proto message.

    """
    info = CronTaskInfo(
        id=str(task.id),
        organization_id=str(task.organization_id),
        owner_id=str(task.owner_id),
        agent_id=str(task.agent_id),
        execution_user_id=str(task.execution_user_id),
        name=task.name,
        description=task.description or "",
        prompt=task.prompt,
        cron_expression=task.cron_expression,
        timezone=task.timezone,
        is_enabled=task.is_enabled,
        run_count=task.run_count,
        consecutive_failures=task.consecutive_failures,
        max_consecutive_failures=task.max_consecutive_failures,
        access_mode=access_mode_to_proto(task.access_mode),
        created_at=datetime_to_timestamp(task.created_at),
    )

    if task.baseline_role is not None:
        info.baseline_role = content_role_to_proto(task.baseline_role)

    if task.session_id is not None:
        info.session_id = str(task.session_id)

    last_run_ts = optional_timestamp(task.last_run_at)
    if last_run_ts:
        info.last_run_at.CopyFrom(last_run_ts)

    next_run_ts = optional_timestamp(task.next_run_at)
    if next_run_ts:
        info.next_run_at.CopyFrom(next_run_ts)

    if task.last_run_status:
        info.last_run_status = task.last_run_status

    if task.last_run_error:
        info.last_run_error = task.last_run_error

    updated_ts = optional_timestamp(task.updated_at)
    if updated_ts:
        info.updated_at.CopyFrom(updated_ts)

    if agent_name:
        info.agent_name = agent_name

    return info


def cron_run_log_to_proto(log: AgentCronRunLog) -> CronRunLogInfo:
    """Convert AgentCronRunLog model to proto CronRunLogInfo.

    Parameters
    ----------
    log : AgentCronRunLog
        Database model instance.

    Returns
    -------
    CronRunLogInfo
        Proto message.

    """
    info = CronRunLogInfo(
        id=str(log.id),
        cron_task_id=str(log.cron_task_id),
        organization_id=str(log.organization_id),
        session_id=str(log.session_id),
        status=log.status,
        input_tokens=log.input_tokens or 0,
        output_tokens=log.output_tokens or 0,
        started_at=datetime_to_timestamp(log.started_at),
    )

    if log.agent_run_log_id is not None:
        info.agent_run_log_id = str(log.agent_run_log_id)

    if log.error:
        info.error = log.error

    if log.result_summary:
        info.result_summary = log.result_summary

    completed_ts = optional_timestamp(log.completed_at)
    if completed_ts:
        info.completed_at.CopyFrom(completed_ts)

    return info
