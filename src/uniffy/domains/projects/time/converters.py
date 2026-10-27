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
    DayTotal as ProtoDayTotal,
)
from uniffy_proto.projects.v1.time_pb import (
    GetSprintCapacityResponse,
    SprintCapacityRow,
)
from uniffy_proto.projects.v1.time_pb import (
    ReviewTimesheetRow as ProtoReviewTimesheetRow,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePeriod as ProtoTimePeriod,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePeriodStatus as ProtoTimePeriodStatus,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePeriodType as ProtoTimePeriodType,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePolicy as ProtoTimePolicy,
)
from uniffy_proto.projects.v1.time_pb import (
    Timer as ProtoTimer,
)
from uniffy_proto.projects.v1.time_pb import (
    TimerPauseReason as ProtoTimerPauseReason,
)
from uniffy_proto.projects.v1.time_pb import (
    Timesheet as ProtoTimesheet,
)
from uniffy_proto.projects.v1.time_pb import (
    TimesheetStatus as ProtoTimesheetStatus,
)
from uniffy_proto.projects.v1.time_pb import (
    Worklog as ProtoWorklog,
)
from uniffy_proto.projects.v1.time_pb import (
    WorklogSource as ProtoWorklogSource,
)

from uniffy.core.converters.proto import datetime_to_timestamp
from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.timer import TimerPauseReason
from uniffy.core.models.projects.timesheet import TimePeriodStatus, TimesheetStatus
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.domains.projects.time.closures import PeriodView
from uniffy.domains.projects.time.policy import PeriodType, ResolvedTimePolicy
from uniffy.domains.projects.time.review import DayTotalView, ReviewRow
from uniffy.domains.projects.time.sprint_capacity import SprintCapacity
from uniffy.domains.projects.time.timers import TimerRow
from uniffy.domains.projects.time.timesheets import SheetView
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


def timer_to_proto(row: TimerRow) -> ProtoTimer:
    timer = row.timer
    proto = ProtoTimer(
        id=str(timer.id),
        task_id=str(timer.task_id),
        project_id=str(row.project_id),
        description=timer.description,
        accumulated_seconds=timer.accumulated_seconds,
        pause_reason=(
            ProtoTimerPauseReason.LIMIT
            if timer.pause_reason == TimerPauseReason.LIMIT
            else ProtoTimerPauseReason.UNSPECIFIED
        ),
        task_title=row.task_title,
        task_number=row.task_number,
        project_slug=row.project_slug,
    )
    if timer.started_at is not None:
        proto.started_at = datetime_to_timestamp(timer.started_at)
    if timer.paused_at is not None:
        proto.paused_at = datetime_to_timestamp(timer.paused_at)
    return proto


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


_SHEET_STATUS_TO_PROTO = {
    TimesheetStatus.OPEN: ProtoTimesheetStatus.OPEN,
    TimesheetStatus.SUBMITTED: ProtoTimesheetStatus.SUBMITTED,
    TimesheetStatus.APPROVED: ProtoTimesheetStatus.APPROVED,
    TimesheetStatus.REJECTED: ProtoTimesheetStatus.REJECTED,
}
_SHEET_STATUS_FROM_PROTO = {value: key for key, value in _SHEET_STATUS_TO_PROTO.items()}

_PERIOD_STATUS_TO_PROTO = {
    TimePeriodStatus.OPEN: ProtoTimePeriodStatus.OPEN,
    TimePeriodStatus.CLOSED: ProtoTimePeriodStatus.CLOSED,
}


def timesheet_status_from_proto(value: ProtoTimesheetStatus) -> TimesheetStatus:
    status = _SHEET_STATUS_FROM_PROTO.get(value)
    if status is None:
        raise ValidationError("status", "must be open, submitted, approved or rejected")
    return status


def timesheet_to_proto(view: SheetView) -> ProtoTimesheet:
    sheet = view.timesheet
    proto = ProtoTimesheet(
        id=str(sheet.id) if sheet is not None else "",
        user_id=str(view.user_id),
        period_start=view.period_start.isoformat(),
        period_end=view.period_end.isoformat(),
        status=_SHEET_STATUS_TO_PROTO[TimesheetStatus(view.status)],
        submit_comment=sheet.submit_comment if sheet is not None else "",
        review_comment=sheet.review_comment if sheet is not None else "",
        locked=view.locked,
        period_closed=view.period_closed,
        can_review=view.can_review,
        total_minutes=view.total_minutes,
        required_minutes=view.required_minutes,
        reviewer_user_ids=[str(user_id) for user_id in view.reviewer_ids],
    )
    if sheet is None:
        return proto
    if sheet.submitted_to_user_id is not None:
        proto.submitted_to_user_id = str(sheet.submitted_to_user_id)
    if sheet.submitted_at is not None:
        proto.submitted_at = datetime_to_timestamp(sheet.submitted_at)
    if sheet.submitted_by_user_id is not None:
        proto.submitted_by_user_id = str(sheet.submitted_by_user_id)
    if sheet.reviewer_user_id is not None:
        proto.reviewer_user_id = str(sheet.reviewer_user_id)
    if sheet.reviewed_at is not None:
        proto.reviewed_at = datetime_to_timestamp(sheet.reviewed_at)
    if sheet.grace_until is not None:
        proto.grace_until = datetime_to_timestamp(sheet.grace_until)
    return proto


def period_to_proto(view: PeriodView) -> ProtoTimePeriod:
    proto = ProtoTimePeriod(
        id=str(view.period.id) if view.period is not None else "",
        start_date=view.start_date.isoformat(),
        end_date=view.end_date.isoformat(),
        status=_PERIOD_STATUS_TO_PROTO[TimePeriodStatus(view.status)],
    )
    if view.period is not None and view.period.closed_by_user_id is not None:
        proto.closed_by_user_id = str(view.period.closed_by_user_id)
    if view.period is not None and view.period.closed_at is not None:
        proto.closed_at = datetime_to_timestamp(view.period.closed_at)
    return proto


def day_total_to_proto(total: DayTotalView) -> ProtoDayTotal:
    return ProtoDayTotal(
        day=total.day.isoformat(),
        minutes=total.minutes,
        required_minutes=total.required_minutes,
        off=total.off,
    )


def sprint_capacity_to_proto(capacity: SprintCapacity) -> GetSprintCapacityResponse:
    return GetSprintCapacityResponse(
        rows=[
            SprintCapacityRow(
                user_id=str(row.user_id),
                capacity_minutes=row.capacity_minutes,
                estimated_minutes=row.estimated_minutes,
                logged_minutes=row.logged_minutes,
            )
            for row in capacity.rows
        ],
        capacity_minutes=capacity.capacity_minutes,
        estimated_minutes=capacity.estimated_minutes,
        logged_minutes=capacity.logged_minutes,
    )


def review_row_to_proto(row: ReviewRow) -> ProtoReviewTimesheetRow:
    return ProtoReviewTimesheetRow(
        user_id=str(row.sheet.user_id),
        status=_SHEET_STATUS_TO_PROTO[TimesheetStatus(row.sheet.status)],
        period_minutes=row.sheet.total_minutes,
        required_minutes=row.sheet.required_minutes,
        days=[day_total_to_proto(total) for total in row.days],
        timesheet=timesheet_to_proto(row.sheet),
    )
