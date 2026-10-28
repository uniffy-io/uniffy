"""The demo time seeder proven on real rows: entries roll up within a day's capacity, one timer
runs, approvals turn on and the busiest team gets a submitted and an approved week; a rerun adds
nothing."""

from datetime import UTC, datetime
from types import SimpleNamespace as NS
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.activity import TaskActivity
from uniffy.core.models.projects.field_definition import DefaultTaskStatusId
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.timer import Timer
from uniffy.core.models.projects.timesheet import TimePeriod, Timesheet, TimesheetStatus
from uniffy.core.models.projects.worklog import Worklog, WorklogSource
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.types import AccessMode, ContentRole, generate_id
from uniffy.domains.projects.time.periods import period_for, previous_period
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, load_time_policy
from uniffy.scripts.demo_company.context import DemoContext
from uniffy.scripts.demo_company.project_specs import ProjectSpec, TaskSpec, WorklogSpec
from uniffy.scripts.demo_company.time import MAX_MINUTES_PER_DAY, seed_time

pytestmark = pytest.mark.asyncio(loop_scope="session")

PAIRING = "pairing on the rollout"


@pytest_asyncio.fixture(loop_scope="session")
async def world(session, access):
    """Three tasks in an org-open project; the peer leads a team holding the member and the admin."""
    slug = f"seed-{generate_id().hex[-10:]}"
    project = Project(
        organization_id=access.org_id,
        owner_id=access.owner_id,
        name="Seeded time",
        slug=slug,
        access_mode=AccessMode.OPEN_TO_ORG,
        baseline_role=ContentRole.VIEWER,
        task_counter=3,
    )
    session.add(project)
    await session.flush()
    tasks = [
        Task(
            organization_id=access.org_id,
            owner_id=access.owner_id,
            project_id=project.id,
            title=title,
            number=number,
            description="",
            status=status,
            assignee_ids=[str(assignee)] if assignee else None,
        )
        for number, title, status, assignee in (
            (1, "One", DefaultTaskStatusId.IN_PROGRESS, access.member_id),
            (2, "Two", DefaultTaskStatusId.COMPLETED, access.admin_id),
            (3, "Three", DefaultTaskStatusId.TODO, None),
        )
    ]
    session.add_all(tasks)
    team = Group(
        organization_id=access.org_id,
        name="Seeded team",
        slug=f"team-{slug}",
        kind=GroupKind.TEAM,
        lead_user_id=access.peer_id,
        created_by_user_id=access.owner_id,
    )
    session.add(team)
    await session.flush()
    session.add_all([
        GroupMember(user_id=access.member_id, group_id=team.id),
        GroupMember(user_id=access.admin_id, group_id=team.id),
    ])
    emails = dict(
        (
            await session.execute(
                select(User.id, User.email).where(User.id.in_([access.member_id, access.admin_id]))
            )
        ).all()
    )
    task_ids = [task.id for task in tasks]
    team_id = team.id
    project_id = project.id
    await session.commit()
    try:
        yield NS(
            org=access.org_id,
            slug=slug,
            task_ids=task_ids,
            member=access.member_id,
            admin=access.admin_id,
            lead=access.peer_id,
            owner=access.owner_id,
            member_email=emails[access.member_id],
            admin_email=emails[access.admin_id],
        )
    finally:
        await session.rollback()
        for model in (Timer, Worklog, Timesheet, TimePeriod):
            await session.execute(delete(model).where(model.organization_id == access.org_id))
        await session.execute(delete(TaskActivity).where(TaskActivity.task_id.in_(task_ids)))
        await session.execute(delete(OrgSetting).where(OrgSetting.organization_id == access.org_id))
        await session.execute(delete(GroupMember).where(GroupMember.group_id == team_id))
        await session.execute(delete(Group).where(Group.id == team_id))
        await session.execute(delete(Task).where(Task.id.in_(task_ids)))
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.commit()


def _context(session, world) -> DemoContext:
    now = datetime.now(UTC)
    return DemoContext(
        session=session,
        storage=MagicMock(),
        search=MagicMock(),
        search_indexer=MagicMock(),
        buffer=UpdateBuffer(),
        organization_id=world.org,
        actor_id=world.owner,
        timezone="UTC",
        history_days=30,
        anchor=now,
        now=now,
        dry_run=False,
    )


