"""Time tracking model to proto conversion."""

from __future__ import annotations

from uuid import UUID

from uniffy_proto.projects.v1.time_pb import (
    AggregateGroupBy as ProtoAggregateGroupBy,
)
from uniffy_proto.projects.v1.time_pb import (
    AggregateRow as ProtoAggregateRow,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePeriodType as ProtoTimePeriodType,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePolicy as ProtoTimePolicy,
)
from uniffy_proto.projects.v1.time_pb import (
    Worklog as ProtoWorklog,
)
from uniffy_proto.projects.v1.time_pb import (
    WorklogSource as ProtoWorklogSource,
)

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.domains.projects.time.policy import PeriodType, ResolvedTimePolicy
from uniffy.domains.projects.time.worklogs import AggregateGroupBy, AggregateRow

_SOURCE_TO_PROTO = {
    WorklogSource.MANUAL: ProtoWorklogSource.MANUAL,
    WorklogSource.TIMER: ProtoWorklogSource.TIMER,
    WorklogSource.IMPORT: ProtoWorklogSource.IMPORT,
    WorklogSource.AGENT: ProtoWorklogSource.AGENT,
}

_PERIOD_TO_PROTO = {
    PeriodType.WEEKLY: ProtoTimePeriodType.WEEKLY,
    PeriodType.MONTHLY: ProtoTimePeriodType.MONTHLY,
}
_PERIOD_FROM_PROTO = {value: key for key, value in _PERIOD_TO_PROTO.items()}

_GROUP_BY_FROM_PROTO = {
    ProtoAggregateGroupBy.DAY: AggregateGroupBy.DAY,
    ProtoAggregateGroupBy.TASK: AggregateGroupBy.TASK,
    ProtoAggregateGroupBy.USER: AggregateGroupBy.USER,
    ProtoAggregateGroupBy.PROJECT: AggregateGroupBy.PROJECT,
}


def worklog_to_proto(worklog: Worklog, project_id: UUID) -> ProtoWorklog:
    proto = ProtoWorklog(
        id=str(worklog.id),
        task_id=str(worklog.task_id),
        project_id=str(project_id),
        user_id=str(worklog.user_id),
        created_by_user_id=str(worklog.created_by_user_id),
        work_date=worklog.work_date.isoformat(),
        duration_minutes=worklog.duration_minutes,
        description=worklog.description or "",
        source=_SOURCE_TO_PROTO[WorklogSource(worklog.source)],
        created_at=datetime_to_timestamp(worklog.created_at),
        updated_at=datetime_to_timestamp(worklog.updated_at),
    )
    if worklog.started_at is not None:
        proto.started_at = datetime_to_timestamp(worklog.started_at)
    return proto


def policy_to_proto(policy: ResolvedTimePolicy) -> ProtoTimePolicy:
    proto = ProtoTimePolicy(
        organization_id=str(policy.organization_id),
        enabled=policy.enabled,
        period_type=_PERIOD_TO_PROTO[policy.period_type],
        week_start=policy.week_start,
        month_start_day=policy.month_start_day,
        approvals_enabled=policy.approvals_enabled,
        lock_on_submit=policy.lock_on_submit,
        period_lock_delay_days=policy.period_lock_delay_days,
        allow_log_for_others=policy.allow_log_for_others,
        required_minutes_per_day=policy.required_minutes_per_day,
        timer_rounding_minutes=policy.timer_rounding_minutes,
        allow_future_dates=policy.allow_future_dates,
        max_timer_hours=policy.max_timer_hours,
        auto_submit=policy.auto_submit,
        holidays=list(policy.holidays),
        reminders_enabled=policy.reminders_enabled,
        reminder_hour_utc=policy.reminder_hour_utc,
    )
    if policy.max_days_back is not None:
        proto.max_days_back = policy.max_days_back
    if policy.internal_project_id is not None:
        proto.internal_project_id = str(policy.internal_project_id)
    return proto


def policy_from_proto(organization_id: UUID, proto: ProtoTimePolicy) -> ResolvedTimePolicy:
    period_type = _PERIOD_FROM_PROTO.get(proto.period_type)
    if period_type is None:
        raise ValidationError("period_type", "must be weekly or monthly")
    internal_project_id: UUID | None = None
    if proto.has_field("internal_project_id") and proto.internal_project_id:
        try:
            internal_project_id = UUID(proto.internal_project_id)
        except ValueError as exc:
            raise ValidationError("internal_project_id", "must be a UUID") from exc
    return ResolvedTimePolicy(
        organization_id=organization_id,
        enabled=proto.enabled,
        period_type=period_type,
        week_start=proto.week_start or "monday",
        month_start_day=proto.month_start_day,
        approvals_enabled=proto.approvals_enabled,
        lock_on_submit=proto.lock_on_submit,
        period_lock_delay_days=proto.period_lock_delay_days,
        allow_log_for_others=proto.allow_log_for_others,
        required_minutes_per_day=proto.required_minutes_per_day,
        timer_rounding_minutes=proto.timer_rounding_minutes,
        allow_future_dates=proto.allow_future_dates,
        max_days_back=proto.max_days_back if proto.has_field("max_days_back") else None,
        max_timer_hours=proto.max_timer_hours,
        auto_submit=proto.auto_submit,
        holidays=tuple(proto.holidays),
        internal_project_id=internal_project_id,
        reminders_enabled=proto.reminders_enabled,
        reminder_hour_utc=proto.reminder_hour_utc,
    )


def group_by_from_proto(value: ProtoAggregateGroupBy) -> AggregateGroupBy:
    group_by = _GROUP_BY_FROM_PROTO.get(value)
    if group_by is None:
        raise ValidationError("group_by", "must be day, task, user or project")
    return group_by


def aggregate_row_to_proto(row: AggregateRow) -> ProtoAggregateRow:
    return ProtoAggregateRow(key=row.key, label=row.label, minutes=row.minutes, entries=row.entries)
