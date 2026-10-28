"""Seed time entries, one running timer and the approvals demo through the real time operations."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta
from uuid import UUID

from loguru import logger
from sqlalchemy import case, exists, func, select

from uniffy.core.models.login.group import Group, GroupKind
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.projects.field_definition import DefaultTaskStatusId
from uniffy.core.models.projects.project import Project
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.timer import Timer
from uniffy.core.models.projects.timesheet import Timesheet
from uniffy.core.models.projects.worklog import Worklog
from uniffy.core.models.settings.org_setting import OrgSetting
from uniffy.domains.projects.time.periods import period_for, previous_period
from uniffy.domains.projects.time.policy import (
    PROJECTS_NAMESPACE,
    TIME_POLICY_KEY,
    ResolvedTimePolicy,
    load_time_policy,
    save_time_policy,
)
from uniffy.domains.projects.time.timers import TimerOperations
from uniffy.domains.projects.time.timesheets import TimesheetOperations
from uniffy.domains.projects.time.worklogs import WorklogOperations
from uniffy.scripts.demo_company.context import DemoContext, DomainResult, resolve_member_map
from uniffy.scripts.demo_company.project_specs import ProjectSpec

logger = logger.bind(component="scripts.demo_company.time")

MAX_MINUTES_PER_DAY = 1440
SATURDAY = 5
SUBMIT_COMMENT = "Week logged, ready for review."
APPROVE_COMMENT = "Looks complete, thanks."


class _DayLedger:
    """Minutes already logged per person and day, so the seed never exceeds a day's capacity."""

    def __init__(self, totals: dict[tuple[UUID, date], int]) -> None:
        self._totals = totals

    def fit(self, user_id: UUID, day: date, minutes: int) -> int:
        room = MAX_MINUTES_PER_DAY - self._totals.get((user_id, day), 0)
        granted = max(0, min(minutes, room))
        if granted:
            self._totals[(user_id, day)] = self._totals.get((user_id, day), 0) + granted
        return granted


async def seed_time(ctx: DemoContext, projects: tuple[ProjectSpec, ...]) -> DomainResult:
    """Entries first under the default policy, then approvals on top of what was logged."""
    result = DomainResult()
    emails = tuple(
        sorted({
            entry.assignee for spec in projects for task in spec.tasks for entry in task.worklogs
        })
    )
    members = await resolve_member_map(ctx.session, ctx.organization_id, emails)
    policy = await load_time_policy(ctx.session, ctx.organization_id)
    ledger = _DayLedger(await _logged_totals(ctx))
    today = ctx.now.date()

    for spec in projects:
        await _seed_project_entries(ctx, spec, members, policy, ledger, today, result)

    await _seed_timer(ctx, today, result)
    policy = await _enable_approvals(ctx, policy, result)
    await _seed_sheets(ctx, policy, today, result)
    return result


async def _logged_totals(ctx: DemoContext) -> dict[tuple[UUID, date], int]:
    rows = await ctx.session.execute(
        select(Worklog.user_id, Worklog.work_date, func.sum(Worklog.duration_minutes))
        .where(Worklog.organization_id == ctx.organization_id, Worklog.is_deleted.is_(False))
        .group_by(Worklog.user_id, Worklog.work_date)
    )
    return {(user_id, day): int(total) for user_id, day, total in rows.all()}


async def _tasks_by_number(ctx: DemoContext, slug: str) -> dict[int, tuple[UUID, bool]]:
    has_entries = exists().where(Worklog.task_id == Task.id, Worklog.is_deleted.is_(False))
    rows = await ctx.session.execute(
        select(Task.number, Task.id, has_entries)
        .join(Project, Project.id == Task.project_id)
        .where(
            Project.organization_id == ctx.organization_id,
            Project.slug == slug,
            Project.is_deleted == False,  # noqa: E712
            Task.is_deleted == False,  # noqa: E712
        )
    )
    return {number: (task_id, bool(logged)) for number, task_id, logged in rows.all()}


def _workday(today: date, day_in_days: int) -> date:
    """Weekend offsets fold back onto the Friday before them."""
    day = today + timedelta(days=day_in_days)
    if day.weekday() >= SATURDAY:
        day -= timedelta(days=day.weekday() - (SATURDAY - 1))
    return day


async def _seed_project_entries(
    ctx: DemoContext,
    spec: ProjectSpec,
    members: dict[str, UUID],
    policy: ResolvedTimePolicy,
    ledger: _DayLedger,
    today: date,
    result: DomainResult,
) -> None:
    tasks = await _tasks_by_number(ctx, spec.slug)
    ops = WorklogOperations(ctx.session)
    created = 0
    # Task numbers follow creation order, so the nth spec is task n of its project.
    for number, task in enumerate(spec.tasks, start=1):
        if not task.worklogs:
            continue
        found = tasks.get(number)
        if found is None or found[1]:
            result.skipped += 1
            continue
        task_id = found[0]
        for entry in task.worklogs:
            user_id = members.get(entry.assignee)
            if user_id is None:
                continue
            day = _workday(today, entry.day_in_days)
            minutes = ledger.fit(user_id, day, entry.minutes)
            if minutes == 0:
                continue
            if ctx.dry_run:
                created += 1
                continue
            await ops.stage_create(
                user_id,
                ctx.organization_id,
                task_id,
                work_date=day,
                duration_minutes=minutes,
                description=entry.description,
                policy=policy,
            )
            created += 1
    if not ctx.dry_run:
        await ctx.session.commit()
    result.created += created
    logger.info(f"  {spec.slug}: {created} time entries")


