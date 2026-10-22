from contextlib import ExitStack
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.projects.time.timesheets import (
    MAX_GRACE_HOURS,
    RecallCause,
    TimesheetOperations,
)

ORG = uuid4()
WORKER = uuid4()
REVIEWER = uuid4()
MODULE = "uniffy.domains.projects.time.timesheets"
PERIOD_START = date(2026, 10, 12)
PERIOD_END = date(2026, 10, 18)


def _policy(**overrides) -> ResolvedTimePolicy:  # noqa: ANN003
    return ResolvedTimePolicy(organization_id=ORG, **{"approvals_enabled": True, **overrides})


def _sheet(status: TimesheetStatus, **fields) -> Timesheet:  # noqa: ANN003
    return Timesheet(
        id=uuid4(),
        organization_id=ORG,
        user_id=WORKER,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        status=status,
        **fields,
    )


def _compiled(stmt) -> str:  # noqa: ANN001
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


class _Session:
    def __init__(self, sheet: Timesheet | None = None, *, total: int = 0) -> None:
        self.sheet = sheet
        self.total = total
        self.added: list = []
        self.events: list[str] = []
        self.statements: list = []

    async def execute(self, stmt):  # noqa: ANN001
        self.statements.append(stmt)
        sql = _compiled(stmt)
        result = MagicMock()
        if "from projects_timesheets" in sql:
            result.scalars.return_value.first.return_value = self.sheet
        elif "sum(projects_worklogs.duration_minutes)" in sql:
            result.scalar_one.return_value = self.total
        else:
            result.all.return_value = []
            result.scalars.return_value.first.return_value = None
            result.scalar_one_or_none.return_value = None
        return result

    def add(self, obj) -> None:  # noqa: ANN001
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.events.append("commit")


class _Env:
    def __init__(self, stack: ExitStack, session: _Session, access: MagicMock) -> None:
        self.stack = stack
        self.session = session
        self.access = access
        self.audit = AsyncMock()
        self.notify_submitted = AsyncMock()
        self.notify_reviewed = AsyncMock()
        self.notify_grace = AsyncMock()
        self.ops = TimesheetOperations(session)  # type: ignore[arg-type]


def _env(
    sheet: Timesheet | None = None,
    *,
    policy: ResolvedTimePolicy | None = None,
    reviewer: bool = True,
    period_closed: bool = False,
    total: int = 0,
) -> _Env:
    stack = ExitStack()
    session = _Session(sheet, total=total)
    access = MagicMock()
    access.require_active_actor = AsyncMock()
    access.require_active_member = AsyncMock()
    access.require_person_scope = AsyncMock()
    access.require_timekeeping_admin = AsyncMock()
    access.is_reviewer_of = AsyncMock(return_value=reviewer)
    stack.enter_context(patch(f"{MODULE}.TimeAccess", return_value=access))
    stack.enter_context(
        patch(f"{MODULE}.load_time_policy", new=AsyncMock(return_value=policy or _policy()))
    )
    stack.enter_context(
        patch(f"{MODULE}.period_is_closed", new=AsyncMock(return_value=period_closed))
    )
    stack.enter_context(
        patch(f"{MODULE}.workdays_for_users", new=AsyncMock(return_value={WORKER: ("monday",)}))
    )
    env = _Env(stack, session, access)
    stack.enter_context(patch(f"{MODULE}.write_audit_event", new=env.audit))
    stack.enter_context(patch(f"{MODULE}.notify_submitted", new=env.notify_submitted))
    stack.enter_context(patch(f"{MODULE}.notify_reviewed", new=env.notify_reviewed))
    stack.enter_context(patch(f"{MODULE}.notify_grace", new=env.notify_grace))
    return env


async def test_submit_creates_the_row_audits_commits_and_notifies() -> None:
    env = _env()
    with env.stack:
        view = await env.ops.submit(WORKER, ORG, None, date(2026, 10, 14), comment="Done")
    sheet = env.session.added[0]
    assert sheet.status == TimesheetStatus.SUBMITTED
    assert sheet.submitted_by_user_id == WORKER
    assert sheet.submit_comment == "Done"
    assert (sheet.period_start, sheet.period_end) == (PERIOD_START, PERIOD_END)
    assert env.audit.await_args.kwargs["action"] == Action.TIMESHEET_SUBMITTED
    assert env.audit.await_args.kwargs["on_behalf_of_user_id"] is None
    assert env.session.events == ["commit"]
    env.notify_submitted.assert_awaited_once_with(env.session, sheet, WORKER)
    assert view.status == TimesheetStatus.SUBMITTED
    assert view.locked is True
    assert view.required_minutes == 480


