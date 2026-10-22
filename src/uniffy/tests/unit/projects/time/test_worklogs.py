from contextlib import ExitStack
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.domains.projects.time import cleanup
from uniffy.domains.projects.time.policy import ResolvedTimePolicy
from uniffy.domains.projects.time.worklogs import (
    MAX_TASK_PAGE_SIZE,
    AggregateGroupBy,
    WorklogOperations,
)

ORG = uuid4()
ACTOR = uuid4()
OTHER = uuid4()
TASK_ID = uuid4()
PROJECT_ID = uuid4()
TODAY = datetime.now(UTC).date()
MODULE = "uniffy.domains.projects.time.worklogs"


def _compiled(stmt) -> str:  # noqa: ANN001 - SQLAlchemy statement
    return str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()


class _Session:
    """Answers the three statement shapes the operations issue, in any order."""

    def __init__(self, *, logged: int = 0, rollup: int | None = 30, existing=None) -> None:  # noqa: ANN001
        self.statements: list = []
        self.added: list = []
        self.events: list[str] = []
        self.logged = logged
        self.rollup = rollup
        self.existing = existing

    async def execute(self, stmt):  # noqa: ANN001 - SQLAlchemy statement
        self.statements.append(stmt)
        sql = _compiled(stmt)
        result = MagicMock()
        if sql.startswith("update projects_tasks"):
            result.scalar_one.return_value = self.rollup
        elif "sum(projects_worklogs.duration_minutes)" in sql:
            result.scalar_one.return_value = self.logged
        else:
            result.first.return_value = self.existing
            result.scalars.return_value.all.return_value = []
            result.all.return_value = []
        return result

    def add(self, obj) -> None:  # noqa: ANN001
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def refresh(self, obj) -> None:  # noqa: ANN001
        self.events.append("refresh")

    async def commit(self) -> None:
        self.events.append("commit")


class _Env(SimpleNamespace):
    pass


def _env(
    policy: ResolvedTimePolicy | None = None,
    *,
    logged: int = 0,
    rollup: int | None = 30,
    locked: bool = False,
    admin: bool = False,
    reviewer: bool = False,
    existing=None,  # noqa: ANN001
) -> ExitStack:
    stack = ExitStack()
    session = _Session(logged=logged, rollup=rollup, existing=existing)
    task = SimpleNamespace(id=TASK_ID, project_id=PROJECT_ID)
    access = MagicMock()
    access.require_task_view = AsyncMock(return_value=task)
    access.is_timekeeping_admin = AsyncMock(return_value=admin)
    access.is_reviewer_of = AsyncMock(return_value=reviewer)
    access.require_active_member = AsyncMock()
    access.require_active_actor = AsyncMock()
    access.require_person_scope = AsyncMock()
    access.require_project_view = AsyncMock()
    locks = MagicMock()
    locks.is_locked = AsyncMock(return_value=locked)
    timesheets = MagicMock()
    timesheets.stage_after_write = AsyncMock()
    notifications = MagicMock()
    notifications.log_activity = AsyncMock()
    audit = AsyncMock()
    publish = AsyncMock(side_effect=lambda *_: session.events.append("publish"))

    stack.enter_context(
        patch(
            f"{MODULE}.load_time_policy",
            new=AsyncMock(return_value=policy or ResolvedTimePolicy(organization_id=ORG)),
        )
    )
    stack.enter_context(patch(f"{MODULE}.TimeAccess", return_value=access))
    stack.enter_context(patch(f"{MODULE}.SheetLocks", return_value=locks))
    stack.enter_context(patch(f"{MODULE}.TimesheetOperations", return_value=timesheets))
    stack.enter_context(patch(f"{MODULE}.TaskNotifications", return_value=notifications))
    stack.enter_context(patch(f"{MODULE}.write_audit_event", new=audit))
    stack.enter_context(patch(f"{MODULE}.publish_content_changed", new=publish))
    stack.env = _Env(  # type: ignore[attr-defined]
        session=session,
        access=access,
        notifications=notifications,
        audit=audit,
        publish=publish,
        ops=WorklogOperations(session),  # type: ignore[arg-type]
    )
    return stack


