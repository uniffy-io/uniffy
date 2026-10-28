"""Sprint capacity: what each assignee can give the sprint against the plan and the record."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from fractions import Fraction
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import NotFoundError
from uniffy.core.models.login.group import Group
from uniffy.core.models.login.group_member import GroupMember
from uniffy.core.models.login.organization_member import OrganizationMember
from uniffy.core.models.login.user import User
from uniffy.core.models.projects.sprint import Sprint
from uniffy.core.models.projects.task import Task
from uniffy.core.models.projects.worklog import Worklog
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.capacity import (
    days_between,
    off_days_for,
    required_minutes_on,
    schedules_for_users,
)
from uniffy.domains.projects.time.periods import validate_date_range
from uniffy.domains.projects.time.policy import ResolvedTimePolicy, load_time_policy


@dataclass(frozen=True)
class MemberCapacity:
    user_id: UUID
    capacity_minutes: int
    estimated_minutes: int
    logged_minutes: int


@dataclass(frozen=True)
class SprintCapacity:
    rows: list[MemberCapacity]
    capacity_minutes: int
    estimated_minutes: int
    logged_minutes: int


@dataclass(frozen=True)
class _SprintTask:
    id: UUID
    assignees: list[UUID]
    estimated_minutes: int


def _sprint_dates(sprint: Sprint) -> tuple[date, date] | None:
    if not sprint.start_date or not sprint.end_date:
        return None
    try:
        start, end = date.fromisoformat(sprint.start_date), date.fromisoformat(sprint.end_date)
    except ValueError:
        return None
    if start > end:
        return None
    validate_date_range(start, end)
    return start, end


def split_estimate(estimate: int, user_ids: list[UUID]) -> dict[UUID, int]:
    """An even split whose remainder lands on the first people, so the parts add up exactly."""
    if not user_ids or estimate <= 0:
        return {}
    share, remainder = divmod(estimate, len(user_ids))
    return {
        user_id: share + (1 if index < remainder else 0)
        for index, user_id in enumerate(sorted(user_ids))
    }


class SprintCapacityReader:
    """Gated on project view: anyone who reads the backlog may read its capacity."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.access = TimeAccess(session)

    async def get(self, actor_id: UUID, organization_id: UUID, sprint_id: UUID) -> SprintCapacity:
        result = await self.session.execute(
            select(Sprint).where(Sprint.id == sprint_id, Sprint.organization_id == organization_id)
        )
        sprint = result.scalar_one_or_none()
        if sprint is None:
            raise NotFoundError("Sprint", str(sprint_id))
        await self.access.require_project_view(actor_id, organization_id, sprint.project_id)
        policy = await load_time_policy(self.session, organization_id)

        dates = _sprint_dates(sprint)
        tasks = await self._tasks(organization_id, sprint_id)
        members = sorted({user_id for task in tasks for user_id in task.assignees})
        estimated: dict[UUID, int] = dict.fromkeys(members, 0)
        for task in tasks:
            for user_id, share in split_estimate(task.estimated_minutes, task.assignees).items():
                estimated[user_id] += share
        logged = await self._logged([task.id for task in tasks], members)
        capacity = await self._capacity(organization_id, members, dates, policy)

        rows = [
            MemberCapacity(
                user_id=user_id,
                capacity_minutes=capacity.get(user_id, 0),
                estimated_minutes=estimated.get(user_id, 0),
                logged_minutes=logged.get(user_id, 0),
            )
            for user_id in members
        ]
        return SprintCapacity(
            rows=rows,
            capacity_minutes=sum(row.capacity_minutes for row in rows),
            estimated_minutes=sum(row.estimated_minutes for row in rows),
            logged_minutes=sum(row.logged_minutes for row in rows),
        )

    async def _tasks(self, organization_id: UUID, sprint_id: UUID) -> list[_SprintTask]:
        result = await self.session.execute(
            select(Task.id, Task.assignee_ids, Task.estimated_minutes).where(
                Task.organization_id == organization_id,
                Task.sprint_id == sprint_id,
                Task.is_deleted.is_(False),
            )
        )
        raw: list[tuple[UUID, list[UUID], int]] = []
        for task_id, assignee_ids, estimate in result.all():
            assignees: list[UUID] = []
            for value in assignee_ids or []:
                try:
                    assignees.append(UUID(str(value)))
                except ValueError:
                    continue
            raw.append((task_id, assignees, int(estimate or 0)))
        expanded = await self._expand(organization_id, sorted({a for _, ids, _ in raw for a in ids}))
        return [
            _SprintTask(
                id=task_id,
                assignees=sorted({user for a in assignees for user in expanded.get(a, ())}),
                estimated_minutes=estimate,
            )
            for task_id, assignees, estimate in raw
        ]

    async def _expand(
        self, organization_id: UUID, assignee_ids: list[UUID]
    ) -> dict[UUID, tuple[UUID, ...]]:
        """Each assignee id to the active people behind it: the person, or a group's members."""
        if not assignee_ids:
            return {}
        groups = await self.session.execute(
            select(Group.id).where(
                Group.id.in_(assignee_ids), Group.organization_id == organization_id
            )
        )
        group_ids = {row[0] for row in groups.all()}
        behind: dict[UUID, set[UUID]] = {
            assignee: set() if assignee in group_ids else {assignee} for assignee in assignee_ids
        }
        if group_ids:
            members = await self.session.execute(
                select(GroupMember.group_id, GroupMember.user_id).where(
                    GroupMember.group_id.in_(group_ids), GroupMember.is_active.is_(True)
                )
            )
            for group_id, user_id in members.all():
                behind[group_id].add(user_id)
        candidates = sorted({user for users in behind.values() for user in users})
        if not candidates:
            return {assignee: () for assignee in assignee_ids}
        active_rows = await self.session.execute(
            select(OrganizationMember.user_id)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id.in_(candidates),
                OrganizationMember.is_active.is_(True),
                User.is_active.is_(True),
            )
        )
        active = {row[0] for row in active_rows.all()}
        return {
            assignee: tuple(sorted(user for user in users if user in active))
            for assignee, users in behind.items()
        }

    async def _logged(self, task_ids: list[UUID], members: list[UUID]) -> dict[UUID, int]:
        if not task_ids or not members:
            return {}
        result = await self.session.execute(
            select(Worklog.user_id, func.sum(Worklog.duration_minutes))
            .where(
                Worklog.task_id.in_(task_ids),
                Worklog.user_id.in_(members),
                Worklog.is_deleted.is_(False),
            )
            .group_by(Worklog.user_id)
        )
        return {user_id: int(total) for user_id, total in result.all()}

    async def _capacity(
        self,
        organization_id: UUID,
        members: list[UUID],
        dates: tuple[date, date] | None,
        policy: ResolvedTimePolicy,
    ) -> dict[UUID, int]:
        if not members or dates is None:
            return {}
        start, end = dates
        schedules = await schedules_for_users(self.session, members)
        off = await off_days_for(
            self.session, organization_id, members, start, end, policy, schedules
        )
        return {
            user_id: sum(
                required_minutes_on(
                    day, policy, schedules[user_id].workdays, off[user_id].get(day, Fraction(0))
                )
                for day in days_between(start, end)
            )
            for user_id in members
        }