async def test_submit_on_behalf_needs_a_reviewer_and_audits_the_subject() -> None:
    env = _env(reviewer=False)
    with env.stack, pytest.raises(PermissionDeniedError):
        await env.ops.submit(REVIEWER, ORG, WORKER, PERIOD_START)
    env = _env(reviewer=True)
    with env.stack:
        await env.ops.submit(REVIEWER, ORG, WORKER, PERIOD_START)
    assert env.audit.await_args.kwargs["on_behalf_of_user_id"] == WORKER
    env.access.require_active_member.assert_awaited_once_with(WORKER, ORG)


async def test_submit_refuses_a_pending_sheet_a_closed_period_and_approvals_off() -> None:
    env = _env(_sheet(TimesheetStatus.SUBMITTED))
    with env.stack, pytest.raises(ValidationError, match="already submitted"):
        await env.ops.submit(WORKER, ORG, None, PERIOD_START)
    env = _env(period_closed=True)
    with env.stack, pytest.raises(ValidationError, match="closed"):
        await env.ops.submit(WORKER, ORG, None, PERIOD_START)
    env = _env(policy=_policy(approvals_enabled=False))
    with env.stack, pytest.raises(ValidationError, match="approvals"):
        await env.ops.submit(WORKER, ORG, None, PERIOD_START)
    assert env.session.events == []


async def test_recall_reopens_a_submitted_sheet_only() -> None:
    sheet = _sheet(TimesheetStatus.SUBMITTED, submitted_by_user_id=WORKER, submit_comment="x")
    env = _env(sheet, policy=_policy(period_lock_delay_days=30))
    with env.stack:
        view = await env.ops.recall(WORKER, ORG, None, date(2026, 10, 16))
    assert sheet.status == TimesheetStatus.OPEN
    assert sheet.submitted_by_user_id is None
    assert sheet.submit_comment == ""
    assert env.audit.await_args.kwargs["action"] == Action.TIMESHEET_RECALLED
    assert env.audit.await_args.kwargs["details"]["cause"] == RecallCause.MANUAL
    assert view.locked is False
    env = _env(_sheet(TimesheetStatus.APPROVED))
    with env.stack, pytest.raises(ValidationError, match="submitted"):
        await env.ops.recall(WORKER, ORG, None, PERIOD_START)


async def test_approve_requires_a_reviewer_who_is_not_the_worker() -> None:
    sheet = _sheet(TimesheetStatus.SUBMITTED)
    env = _env(sheet)
    with env.stack, pytest.raises(PermissionDeniedError, match="own"):
        await env.ops.approve(WORKER, ORG, sheet.id)
    env = _env(sheet, reviewer=False)
    with env.stack, pytest.raises(PermissionDeniedError, match="review"):
        await env.ops.approve(REVIEWER, ORG, sheet.id)
    assert env.session.events == []


async def test_approve_marks_the_sheet_clears_grace_audits_and_notifies_the_worker() -> None:
    sheet = _sheet(TimesheetStatus.SUBMITTED, grace_until=datetime.now(UTC) + timedelta(hours=2))
    env = _env(sheet)
    with env.stack:
        view = await env.ops.approve(REVIEWER, ORG, sheet.id, comment="Looks right")
    assert sheet.status == TimesheetStatus.APPROVED
    assert sheet.reviewer_user_id == REVIEWER
    assert sheet.grace_until is None
    assert sheet.review_comment == "Looks right"
    assert env.audit.await_args.kwargs["action"] == Action.TIMESHEET_APPROVED
    env.notify_reviewed.assert_awaited_once_with(sheet, REVIEWER, approved=True)
    assert env.session.events == ["commit"]
    assert view.can_review is True


async def test_reject_needs_a_reason_and_reopens_a_locked_period_for_the_delay() -> None:
    sheet = _sheet(TimesheetStatus.SUBMITTED)
    env = _env(sheet)
    with env.stack, pytest.raises(ValidationError, match="reason"):
        await env.ops.reject(REVIEWER, ORG, sheet.id, comment="  ")
    env = _env(sheet)
    with env.stack:
        await env.ops.reject(REVIEWER, ORG, sheet.id, comment="Missing Friday")
    assert sheet.status == TimesheetStatus.REJECTED
    assert sheet.grace_until is not None
    assert sheet.grace_until > datetime.now(UTC) + timedelta(days=1, hours=23)
    assert env.audit.await_args.kwargs["action"] == Action.TIMESHEET_REJECTED
    env.notify_reviewed.assert_awaited_once_with(sheet, REVIEWER, approved=False)