def _spec(world, last_offset: int, before_offset: int) -> ProjectSpec:
    return ProjectSpec(
        name="Seeded time",
        slug=world.slug,
        description="",
        color="#6366f1",
        icon="rocket",
        tags=(),
        tasks=(
            TaskSpec(
                title="One",
                assignees=(world.member_email,),
                worklogs=(
                    WorklogSpec(world.member_email, last_offset, 120),
                    WorklogSpec(world.member_email, last_offset, 1400),
                ),
            ),
            TaskSpec(
                title="Two",
                assignees=(world.admin_email,),
                worklogs=(WorklogSpec(world.admin_email, before_offset, 90, PAIRING),),
            ),
            TaskSpec(title="Three"),
        ),
    )


async def _worklogs(session, org):
    rows = await session.execute(
        select(Worklog)
        .where(Worklog.organization_id == org, Worklog.is_deleted.is_(False))
        .order_by(Worklog.work_date, Worklog.duration_minutes)
    )
    return list(rows.scalars().all())


async def test_seeds_entries_timer_policy_and_the_teams_review_state(session, world) -> None:
    ctx = _context(session, world)
    policy = ResolvedTimePolicy(organization_id=world.org)
    today = ctx.now.date()
    last_start, _ = previous_period(period_for(today, policy)[0], policy)
    before_start, _ = previous_period(last_start, policy)
    spec = _spec(world, (last_start - today).days, (before_start - today).days)

    result = await seed_time(ctx, (spec,))

    assert (result.created, result.skipped) == (7, 0)
    entries = await _worklogs(session, world.org)
    assert [(e.task_id, e.user_id, e.work_date, e.duration_minutes) for e in entries] == [
        (world.task_ids[1], world.admin, before_start, 90),
        (world.task_ids[0], world.member, last_start, 120),
        (world.task_ids[0], world.member, last_start, MAX_MINUTES_PER_DAY - 120),
    ]
    assert all(e.created_by_user_id == e.user_id for e in entries)
    assert all(e.source == WorklogSource.MANUAL for e in entries)
    assert entries[0].description == PAIRING

    spent = dict((await session.execute(select(Task.id, Task.time_spent_minutes))).all())
    assert [spent[task_id] for task_id in world.task_ids] == [MAX_MINUTES_PER_DAY, 90, None]

    timer = (
        await session.execute(select(Timer).where(Timer.organization_id == world.org))
    ).scalar_one()
    assert (timer.user_id, timer.task_id) == (world.member, world.task_ids[0])

    assert (await load_time_policy(session, world.org)).approvals_enabled

    sheets = {
        (sheet.user_id, sheet.period_start): sheet
        for sheet in (
            await session.execute(select(Timesheet).where(Timesheet.organization_id == world.org))
        ).scalars()
    }
    submitted = sheets[(world.member, last_start)]
    approved = sheets[(world.admin, before_start)]
    assert submitted.status == TimesheetStatus.SUBMITTED
    assert submitted.submitted_by_user_id == world.member
    assert submitted.reviewer_user_id is None
    assert approved.status == TimesheetStatus.APPROVED
    assert approved.reviewer_user_id == world.lead
    assert len(sheets) == 2  # noqa: PLR2004 - one submitted, one approved


async def test_a_rerun_leaves_everything_as_it_was(session, world) -> None:
    ctx = _context(session, world)
    policy = ResolvedTimePolicy(organization_id=world.org)
    today = ctx.now.date()
    last_start, _ = previous_period(period_for(today, policy)[0], policy)
    before_start, _ = previous_period(last_start, policy)
    spec = _spec(world, (last_start - today).days, (before_start - today).days)
    await seed_time(ctx, (spec,))
    before = [(e.id, e.duration_minutes) for e in await _worklogs(session, world.org)]

    result = await seed_time(_context(session, world), (spec,))

    assert result.created == 0
    assert result.skipped == 5  # noqa: PLR2004 - two tasks, the timer, the policy, the sheets
    assert [(e.id, e.duration_minutes) for e in await _worklogs(session, world.org)] == before
    timers = (await session.execute(select(Timer).where(Timer.organization_id == world.org))).all()
    assert len(timers) == 1
