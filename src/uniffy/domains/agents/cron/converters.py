"""Proto <-> domain converters for cron tasks."""

from datetime import timedelta

from uniffy_proto.agents.v1.cron_pb2 import CronRunLogInfo, CronTaskInfo

from uniffy.core.converters import datetime_to_timestamp, optional_timestamp
from uniffy.core.converters.common_proto import (
    access_mode_to_proto,
    content_role_to_proto,
)
from uniffy.core.models.agents.cron_task import AgentCronTask
from uniffy.core.models.agents.run_log import AgentRunLog, AgentRunStatus
from uniffy.core.types import AccessMode, ContentRole


def cron_task_to_proto(
    task: AgentCronTask,
    agent_name: str | None = None,
    effective_access_mode: AccessMode | None = None,
    effective_baseline_role: ContentRole | None = None,
    user_role: ContentRole | None = None,
) -> CronTaskInfo:
    resolved_mode = effective_access_mode if effective_access_mode is not None else task.access_mode
    resolved_baseline = (
        effective_baseline_role if effective_baseline_role is not None else task.baseline_role
    )

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
        access_mode=access_mode_to_proto(resolved_mode) if resolved_mode is not None else 0,
        created_at=datetime_to_timestamp(task.created_at),
    )

    if resolved_baseline is not None:
        info.baseline_role = content_role_to_proto(resolved_baseline)

    if user_role is not None:
        info.user_role = content_role_to_proto(user_role)

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


def cron_run_log_to_proto(log: AgentRunLog) -> CronRunLogInfo:
    """Convert a cron-stamped AgentRunLog row to proto CronRunLogInfo.

    The run log row is written when the execution settles, so ``created_at``
    is the completion time; the start is derived from ``duration_ms``.
    Pending placeholder rows have no completion yet.
    """
    completed = log.created_at if log.status != AgentRunStatus.PENDING else None
    started = log.created_at
    if completed is not None and log.duration_ms:
        started = completed - timedelta(milliseconds=log.duration_ms)

    info = CronRunLogInfo(
        id=str(log.id),
        cron_task_id=str(log.cron_task_id) if log.cron_task_id else "",
        organization_id=str(log.organization_id),
        session_id=str(log.session_id) if log.session_id else "",
        status=log.status,
        input_tokens=log.input_tokens or 0,
        output_tokens=log.output_tokens or 0,
        started_at=datetime_to_timestamp(started),
    )

    if log.error:
        info.error = log.error

    completed_ts = optional_timestamp(completed)
    if completed_ts:
        info.completed_at.CopyFrom(completed_ts)

    return info