async def test_create_inserts_recomputes_rollup_logs_activity_then_commits_and_publishes() -> None:
    with _env(rollup=45) as stack:
        env = stack.env
        row, rollup = await env.ops.create(
            ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=45, description="Review"
        )

    worklog = env.session.added[0]
    assert isinstance(worklog, Worklog)
    assert row.worklog is worklog
    assert row.project_id == PROJECT_ID
    assert (worklog.user_id, worklog.created_by_user_id) == (ACTOR, ACTOR)
    assert worklog.source == WorklogSource.MANUAL
    assert rollup == 45
    env.notifications.log_activity.assert_awaited_once_with(
        TASK_ID, ACTOR, "time_logged", new_value="45"
    )
    env.audit.assert_not_awaited()
    assert env.session.events == ["commit", "publish"]
    rollup_sql = next(s for s in map(_compiled, env.session.statements) if "update" in s)
    assert "sum(projects_worklogs.duration_minutes)" in rollup_sql
    assert "nullif" in rollup_sql
    assert "projects_worklogs.is_deleted is false" in rollup_sql
    assert "version + 1" in rollup_sql
    assert "returning projects_tasks.time_spent_minutes" in rollup_sql


async def test_rollup_reports_zero_when_the_task_has_no_live_entries() -> None:
    with _env(rollup=None) as stack:
        _, rollup = await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=10
        )
    assert rollup == 0


async def test_create_rejects_when_time_tracking_is_disabled() -> None:
    with (
        _env(ResolvedTimePolicy(organization_id=ORG, enabled=False)) as stack,
        pytest.raises(ValidationError) as exc_info,
    ):
        await stack.env.ops.create(ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=10)
    assert exc_info.value.field == "time_tracking"


@pytest.mark.parametrize("minutes", [0, -5, 1441])
async def test_create_rejects_durations_outside_one_to_1440(minutes: int) -> None:
    with _env() as stack, pytest.raises(ValidationError) as exc_info:
        await stack.env.ops.create(ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=minutes)
    assert exc_info.value.field == "duration_minutes"


async def test_create_enforces_the_daily_cap_across_existing_entries() -> None:
    with _env(logged=1400) as stack, pytest.raises(ValidationError) as exc_info:
        await stack.env.ops.create(ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=41)
    assert "1441" in exc_info.value.message

    with _env(logged=1400) as stack:
        await stack.env.ops.create(ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=40)


async def test_create_honours_future_and_back_windows_with_a_zone_tolerance() -> None:
    with _env() as stack:
        await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, work_date=TODAY + timedelta(days=1), duration_minutes=10
        )
    with _env() as stack, pytest.raises(ValidationError):
        await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, work_date=TODAY + timedelta(days=2), duration_minutes=10
        )

    policy = ResolvedTimePolicy(organization_id=ORG, max_days_back=7)
    with _env(policy) as stack:
        await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, work_date=TODAY - timedelta(days=8), duration_minutes=10
        )
    with _env(policy) as stack, pytest.raises(ValidationError):
        await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, work_date=TODAY - timedelta(days=9), duration_minutes=10
        )


async def test_imported_history_is_exempt_from_the_caps() -> None:
    with _env(logged=1400) as stack:
        row, _ = await stack.env.ops.create(
            ACTOR,
            ORG,
            TASK_ID,
            work_date=date(2020, 1, 1),
            duration_minutes=3000,
            source=WorklogSource.IMPORT,
        )
    assert row.worklog.duration_minutes == 3000


async def test_logging_for_someone_else_needs_the_policy_and_a_reviewer() -> None:
    off = ResolvedTimePolicy(organization_id=ORG, allow_log_for_others=False)
    with _env(off, reviewer=True) as stack, pytest.raises(PermissionDeniedError):
        await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, user_id=OTHER, work_date=TODAY, duration_minutes=10
        )
    with _env(reviewer=False) as stack, pytest.raises(PermissionDeniedError):
        await stack.env.ops.create(
            ACTOR, ORG, TASK_ID, user_id=OTHER, work_date=TODAY, duration_minutes=10
        )

    with _env(reviewer=True) as stack:
        env = stack.env
        row, _ = await env.ops.create(
            ACTOR, ORG, TASK_ID, user_id=OTHER, work_date=TODAY, duration_minutes=10
        )
    assert (row.worklog.user_id, row.worklog.created_by_user_id) == (OTHER, ACTOR)
    env.access.require_active_member.assert_awaited_once_with(OTHER, ORG)
    kwargs = env.audit.await_args.kwargs
    assert kwargs["action"] == Action.WORKLOG_CREATED
    assert kwargs["on_behalf_of_user_id"] == OTHER


