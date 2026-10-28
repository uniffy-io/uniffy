"""Concurrent transactions preserve caps, rollups, timers and approval boundaries."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select, text

from uniffy.core.errors import NotFoundError, ValidationError
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.timer import Timer
from uniffy.core.models.projects.timesheet import Timesheet, TimesheetStatus
from uniffy.core.models.projects.worklog import Worklog
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, save_time_policy
from uniffy.domains.projects.time.timers import TimerOperations
from uniffy.domains.projects.time.timesheets import TimesheetOperations
from uniffy.domains.projects.time.worklogs import WorklogOperations
from uniffy.domains.projects.time.transactions import lock_time_people
from uniffy.domains.projects.time.closures import PeriodOperations
from uniffy.infrastructure.database import open_session
from uniffy.tests.integration.projects.time.test_timesheet_locks import _log, _reset, world

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = datetime.now(UTC).date()


async def _waiting(pid: int) -> None:
    for _ in range(200):
        async with open_session() as observer:
            waiting = await observer.scalar(
                text("select wait_event_type from pg_stat_activity where pid=:pid"), {"pid": pid}
            )
        if waiting == "Lock":
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Concurrent writer never waited for its transaction boundary")


async def _cancel(pending: asyncio.Task) -> None:
    if not pending.done():
        pending.cancel()
    await asyncio.gather(pending, return_exceptions=True)


@pytest.mark.parametrize("same_person", [True, False])
async def test_concurrent_entries_preserve_daily_cap_and_shared_task_total(
    session, world, same_person
):
    await _reset(session, world, lock_on_submit=False)
    async with open_session() as first, open_session() as second:
        pid = await second.scalar(text("select pg_backend_pid()"))
        await WorklogOperations(first).stage_create(
            world.worker, world.org, world.task_id, work_date=TODAY, duration_minutes=900
        )
        actor = world.worker if same_person else world.reviewer
        with patch("uniffy.domains.projects.time.worklogs.publish_content_changed", new=AsyncMock()):
            pending = asyncio.create_task(
                WorklogOperations(second).create(
                    actor, world.org, world.task_id, work_date=TODAY, duration_minutes=900
                )
            )
            try:
                await _waiting(pid)
                await first.commit()
                if same_person:
                    with pytest.raises(ValidationError, match="day"):
                        await asyncio.wait_for(pending, 10)
                else:
                    await asyncio.wait_for(pending, 10)
            finally:
                await _cancel(pending)
    async with open_session() as observer:
        total = await observer.scalar(
            select(Task.time_spent_minutes).where(Task.id == world.task_id)
        )
        actual = await observer.scalar(
            select(func.sum(Worklog.duration_minutes)).where(
                Worklog.task_id == world.task_id, Worklog.is_deleted.is_(False)
            )
        )
    assert total == actual == (900 if same_person else 1800)


async def test_review_reloads_after_edit_recalls_submitted_sheet(session, world):
    await _reset(session, world, lock_on_submit=False)
    entry, _ = await _log(session, world, world.worker, TODAY)
    entry_id = entry.worklog.id
    with patch("uniffy.domains.projects.time.timesheets.notify_submitted", new=AsyncMock()):
        view = await TimesheetOperations(session).submit(world.worker, world.org, None, TODAY)
    sheet_id = view.timesheet.id
    await session.rollback()
    entered, release = asyncio.Event(), asyncio.Event()
    async with open_session() as editing, open_session() as reviewing:
        pid = await reviewing.scalar(text("select pg_backend_pid()"))
        ops = WorklogOperations(editing)
        original = ops._require_unlocked

        async def wait_before_write(*args, **kwargs):
            answer = await original(*args, **kwargs)
            entered.set()
            await release.wait()
            return answer

        ops._require_unlocked = wait_before_write
        with patch("uniffy.domains.projects.time.worklogs.publish_content_changed", new=AsyncMock()):
            edit = asyncio.create_task(
                ops.update(world.worker, world.org, entry_id, duration_minutes=120)
            )
            review = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                review = asyncio.create_task(
                    TimesheetOperations(reviewing).approve(world.reviewer, world.org, sheet_id)
                )
                await _waiting(pid)
                release.set()
                await asyncio.wait_for(edit, 10)
                with pytest.raises(ValidationError, match="submitted"):
                    await asyncio.wait_for(review, 10)
            finally:
                release.set()
                await _cancel(edit)
                if review is not None:
                    await _cancel(review)
    async with open_session() as observer:
        assert (
            await observer.scalar(select(Timesheet.status).where(Timesheet.id == sheet_id))
            == TimesheetStatus.OPEN
        )


async def test_concurrent_timer_stops_create_one_entry(session, world):
    await _reset(session, world, lock_on_submit=False)
    session.add(
        Timer(
            organization_id=world.org,
            user_id=world.worker,
            task_id=world.task_id,
            started_at=datetime.now(UTC) - timedelta(minutes=10),
        )
    )
    await session.commit()
    async with open_session() as first, open_session() as second:
        pid = await second.scalar(text("select pg_backend_pid()"))
        await TimerOperations(first).stage_stop_active(
            world.worker, world.org, ResolvedTimePolicy(organization_id=world.org), work_date=TODAY
        )
        pending = asyncio.create_task(
            TimerOperations(second).stop(
                world.worker, world.org, work_date=TODAY, duration_minutes=10
            )
        )
        try:
            await _waiting(pid)
            await first.commit()
            with pytest.raises(NotFoundError):
                await asyncio.wait_for(pending, 10)
        finally:
            await _cancel(pending)
    async with open_session() as observer:
        assert (
            await observer.scalar(
                select(func.count())
                .select_from(Worklog)
                .where(Worklog.task_id == world.task_id, Worklog.is_deleted.is_(False))
            )
            == 1
        )


async def test_concurrent_first_submissions_create_one_sheet(session, world):
    await _reset(session, world, lock_on_submit=False)
    policy = ResolvedTimePolicy(organization_id=world.org, approvals_enabled=True)
    async with open_session() as first, open_session() as second:
        pid = await second.scalar(text("select pg_backend_pid()"))
        await TimesheetOperations(first).stage_submit(
            world.worker, world.org, world.worker, TODAY, comment="Ready", policy=policy
        )
        pending = asyncio.create_task(
            TimesheetOperations(second).submit(world.worker, world.org, None, TODAY)
        )
        try:
            await _waiting(pid)
            await first.commit()
            with pytest.raises(ValidationError, match="already submitted"):
                await asyncio.wait_for(pending, 10)
        finally:
            await _cancel(pending)
    async with open_session() as observer:
        assert (
            await observer.scalar(
                select(func.count())
                .select_from(Timesheet)
                .where(Timesheet.organization_id == world.org, Timesheet.user_id == world.worker)
            )
            == 1
        )


async def test_updates_enforce_history_window_without_repeated_date(session, world):
    await _reset(session, world, lock_on_submit=False, lock_delay=30)
    entry, _ = await _log(session, world, world.worker, TODAY - timedelta(days=7))
    entry_id = entry.worklog.id
    await save_time_policy(
        session,
        policy=ResolvedTimePolicy(organization_id=world.org, max_days_back=0),
        updated_by_user_id=world.admin,
    )
    await session.commit()
    with pytest.raises(ValidationError, match="older"):
        await WorklogOperations(session).update(
            world.worker, world.org, entry_id, duration_minutes=120
        )
    await session.rollback()


async def test_concurrent_first_timer_starts_replace_in_sequence(session, world):
    await _reset(session, world, lock_on_submit=False)
    async with open_session() as first, open_session() as second:
        pid = await second.scalar(text("select pg_backend_pid()"))
        await lock_time_people(first, world.org, [world.worker])
        with (
            patch("uniffy.domains.projects.time.timers.publish_notification", new=AsyncMock()),
            patch("uniffy.domains.projects.time.timers.publish_content_changed", new=AsyncMock()),
        ):
            pending = asyncio.create_task(
                TimerOperations(second).start(
                    world.worker, world.org, world.task_id, work_date=TODAY
                )
            )
            try:
                await _waiting(pid)
                _, replaced = await TimerOperations(first).start(
                    world.worker, world.org, world.task_id, work_date=TODAY
                )
                assert replaced is None
                _, replaced = await asyncio.wait_for(pending, 10)
                assert replaced is not None and replaced.worklog is not None
            finally:
                await _cancel(pending)
    async with open_session() as observer:
        assert (
            await observer.scalar(
                select(func.count())
                .select_from(Timer)
                .where(Timer.organization_id == world.org, Timer.user_id == world.worker)
            )
            == 1
        )


async def test_period_close_waits_for_pending_write_then_refuses_more_entries(session, world):
    await _reset(session, world, lock_on_submit=False)
    async with open_session() as first, open_session() as closing:
        pid = await closing.scalar(text("select pg_backend_pid()"))
        await WorklogOperations(first).stage_create(
            world.worker, world.org, world.task_id, work_date=TODAY, duration_minutes=60
        )
        pending = asyncio.create_task(PeriodOperations(closing).close(world.admin, world.org, TODAY))
        try:
            await _waiting(pid)
            await first.commit()
            await asyncio.wait_for(pending, 10)
        finally:
            await _cancel(pending)
    with pytest.raises(ValidationError, match="locked"):
        await _log(session, world, world.worker, TODAY)
    await session.rollback()
