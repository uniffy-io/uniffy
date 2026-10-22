from datetime import UTC, date, datetime, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.domains.projects.time.locks import SheetLocks, sheet_is_locked
from uniffy.domains.projects.time.policy import ResolvedTimePolicy

ORG = uuid4()
WORKER = uuid4()
NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
# The week of 2026-10-12 ends on the 18th; with the default two-day delay it locks on the 21st.
PERIOD_END = date(2026, 10, 18)


def _policy(**overrides) -> ResolvedTimePolicy:  # noqa: ANN003
    return ResolvedTimePolicy(organization_id=ORG, **{"approvals_enabled": True, **overrides})


def _sheet(status: TimesheetStatus, grace_until: datetime | None = None) -> Timesheet:
    return Timesheet(
        organization_id=ORG,
        user_id=WORKER,
        period_start=date(2026, 10, 12),
        period_end=PERIOD_END,
        status=status,
        grace_until=grace_until,
    )


@pytest.mark.parametrize(
    ("sheet", "period_closed", "period_end", "policy", "expected"),
    [
        (None, True, date(2026, 12, 31), _policy(approvals_enabled=False), True),
        (
            _sheet(TimesheetStatus.SUBMITTED),
            False,
            date(2026, 12, 31),
            _policy(approvals_enabled=False),
            False,
        ),
        (_sheet(TimesheetStatus.SUBMITTED), False, date(2026, 12, 31), _policy(), True),
        (_sheet(TimesheetStatus.APPROVED), False, date(2026, 12, 31), _policy(), True),
        (
            _sheet(TimesheetStatus.SUBMITTED),
            False,
            date(2026, 12, 31),
            _policy(lock_on_submit=False),
            False,
        ),
        (
            _sheet(TimesheetStatus.SUBMITTED, NOW + timedelta(hours=1)),
            False,
            date(2026, 12, 31),
            _policy(),
            False,
        ),
        (
            _sheet(TimesheetStatus.SUBMITTED, NOW - timedelta(hours=1)),
            False,
            date(2026, 12, 31),
            _policy(),
            True,
        ),
        (None, False, PERIOD_END, _policy(), True),
        (None, False, PERIOD_END, _policy(period_lock_delay_days=5), False),
        (_sheet(TimesheetStatus.REJECTED), False, date(2026, 12, 31), _policy(), False),
        (
            _sheet(TimesheetStatus.REJECTED, NOW + timedelta(days=1)),
            False,
            PERIOD_END,
            _policy(),
            False,
        ),
        (_sheet(TimesheetStatus.OPEN), False, date(2026, 12, 31), _policy(), False),
    ],
)
def test_sheet_is_locked_resolves_closure_grace_submission_and_the_ended_rule(
    sheet: Timesheet | None,
    period_closed: bool,
    period_end: date,
    policy: ResolvedTimePolicy,
    expected: bool,
) -> None:
    assert (
        sheet_is_locked(
            sheet, period_closed=period_closed, period_end=period_end, policy=policy, now=NOW
        )
        is expected
    )


def _compiled(stmt) -> str:  # noqa: ANN001
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


class _Session:
    def __init__(self, *, pairs: list[tuple], closed: list[date], sheets: list[Timesheet]) -> None:
        self.pairs = pairs
        self.closed = closed
        self.sheets = sheets
        self.statements: list = []

    async def execute(self, stmt):  # noqa: ANN001
        self.statements.append(stmt)
        sql = _compiled(stmt)
        result = MagicMock()
        if "projects_worklogs.user_id" in sql:
            result.all.return_value = self.pairs
        elif "projects_time_periods.start_date" in sql:
            result.all.return_value = [(day,) for day in self.closed]
        else:
            result.scalars.return_value.all.return_value = self.sheets
        return result


async def test_locked_periods_for_tasks_reports_closed_and_pending_periods_once() -> None:
    other = uuid4()
    session = _Session(
        pairs=[
            (WORKER, date(2026, 10, 13)),
            (WORKER, date(2026, 10, 14)),
            (other, date(2026, 10, 6)),
        ],
        closed=[date(2026, 10, 5)],
        sheets=[_sheet(TimesheetStatus.APPROVED)],
    )
    policy = _policy(period_lock_delay_days=30)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "uniffy.domains.projects.time.locks.load_time_policy",
            _async_return(policy),
        )
        locked = await SheetLocks(session).locked_periods_for_tasks(ORG, [uuid4()])  # type: ignore[arg-type]
    assert locked == [(date(2026, 10, 5), date(2026, 10, 11)), (date(2026, 10, 12), PERIOD_END)]
    assert len(session.statements) == 3


async def test_locked_periods_for_tasks_skips_the_sheet_query_when_approvals_are_off() -> None:
    session = _Session(pairs=[(WORKER, date(2026, 10, 13))], closed=[], sheets=[])
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(
            "uniffy.domains.projects.time.locks.load_time_policy",
            _async_return(_policy(approvals_enabled=False)),
        )
        locked = await SheetLocks(session).locked_periods_for_tasks(ORG, [uuid4()])  # type: ignore[arg-type]
    assert locked == []
    assert len(session.statements) == 2


def _async_return(value):  # noqa: ANN001, ANN202
    async def _call(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        return value

    return _call