async def test_locked_day_rejects_members_and_audits_an_admin_override() -> None:
    with _env(locked=True) as stack, pytest.raises(ValidationError) as exc_info:
        await stack.env.ops.create(ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=10)
    assert "locked" in exc_info.value.message

    with _env(locked=True, admin=True) as stack:
        env = stack.env
        await env.ops.create(ACTOR, ORG, TASK_ID, work_date=TODAY, duration_minutes=10)
    assert env.audit.await_args.kwargs["action"] == Action.WORKLOG_OVERRIDE
    assert env.audit.await_args.kwargs["on_behalf_of_user_id"] is None


def _existing(user_id=ACTOR, minutes: int = 60, work_date: date = TODAY, created_by=None) -> tuple:  # noqa: ANN001
    worklog = Worklog(
        id=uuid4(),
        organization_id=ORG,
        task_id=TASK_ID,
        user_id=user_id,
        created_by_user_id=created_by or user_id,
        work_date=work_date,
        duration_minutes=minutes,
        source=WorklogSource.MANUAL,
    )
    return (worklog, PROJECT_ID)


async def test_update_changes_the_entry_recomputes_and_logs_previous_and_new() -> None:
    existing = _existing()
    with _env(existing=existing, rollup=90) as stack:
        env = stack.env
        row, rollup = await env.ops.update(
            ACTOR, ORG, existing[0].id, duration_minutes=90, description="Pairing"
        )
    assert row.worklog.duration_minutes == 90
    assert row.worklog.description == "Pairing"
    assert rollup == 90
    env.notifications.log_activity.assert_awaited_once_with(
        TASK_ID, ACTOR, "time_updated", previous_value="60", new_value="90"
    )
    assert env.session.events == ["commit", "publish"]


async def test_update_of_someone_elses_entry_needs_a_reviewer_or_admin_and_is_audited() -> None:
    existing = _existing(user_id=OTHER)
    with _env(existing=existing) as stack, pytest.raises(PermissionDeniedError):
        await stack.env.ops.update(ACTOR, ORG, existing[0].id, duration_minutes=30)

    for flag in ("reviewer", "admin"):
        with _env(existing=existing, **{flag: True}) as stack:
            env = stack.env
            await env.ops.update(ACTOR, ORG, existing[0].id, duration_minutes=30)
        kwargs = env.audit.await_args.kwargs
        assert kwargs["action"] == Action.WORKLOG_UPDATED, flag
        assert kwargs["on_behalf_of_user_id"] == OTHER, flag


async def test_delete_of_someone_elses_entry_needs_a_reviewer_or_admin_and_is_audited() -> None:
    existing = _existing(user_id=OTHER)
    with _env(existing=existing) as stack, pytest.raises(PermissionDeniedError):
        await stack.env.ops.delete(ACTOR, ORG, existing[0].id)

    with _env(existing=existing, reviewer=True) as stack:
        env = stack.env
        await env.ops.delete(ACTOR, ORG, existing[0].id)
    kwargs = env.audit.await_args.kwargs
    assert kwargs["action"] == Action.WORKLOG_DELETED
    assert kwargs["on_behalf_of_user_id"] == OTHER


async def test_having_created_an_entry_for_someone_grants_no_lasting_right_to_change_it() -> None:
    """A manager who logged for a report and then stopped reviewing them is an outsider again."""
    existing = _existing(user_id=OTHER, created_by=ACTOR)
    with _env(existing=existing) as stack, pytest.raises(PermissionDeniedError):
        await stack.env.ops.update(ACTOR, ORG, existing[0].id, duration_minutes=30)
    with _env(existing=existing) as stack, pytest.raises(PermissionDeniedError):
        await stack.env.ops.delete(ACTOR, ORG, existing[0].id)
    with _env(existing=existing) as stack:
        stack.env.audit.assert_not_awaited()


