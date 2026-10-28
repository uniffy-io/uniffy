from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from uniffy_proto.projects.v1.time_pb import (
    AggregateGroupBy as ProtoAggregateGroupBy,
)
from uniffy_proto.projects.v1.time_pb import (
    TimePeriodType as ProtoTimePeriodType,
)
from uniffy_proto.projects.v1.time_pb import (
    WorklogSource as ProtoWorklogSource,
)

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.domains.projects.time.converters import (
    day_total_to_proto,
    group_by_from_proto,
    policy_from_proto,
    policy_to_proto,
    worklog_to_proto,
)
from uniffy.domains.projects.time.policy import PeriodType, ResolvedTimePolicy
from uniffy.domains.projects.time.review import DayTotalView
from uniffy.domains.projects.time.worklogs import AggregateGroupBy

ORG = uuid4()


def test_worklog_round_trips_every_field_including_optional_started_at() -> None:
    started = datetime(2026, 10, 22, 9, 30, tzinfo=UTC)
    worklog = Worklog(
        id=uuid4(),
        organization_id=ORG,
        task_id=uuid4(),
        user_id=uuid4(),
        created_by_user_id=uuid4(),
        work_date=date(2026, 10, 22),
        started_at=started,
        duration_minutes=95,
        description="Traced the refresh loop",
        source=WorklogSource.TIMER,
        created_at=started,
        updated_at=started,
    )
    project_id = uuid4()

    proto = worklog_to_proto(worklog, project_id)

    assert proto.id == str(worklog.id)
    assert proto.project_id == str(project_id)
    assert proto.work_date == "2026-10-22"
    assert proto.duration_minutes == 95
    assert proto.source == ProtoWorklogSource.TIMER
    assert proto.has_field("started_at")
    assert proto.started_at.seconds == int(started.timestamp())


def test_manual_worklog_without_started_at_leaves_the_field_unset() -> None:
    worklog = Worklog(
        organization_id=ORG,
        task_id=uuid4(),
        user_id=uuid4(),
        created_by_user_id=uuid4(),
        work_date=date(2026, 10, 22),
        duration_minutes=30,
        source=WorklogSource.MANUAL,
    )
    proto = worklog_to_proto(worklog, uuid4())
    assert proto.source == ProtoWorklogSource.MANUAL
    assert not proto.has_field("started_at")


def test_policy_round_trips_through_proto() -> None:
    policy = ResolvedTimePolicy(
        organization_id=ORG,
        enabled=False,
        period_type=PeriodType.MONTHLY,
        week_start="sunday",
        month_start_day=15,
        approvals_enabled=True,
        lock_on_submit=False,
        period_lock_delay_days=4,
        allow_log_for_others=False,
        required_minutes_per_day=420,
        timer_rounding_minutes=6,
        allow_future_dates=True,
        max_days_back=30,
        max_timer_hours=10,
        auto_submit=True,
        holidays=("2026-12-25",),
        internal_project_id=uuid4(),
        reminders_enabled=True,
        reminder_hour_utc=8,
    )

    proto = policy_to_proto(policy)
    assert proto.period_type == ProtoTimePeriodType.MONTHLY
    assert proto.has_field("max_days_back")
    assert proto.has_field("internal_project_id")
    assert policy_from_proto(ORG, proto) == policy


def test_policy_defaults_round_trip_with_unset_optionals() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG)
    proto = policy_to_proto(policy)
    assert not proto.has_field("max_days_back")
    assert not proto.has_field("internal_project_id")
    assert policy_from_proto(ORG, proto) == policy


def test_policy_from_proto_rejects_an_unspecified_period_type() -> None:
    proto = policy_to_proto(ResolvedTimePolicy(organization_id=ORG))
    proto.period_type = ProtoTimePeriodType.UNSPECIFIED
    with pytest.raises(ValidationError):
        policy_from_proto(ORG, proto)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (ProtoAggregateGroupBy.DAY, AggregateGroupBy.DAY),
        (ProtoAggregateGroupBy.TASK, AggregateGroupBy.TASK),
        (ProtoAggregateGroupBy.USER, AggregateGroupBy.USER),
        (ProtoAggregateGroupBy.PROJECT, AggregateGroupBy.PROJECT),
    ],
)
def test_group_by_maps_every_proto_value(
    value: ProtoAggregateGroupBy, expected: AggregateGroupBy
) -> None:
    assert group_by_from_proto(value) is expected


def test_group_by_rejects_unspecified() -> None:
    with pytest.raises(ValidationError):
        group_by_from_proto(ProtoAggregateGroupBy.UNSPECIFIED)


def test_day_totals_carry_the_off_flag() -> None:
    proto = day_total_to_proto(
        DayTotalView(day=date(2026, 10, 13), minutes=120, required_minutes=240, off=True)
    )
    assert (proto.day, proto.minutes, proto.required_minutes, proto.off) == (
        "2026-10-13",
        120,
        240,
        True,
    )