async def _seed_timer(ctx: DemoContext, today: date, result: DomainResult) -> None:
    """One member keeps a timer running on an in-progress task they are assigned to."""
    running = await ctx.session.execute(
        select(Timer.id).where(Timer.organization_id == ctx.organization_id).limit(1)
    )
    if running.first() is not None:
        result.skipped += 1
        return
    candidates = await ctx.session.execute(
        select(Task.id, Task.assignee_ids)
        .join(Project, Project.id == Task.project_id)
        .where(
            Project.organization_id == ctx.organization_id,
            Project.is_deleted == False,  # noqa: E712
            Task.is_deleted == False,  # noqa: E712
            Task.status == DefaultTaskStatusId.IN_PROGRESS,
            Task.assignee_ids.isnot(None),
        )
        .order_by(Task.created_at.desc())
        .limit(50)
    )
    for task_id, assignee_ids in candidates.all():
        if not assignee_ids:
            continue
        user_id = UUID(assignee_ids[0])
        if ctx.dry_run:
            result.created += 1
            return
        await TimerOperations(ctx.session).start(
            user_id, ctx.organization_id, task_id, work_date=today, description="Picking this up"
        )
        result.created += 1
        return


async def _enable_approvals(
    ctx: DemoContext, policy: ResolvedTimePolicy, result: DomainResult
) -> ResolvedTimePolicy:
    existing = await ctx.session.execute(
        select(OrgSetting.key).where(
            OrgSetting.organization_id == ctx.organization_id,
            OrgSetting.namespace == PROJECTS_NAMESPACE,
            OrgSetting.key == TIME_POLICY_KEY,
        )
    )
    if existing.first() is not None:
        result.skipped += 1
        return policy
    policy = replace(policy, approvals_enabled=True)
    if ctx.dry_run:
        result.created += 1
        return policy
    await save_time_policy(ctx.session, policy=policy, updated_by_user_id=ctx.actor_id)
    await ctx.session.commit()
    result.created += 1
    return policy


async def _seed_sheets(
    ctx: DemoContext, policy: ResolvedTimePolicy, today: date, result: DomainResult
) -> None:
    """The busiest team gets one submitted and one approved week for its lead to show."""
    any_sheet = await ctx.session.execute(
        select(Timesheet.id).where(Timesheet.organization_id == ctx.organization_id).limit(1)
    )
    if any_sheet.first() is not None:
        result.skipped += 1
        return
    last_start, last_end = previous_period(period_for(today, policy)[0], policy)
    before_start, _ = previous_period(last_start, policy)
    pick = await _busiest_team(ctx, last_start, last_end, before_start)
    if pick is None:
        logger.info("  no team with logged time in the previous periods; skipping sheets")
        return
    lead_id, first, second = pick
    if ctx.dry_run:
        result.created += 2
        return
    sheets = TimesheetOperations(ctx.session)
    await sheets.submit(first, ctx.organization_id, None, last_start, comment=SUBMIT_COMMENT)
    approved = await sheets.submit(
        second, ctx.organization_id, None, before_start, comment=SUBMIT_COMMENT
    )
    assert approved.timesheet is not None
    await sheets.approve(
        lead_id, ctx.organization_id, approved.timesheet.id, comment=APPROVE_COMMENT
    )
    result.created += 2
    logger.info(
        f"  approvals: lead {lead_id} reviews {first} ({last_start}, submitted) "
        f"and {second} ({before_start}, approved)"
    )


async def _busiest_team(
    ctx: DemoContext, last_start: date, last_end: date, before_start: date
) -> tuple[UUID, UUID, UUID] | None:
    """Lead plus two members: the top logger of the last period and of the one before."""
    recent = case((Worklog.work_date >= last_start, 1), else_=0).label("recent")
    rows = await ctx.session.execute(
        select(Group.lead_user_id, Worklog.user_id, recent, func.sum(Worklog.duration_minutes))
        .select_from(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .join(Worklog, Worklog.user_id == GroupMember.user_id)
        .where(
            Group.organization_id == ctx.organization_id,
            Group.kind == GroupKind.TEAM,
            Group.lead_user_id.isnot(None),
            GroupMember.is_active.is_(True),
            GroupMember.user_id != Group.lead_user_id,
            Worklog.organization_id == ctx.organization_id,
            Worklog.is_deleted.is_(False),
            Worklog.work_date >= before_start,
            Worklog.work_date <= last_end,
        )
        .group_by(Group.lead_user_id, Worklog.user_id, recent)
        .order_by(func.sum(Worklog.duration_minutes).desc())
    )
    tops: dict[UUID, dict[int, list[UUID]]] = {}
    for lead_id, user_id, is_recent, _ in rows.all():
        tops.setdefault(lead_id, {0: [], 1: []})[int(is_recent)].append(user_id)
    for lead_id, buckets in tops.items():
        first = next(iter(buckets[1]), None)
        second = next((user for user in buckets[0] if user != first), None)
        if first is not None and second is not None:
            return lead_id, first, second
    return None