async def test_reject_leaves_grace_alone_while_the_period_is_still_open() -> None:
    sheet = _sheet(TimesheetStatus.SUBMITTED)
    env = _env(sheet, policy=_policy(period_lock_delay_days=30))
    with env.stack:
        await env.ops.reject(REVIEWER, ORG, sheet.id, comment="Missing Friday")
    assert sheet.grace_until is None


async def test_grant_grace_creates_the_row_and_bounds_the_hours() -> None:
    env = _env()
    with env.stack, pytest.raises(ValidationError, match="hours"):
        await env.ops.grant_grace(REVIEWER, ORG, WORKER, PERIOD_START, hours=MAX_GRACE_HOURS + 1)
    env = _env()
    with env.stack, pytest.raises(PermissionDeniedError):
        await env.ops.grant_grace(WORKER, ORG, WORKER, PERIOD_START, hours=4)
    env = _env()
    with env.stack:
        view = await env.ops.grant_grace(REVIEWER, ORG, WORKER, PERIOD_START, hours=4)
    sheet = env.session.added[0]
    assert sheet.status == TimesheetStatus.OPEN
    assert sheet.grace_until > datetime.now(UTC) + timedelta(hours=3, minutes=59)
    assert env.audit.await_args.kwargs["action"] == Action.TIMESHEET_GRACE_GRANTED
    assert env.audit.await_args.kwargs["details"]["hours"] == 4
    env.notify_grace.assert_awaited_once_with(sheet, REVIEWER, 4)
    assert view.locked is False


async def test_stage_after_write_returns_an_approved_sheet_for_review() -> None:
    sheet = _sheet(TimesheetStatus.APPROVED, reviewed_at=datetime.now(UTC), review_comment="ok")
    env = _env(sheet)
    with env.stack:
        await env.ops.stage_after_write(REVIEWER, ORG, WORKER, date(2026, 10, 13), policy=_policy())
    assert sheet.status == TimesheetStatus.SUBMITTED
    assert sheet.reviewed_at is None
    assert sheet.review_comment == ""
    details = env.audit.await_args.kwargs["details"]
    assert details["cause"] == RecallCause.EDIT
    assert details["previous_status"] == TimesheetStatus.APPROVED
    assert env.session.events == []


async def test_stage_after_write_recalls_a_submitted_sheet_only_without_lock_on_submit() -> None:
    sheet = _sheet(TimesheetStatus.SUBMITTED)
    env = _env(sheet)
    with env.stack:
        await env.ops.stage_after_write(WORKER, ORG, WORKER, PERIOD_START, policy=_policy())
    assert sheet.status == TimesheetStatus.SUBMITTED
    env.audit.assert_not_awaited()
    env = _env(sheet)
    with env.stack:
        await env.ops.stage_after_write(
            WORKER, ORG, WORKER, PERIOD_START, policy=_policy(lock_on_submit=False)
        )
    assert sheet.status == TimesheetStatus.OPEN
    assert env.audit.await_args.kwargs["details"]["cause"] == RecallCause.EDIT


async def test_stage_after_write_ignores_open_sheets_and_approvals_off() -> None:
    env = _env(_sheet(TimesheetStatus.OPEN))
    with env.stack:
        await env.ops.stage_after_write(WORKER, ORG, WORKER, PERIOD_START, policy=_policy())
    env.audit.assert_not_awaited()
    env = _env(_sheet(TimesheetStatus.APPROVED))
    with env.stack:
        await env.ops.stage_after_write(
            WORKER, ORG, WORKER, PERIOD_START, policy=_policy(approvals_enabled=False)
        )
    assert env.session.statements == []


async def test_get_resolves_the_period_from_any_day_and_gates_on_person_scope() -> None:
    env = _env(total=600)
    with env.stack:
        view = await env.ops.get(REVIEWER, ORG, WORKER, date(2026, 10, 17))
    env.access.require_person_scope.assert_awaited_once_with(REVIEWER, ORG, WORKER)
    assert (view.period_start, view.period_end) == (PERIOD_START, PERIOD_END)
    assert view.status == TimesheetStatus.OPEN
    assert view.timesheet is None
    assert view.total_minutes == 600
    assert view.can_review is True
