"""Period locks proven on real rows: submitted, closed and ended periods refuse writes,
grace and timekeeping admins get through, and every override leaves its audit trail."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update

from uniffy.core.audit.actions import Action
from uniffy.core.errors import PermissionDeniedError, ValidationError
from uniffy.core.models.audit.event import AuditEvent
from uniffy.core.models.people.profile import PeopleProfile
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.timer import Timer
from uniffy.core.models.projects.timesheet import (
    TimePeriod,
    TimePeriodStatus,
    Timesheet,
    TimesheetStatus,
)
from uniffy.core.models.projects.worklog import Worklog
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.projects.time.cleanup import stage_delete_for_tasks
from uniffy.domains.projects.time.closures import PeriodOperations
from uniffy.domains.projects.time.periods import period_for
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, save_time_policy
from uniffy.domains.projects.time.timesheets import RecallCause, TimesheetOperations
from uniffy.domains.projects.time.worklogs import WorklogOperations

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = datetime.now(UTC).date()
HOUR = timedelta(hours=1)


@pytest_asyncio.fixture(loop_scope="session")
async def world(session, access):
    """A task the member owns, the peer as their manager, approvals on with the default lock."""
    project = Project(
        organization_id=access.org_id,
        owner_id=access.member_id,
        name="Time locks",
        slug=f"time-{generate_id().hex[-12:]}",
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
        task_counter=1,
    )
    session.add(project)
    await session.flush()
    task = Task(
        organization_id=access.org_id,
        owner_id=access.member_id,
        project_id=project.id,
        title="Locks",
        number=1,
        description="",
    )
    session.add(task)
    session.add(
        PeopleProfile(
            organization_id=access.org_id,
            user_id=access.member_id,
            manager_user_id=access.peer_id,
        )
    )
    await _policy(session, access, lock_on_submit=True)
    task_id = task.id
    await session.commit()
    try:
        yield NS(
            org=access.org_id,
            task_id=task_id,
            worker=access.member_id,
            reviewer=access.peer_id,
            admin=access.admin_id,
            owner=access.owner_id,
        )
    finally:
        for model in (Timer, Worklog, Timesheet, TimePeriod):
            await session.execute(delete(model).where(model.organization_id == access.org_id))
        await session.execute(delete(TaskActivity).where(TaskActivity.task_id == task_id))
        await session.execute(delete(OrgSetting).where(OrgSetting.organization_id == access.org_id))
        await session.execute(
            delete(PeopleProfile).where(PeopleProfile.organization_id == access.org_id)
        )
        await session.commit()


async def _policy(session, access, *, lock_on_submit: bool, lock_delay: int = 2) -> None:
    await save_time_policy(
        session,
        policy=ResolvedTimePolicy(
            organization_id=access.org_id,
            approvals_enabled=True,
            lock_on_submit=lock_on_submit,
            period_lock_delay_days=lock_delay,
        ),
        updated_by_user_id=access.admin_id,
    )


async def _reset(session, world, *, lock_on_submit: bool = True, lock_delay: int = 2) -> None:
    """Every test starts from open sheets, open periods and the default lock rule."""
    await session.rollback()
    for model in (Worklog, Timesheet, TimePeriod):
        await session.execute(delete(model).where(model.organization_id == world.org))
    await _policy(
        session,
        NS(org_id=world.org, admin_id=world.admin),
        lock_on_submit=lock_on_submit,
        lock_delay=lock_delay,
    )
    await session.commit()


async def _log(session, world, actor, day, *, user_id=None, minutes: int = 60):  # noqa: ANN001
    return await WorklogOperations(session).create(
        actor, world.org, world.task_id, work_date=day, duration_minutes=minutes, user_id=user_id
    )


async def _sheet(session, world) -> Timesheet | None:
    result = await session.execute(
        select(Timesheet).where(
            Timesheet.organization_id == world.org, Timesheet.user_id == world.worker
        )
    )
    return result.scalars().first()


async def _audit_actions(session, world) -> list[str]:
    result = await session.execute(
        select(AuditEvent.action)
        .where(AuditEvent.organization_id == world.org)
        .order_by(AuditEvent.created_at.asc())
    )
    return [row[0] for row in result.all()]


async def test_a_submitted_period_locks_until_grace_and_locks_again_once_it_expires(
    session, world
) -> None:
    await _reset(session, world)
    await _log(session, world, world.worker, TODAY)
    view = await TimesheetOperations(session).submit(world.worker, world.org, None, TODAY)
    assert view.status == TimesheetStatus.SUBMITTED
    assert view.locked is True

    with pytest.raises(ValidationError, match="locked"):
        await _log(session, world, world.worker, TODAY)

    await TimesheetOperations(session).grant_grace(
        world.reviewer, world.org, world.worker, TODAY, hours=1
    )
    row, rollup = await _log(session, world, world.worker, TODAY)
    assert rollup == 120
    sheet = await _sheet(session, world)
    assert sheet is not None and sheet.status == TimesheetStatus.SUBMITTED

    await session.execute(
        update(Timesheet)
        .where(Timesheet.id == sheet.id)
        .values(grace_until=datetime.now(UTC) - HOUR)
    )
    await session.commit()
    with pytest.raises(ValidationError, match="locked"):
        await _log(session, world, world.worker, TODAY)
    assert Action.TIMESHEET_GRACE_GRANTED in await _audit_actions(session, world)


async def test_a_closed_period_blocks_everyone_with_no_sheet_until_it_is_reopened(
    session, world
) -> None:
    # A long delay keeps the ended-period rule out of the way; only the closure locks here.
    await _reset(session, world, lock_delay=30)
    day = TODAY - timedelta(days=7)
    start, end = period_for(day, ResolvedTimePolicy(organization_id=world.org))
    with pytest.raises(PermissionDeniedError):
        await PeriodOperations(session).close(world.worker, world.org, day)
    closed = await PeriodOperations(session).close(world.admin, world.org, day)
    assert closed.status == TimePeriodStatus.CLOSED

    with pytest.raises(ValidationError, match="locked"):
        await _log(session, world, world.worker, day)
    with pytest.raises(ValidationError, match="closed"):
        await TimesheetOperations(session).submit(world.worker, world.org, None, day)

    await PeriodOperations(session).reopen(world.admin, world.org, day)
    _, rollup = await _log(session, world, world.worker, day)
    assert rollup == 60
    actions = await _audit_actions(session, world)
    assert actions[-2:] == [Action.TIME_PERIOD_CLOSED, Action.TIME_PERIOD_REOPENED]
    assert (start, end) == period_for(day, ResolvedTimePolicy(organization_id=world.org))


async def test_an_ended_period_past_the_delay_locks_an_open_sheet_and_grace_reopens_it(
    session, world
) -> None:
    await _reset(session, world)
    day = TODAY - timedelta(days=14)
    with pytest.raises(ValidationError, match="locked"):
        await _log(session, world, world.worker, day)
    assert await _sheet(session, world) is None

    await TimesheetOperations(session).grant_grace(
        world.reviewer, world.org, world.worker, day, hours=2
    )
    _, rollup = await _log(session, world, world.worker, day)
    assert rollup == 60
    sheet = await _sheet(session, world)
    assert sheet is not None and sheet.status == TimesheetStatus.OPEN


async def test_an_admin_override_is_audited_and_returns_an_approved_sheet_for_review(
    session, world
) -> None:
    await _reset(session, world)
    await _log(session, world, world.worker, TODAY)
    await TimesheetOperations(session).submit(world.worker, world.org, None, TODAY)
    sheet = await _sheet(session, world)
    assert sheet is not None
    approved = await TimesheetOperations(session).approve(world.reviewer, world.org, sheet.id)
    assert approved.status == TimesheetStatus.APPROVED

    with pytest.raises(ValidationError, match="locked"):
        await _log(session, world, world.worker, TODAY)
    row, rollup = await _log(session, world, world.admin, TODAY, user_id=world.worker, minutes=30)
    assert rollup == 90
    assert row.worklog.created_by_user_id == world.admin

    await session.refresh(sheet)
    assert sheet.status == TimesheetStatus.SUBMITTED
    actions = await _audit_actions(session, world)
    assert Action.WORKLOG_OVERRIDE in actions
    assert actions[-1] == Action.TIMESHEET_SUBMITTED
    last = (
        (
            await session.execute(
                select(AuditEvent)
                .where(AuditEvent.organization_id == world.org)
                .order_by(AuditEvent.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    assert last is not None and last.details["cause"] == RecallCause.EDIT


async def test_only_a_named_reviewer_approves_and_never_the_worker(session, world) -> None:
    await _reset(session, world)
    await _log(session, world, world.worker, TODAY)
    await TimesheetOperations(session).submit(world.worker, world.org, None, TODAY)
    sheet = await _sheet(session, world)
    assert sheet is not None
    with pytest.raises(PermissionDeniedError, match="own"):
        await TimesheetOperations(session).approve(world.worker, world.org, sheet.id)
    # The org owner is a timekeeping admin, but the worker has a named reviewer.
    with pytest.raises(PermissionDeniedError, match="review"):
        await TimesheetOperations(session).approve(world.owner, world.org, sheet.id)
    with pytest.raises(ValidationError, match="reason"):
        await TimesheetOperations(session).reject(world.reviewer, world.org, sheet.id, comment="")
    rejected = await TimesheetOperations(session).reject(
        world.reviewer, world.org, sheet.id, comment="Friday is missing"
    )
    assert rejected.status == TimesheetStatus.REJECTED
    assert rejected.locked is False
    _, rollup = await _log(session, world, world.worker, TODAY)
    assert rollup == 120


async def test_an_edit_recalls_a_submitted_sheet_when_lock_on_submit_is_off(session, world) -> None:
    await _reset(session, world, lock_on_submit=False)
    await _log(session, world, world.worker, TODAY)
    view = await TimesheetOperations(session).submit(world.worker, world.org, None, TODAY)
    assert view.locked is False
    _, rollup = await _log(session, world, world.worker, TODAY)
    assert rollup == 120
    sheet = await _sheet(session, world)
    assert sheet is not None and sheet.status == TimesheetStatus.OPEN
    actions = await _audit_actions(session, world)
    assert actions[-1] == Action.TIMESHEET_RECALLED


async def test_permanent_task_delete_refuses_a_locked_period_then_removes_the_entries(
    session, world
) -> None:
    await _reset(session, world)
    await _log(session, world, world.worker, TODAY)
    await TimesheetOperations(session).submit(world.worker, world.org, None, TODAY)
    start, _ = period_for(TODAY, ResolvedTimePolicy(organization_id=world.org))
    with pytest.raises(ValidationError, match=start.isoformat()):
        await stage_delete_for_tasks(session, world.org, [world.task_id])
    await session.rollback()

    await TimesheetOperations(session).recall(world.worker, world.org, None, TODAY)
    await stage_delete_for_tasks(session, world.org, [world.task_id])
    await session.commit()
    remaining = await session.execute(select(Worklog.id).where(Worklog.task_id == world.task_id))
    assert remaining.all() == []
