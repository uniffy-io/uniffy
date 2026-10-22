from contextlib import ExitStack
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.core.types import NotificationType
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.projects.time.reminders import (
    AUTO_SUBMIT_COMMENT,
    process_period_schedule,
)

ORG = uuid4()
ALICE = uuid4()
BOB = uuid4()
MODULE = "uniffy.domains.projects.time.reminders"
# Wednesday after the week of 2026-10-12 ended on the 18th; the default delay locks it today.
NOW = datetime(2026, 10, 21, 9, 30, tzinfo=UTC)


def _compiled(stmt) -> str:  # noqa: ANN001
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


class _Session:
    def __init__(self, *, entries: set, sheets: list, notified: int = 0) -> None:
        self.entries = entries
        self.sheets = sheets
        self.notified = notified
        self.events: list[str] = []
        self.added: list = []
        self.statements: list = []

    async def execute(self, stmt):  # noqa: ANN001
        self.statements.append(stmt)
        sql = _compiled(stmt)
        result = MagicMock()
        if "from org_settings" in sql:
            result.all.return_value = [(ORG,)]
        elif "from projects_worklogs" in sql:
            result.all.return_value = [(user_id,) for user_id in sorted(self.entries)]
        elif "from projects_timesheets" in sql and "count" not in sql:
            result.scalars.return_value.all.return_value = self.sheets
            result.scalars.return_value.first.return_value = next(
                (s for s in self.sheets if f"'{s.user_id.hex}'" in sql), None
            )
        elif "from notifications" in sql:
            result.scalar_one.return_value = self.notified
        else:
            result.scalars.return_value.first.return_value = None
            result.scalar_one_or_none.return_value = None
            result.all.return_value = []
        return result

    def add(self, obj) -> None:  # noqa: ANN001
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.events.append("commit")


def _sheet(user_id, status: TimesheetStatus) -> Timesheet:  # noqa: ANN001
    return Timesheet(
        id=uuid4(),
        organization_id=ORG,
        user_id=user_id,
        period_start=date(2026, 10, 12),
        period_end=date(2026, 10, 18),
        status=status,
    )


def _stack(
    policy: ResolvedTimePolicy, *, reviewers: set | None = None
) -> tuple[ExitStack, AsyncMock, AsyncMock, AsyncMock]:
    stack = ExitStack()
    stack.enter_context(patch(f"{MODULE}.load_time_policy", new=AsyncMock(return_value=policy)))
    stack.enter_context(patch(f"{MODULE}.period_is_closed", new=AsyncMock(return_value=False)))
    emit = AsyncMock()
    stack.enter_context(patch(f"{MODULE}.emit_notification", new=emit))
    notify_submitted = AsyncMock()
    stack.enter_context(patch(f"{MODULE}.notify_submitted", new=notify_submitted))
    audit = AsyncMock()
    stack.enter_context(
        patch("uniffy.domains.projects.time.timesheets.write_audit_event", new=audit)
    )
    stack.enter_context(
        patch(
            "uniffy.domains.projects.time.timesheets.period_is_closed",
            new=AsyncMock(return_value=False),
        )
    )
    access = MagicMock()
    access.review_recipients = AsyncMock(return_value=reviewers or set())
    stack.enter_context(patch(f"{MODULE}.TimeAccess", return_value=access))
    return stack, emit, notify_submitted, audit


async def test_auto_submit_submits_open_sheets_with_entries_once_the_lock_is_due() -> None:
    policy = ResolvedTimePolicy(organization_id=ORG, approvals_enabled=True, auto_submit=True)
    session = _Session(entries={ALICE, BOB}, sheets=[_sheet(BOB, TimesheetStatus.REJECTED)])
    stack, emit, notify_submitted, audit = _stack(policy)
    with stack:
        summary = await process_period_schedule(session, NOW)  # type: ignore[arg-type]
    # Both ended periods inside the recovery window are due, so Alice gets one sheet each.
    assert summary.submitted == 2
    assert [sheet.period_start for sheet in session.added] == [date(2026, 10, 12), date(2026, 10, 5)]
    for sheet in session.added:
        assert sheet.user_id == ALICE
        assert sheet.status == TimesheetStatus.SUBMITTED
        assert sheet.submitted_by_user_id is None
        assert sheet.submit_comment == AUTO_SUBMIT_COMMENT
    assert session.events == ["commit"]
    assert notify_submitted.await_count == 2
    assert audit.await_args.kwargs["actor_user_id"] is None
    emit.assert_not_awaited()


async def test_auto_submit_waits_for_the_lock_date() -> None:
    policy = ResolvedTimePolicy(
        organization_id=ORG, approvals_enabled=True, auto_submit=True, period_lock_delay_days=10
    )
    session = _Session(entries={ALICE}, sheets=[])
    stack, _, notify_submitted, _ = _stack(policy)
    with stack:
        summary = await process_period_schedule(session, NOW)  # type: ignore[arg-type]
    assert summary.submitted == 0
    assert session.added == []
    notify_submitted.assert_not_awaited()


async def test_reminders_go_out_at_the_hour_to_workers_and_reviewers_once_a_day() -> None:
    policy = ResolvedTimePolicy(
        organization_id=ORG, approvals_enabled=True, reminders_enabled=True, reminder_hour_utc=9
    )
    reviewer = uuid4()
    session = _Session(entries={ALICE, BOB}, sheets=[_sheet(BOB, TimesheetStatus.SUBMITTED)])
    stack, emit, _, _ = _stack(policy, reviewers={reviewer})
    with stack:
        summary = await process_period_schedule(session, NOW)  # type: ignore[arg-type]
    assert (summary.worker_reminders, summary.reviewer_reminders) == (1, 1)
    events = [call.args[0] for call in emit.await_args_list]
    assert [event.target_user_ids for event in events] == [[ALICE], [reviewer]]
    assert all(event.notification_type == NotificationType.TIMESHEET_REMINDER for event in events)
    assert "2026-10-12 to 2026-10-18" in events[0].title
    assert events[1].title.startswith("1 timesheet waiting")

    session = _Session(entries={ALICE}, sheets=[], notified=1)
    stack, emit, _, _ = _stack(policy)
    with stack:
        summary = await process_period_schedule(session, NOW)  # type: ignore[arg-type]
    assert summary.worker_reminders == 0
    emit.assert_not_awaited()


async def test_the_schedule_skips_orgs_with_approvals_off_and_other_hours() -> None:
    session = _Session(entries={ALICE}, sheets=[])
    stack, emit, _, _ = _stack(ResolvedTimePolicy(organization_id=ORG, reminders_enabled=True))
    with stack:
        summary = await process_period_schedule(session, NOW)  # type: ignore[arg-type]
    assert summary.organizations == 0
    policy = ResolvedTimePolicy(
        organization_id=ORG, approvals_enabled=True, reminders_enabled=True, reminder_hour_utc=17
    )
    stack, emit, _, _ = _stack(policy)
    with stack:
        summary = await process_period_schedule(session, NOW)  # type: ignore[arg-type]
    assert summary.organizations == 1
    assert summary.worker_reminders == 0
    emit.assert_not_awaited()