async def test_delete_is_soft_and_recomputes() -> None:
    existing = _existing()
    with _env(existing=existing, rollup=None) as stack:
        env = stack.env
        task_id, rollup = await env.ops.delete(ACTOR, ORG, existing[0].id)
    assert task_id == TASK_ID
    assert rollup == 0
    assert existing[0].is_deleted is True
    assert existing[0].deleted_at is not None
    env.notifications.log_activity.assert_awaited_once_with(
        TASK_ID, ACTOR, "time_removed", previous_value="60"
    )
    assert not any("delete from" in _compiled(s) for s in env.session.statements)


async def test_list_for_user_caps_the_range_at_62_days() -> None:
    with _env() as stack, pytest.raises(ValidationError):
        await stack.env.ops.list_for_user(
            ACTOR, ORG, ACTOR, from_date=date(2026, 1, 1), to_date=date(2026, 3, 4)
        )
    with _env() as stack:
        env = stack.env
        await env.ops.list_for_user(
            ACTOR, ORG, OTHER, from_date=date(2026, 1, 1), to_date=date(2026, 3, 3)
        )
    env.access.require_person_scope.assert_awaited_once_with(ACTOR, ORG, OTHER)


async def test_list_for_task_caps_the_page_size_and_pages_by_offset() -> None:
    with _env() as stack:
        env = stack.env
        rows, token = await env.ops.list_for_task(
            ACTOR, ORG, TASK_ID, page_size=10_000, page_token="40"
        )
    assert rows == []
    assert token == ""
    sql = _compiled(env.session.statements[-1])
    assert f"limit {MAX_TASK_PAGE_SIZE + 1}" in sql
    assert "offset 40" in sql
    assert "order by projects_worklogs.work_date desc" in sql


async def test_aggregate_requires_a_scope_and_groups_in_one_query() -> None:
    with _env() as stack, pytest.raises(ValidationError):
        await stack.env.ops.aggregate(
            ACTOR,
            ORG,
            from_date=date(2026, 1, 1),
            to_date=date(2026, 1, 31),
            group_by=AggregateGroupBy.DAY,
        )
    with _env() as stack:
        env = stack.env
        await env.ops.aggregate(
            ACTOR,
            ORG,
            from_date=date(2026, 1, 1),
            to_date=date(2026, 1, 31),
            group_by=AggregateGroupBy.USER,
            project_id=PROJECT_ID,
        )
    env.access.require_project_view.assert_awaited_once_with(ACTOR, ORG, PROJECT_ID)
    sql = _compiled(env.session.statements[-1])
    assert "group by" in sql
    assert "login_users" in sql
    assert f"projects_tasks.project_id = '{PROJECT_ID.hex}'" in sql
    assert len(env.session.statements) == 1


async def test_cleanup_refuses_a_locked_period_before_deleting_anything() -> None:
    session = _Session()
    timesheets = MagicMock()
    timesheets.locked_periods_for_tasks = AsyncMock(
        return_value=[(date(2026, 10, 5), date(2026, 10, 11))]
    )
    with (
        patch("uniffy.domains.projects.time.cleanup.SheetLocks", return_value=timesheets),
        pytest.raises(ValidationError) as exc_info,
    ):
        await cleanup.stage_delete_for_tasks(session, ORG, [TASK_ID])  # type: ignore[arg-type]
    assert "2026-10-05" in exc_info.value.message
    assert session.statements == []


async def test_cleanup_hard_deletes_timers_and_worklogs_without_committing() -> None:
    session = _Session()
    timesheets = MagicMock()
    timesheets.locked_periods_for_tasks = AsyncMock(return_value=[])
    with patch("uniffy.domains.projects.time.cleanup.SheetLocks", return_value=timesheets):
        await cleanup.stage_delete_for_tasks(session, ORG, [TASK_ID])  # type: ignore[arg-type]
    sqls = [_compiled(s) for s in session.statements]
    assert any(s.startswith("delete from projects_timers") for s in sqls)
    assert any(s.startswith("delete from projects_worklogs") for s in sqls)
    assert session.events == []
