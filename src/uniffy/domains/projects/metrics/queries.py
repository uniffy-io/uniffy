"""Aggregate task metrics over a resolved viewer scope, one grouped query per metric."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Date, Select, and_, case, cast, func, literal, select, true, tuple_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import (
    FieldDefinition,
    SystemProjectFieldId,
    TaskStatusSemantic,
)
from uniffy.core.models.projects.sprint import Sprint, SprintStatus
from uniffy.core.models.projects.task import Task, TaskType
from uniffy.domains.projects.metrics.scope import ResolvedScope
from uniffy.domains.projects.statuses import parse_task_status_semantics

_JSON_ARRAY = "array"
# A burndown longer than a year is drawn from its last year only.
_MAX_BURNDOWN_DAYS = 366


@dataclass(frozen=True)
class MetricItem:
    task_id: UUID
    project_id: UUID
    number: int
    title: str
    due_date: str | None
    assignee_ids: list[str]
    status: str
    priority: str


@dataclass(frozen=True)
class TaskList:
    total: int
    items: list[MetricItem]


@dataclass(frozen=True)
class WorkloadEntry:
    user_id: str | None
    open: int
    overdue: int


@dataclass(frozen=True)
class ProjectStatusCounts:
    project_id: UUID
    todo: int
    in_progress: int
    review: int
    completed: int


@dataclass(frozen=True)
class BugDay:
    day: date
    opened: int
    closed: int


@dataclass(frozen=True)
class SprintSummary:
    sprint_id: UUID
    project_id: UUID
    name: str
    start_date: str | None
    end_date: str | None
    total: int
    completed: int
    burndown: list[tuple[date, int]]


def _item(task: Task) -> MetricItem:
    return MetricItem(
        task_id=task.id,
        project_id=task.project_id,
        number=task.number,
        title=task.title,
        due_date=task.due_date,
        assignee_ids=list(task.assignee_ids or []),
        status=task.status,
        priority=task.priority,
    )


def _parse_day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class TaskMetricsReader:
    def __init__(self, session: AsyncSession, scope: ResolvedScope) -> None:
        self.session = session
        self.scope = scope

    def _tasks(self, *columns: Any) -> Select:
        return select(*columns).select_from(Task).where(*self.scope.task_predicates)

    def _open(self) -> Any:
        return Task.completed_at.is_(None)

    def _overdue(self) -> Any:
        # ``due_date`` is a YYYY-MM-DD string, so the comparison is exact without parsing.
        return (
            Task.completed_at.is_(None)
            & Task.due_date.is_not(None)
            & (Task.due_date < self.scope.today_key)
        )

    async def _task_list(self, condition: Any, order: list[Any], limit: int) -> TaskList:
        total = (await self.session.execute(self._tasks(func.count()).where(condition))).scalar_one()
        if total == 0:
            return TaskList(0, [])
        rows = await self.session.execute(
            self._tasks(Task).where(condition).order_by(*order, Task.id).limit(limit)
        )
        return TaskList(total, [_item(task) for task in rows.scalars().all()])

    async def overdue(self, limit: int) -> TaskList:
        return await self._task_list(
            self._overdue(), [Task.due_date.asc(), Task.number.asc()], limit
        )

    def _blocked(self) -> Any:
        """Open tasks with an open blocker, as a join from each listed id to the blocker's key.

        A correlated EXISTS per open task scans the blocker's project for every row, which does not
        hold up across a whole organization.
        """
        blocked = aliased(Task)
        blocker = aliased(Task)
        listed = case(
            (
                func.jsonb_typeof(blocked.blocked_by_task_ids) == _JSON_ARRAY,
                blocked.blocked_by_task_ids,
            ),
            else_=cast(literal("[]"), JSONB),
        )
        ref = func.jsonb_array_elements_text(listed).table_valued("value").lateral("ref")
        blocked_ids = (
            select(blocked.id)
            .join(ref, true())
            .join(
                blocker,
                and_(
                    blocker.id == cast(ref.c.value, PG_UUID(as_uuid=True)),
                    blocker.project_id == blocked.project_id,
                    blocker.is_deleted == False,  # noqa: E712
                    blocker.completed_at.is_(None),
                ),
            )
            .where(
                blocked.organization_id == self.scope.organization_id,
                blocked.is_deleted == False,  # noqa: E712
                blocked.completed_at.is_(None),
                func.jsonb_typeof(blocked.blocked_by_task_ids) == _JSON_ARRAY,
            )
        )
        return Task.id.in_(blocked_ids)

    async def blocked(self, limit: int) -> TaskList:
        return await self._task_list(
            self._blocked(),
            [Task.due_date.asc().nulls_last(), Task.updated_at.asc()],
            limit,
        )

    async def _semantics(self, project_ids: list[UUID]) -> dict[UUID, dict[str, TaskStatusSemantic]]:
        """Per project, status option id -> semantic; a project with a broken config maps nothing."""
        if not project_ids:
            return {}
        result = await self.session.execute(
            select(FieldDefinition.project_id, FieldDefinition.config).where(
                FieldDefinition.project_id.in_(project_ids),
                FieldDefinition.id == SystemProjectFieldId.STATUS,
            )
        )
        mapping: dict[UUID, dict[str, TaskStatusSemantic]] = {}
        for project_id, config in result.all():
            try:
                semantics = parse_task_status_semantics(config)
            except ValidationError:
                continue
            mapping[project_id] = {option: semantic for semantic, option in semantics.ids.items()}
        return mapping

    async def review_queue(self, limit: int) -> TaskList:
        semantics = await self._semantics(list(self.scope.project_ids))
        review_pairs = [
            (project_id, option)
            for project_id, options in semantics.items()
            for option, semantic in options.items()
            if semantic is TaskStatusSemantic.REVIEW
        ]
        if not review_pairs:
            return TaskList(0, [])
        condition = self._open() & tuple_(Task.project_id, Task.status).in_(review_pairs)
        return await self._task_list(condition, [Task.updated_at.asc()], limit)

    async def status_by_project(self, limit: int) -> list[ProjectStatusCounts]:
        done = Task.completed_at.is_not(None)
        result = await self.session.execute(
            self._tasks(Task.project_id, Task.status, done.label("done"), func.count()).group_by(
                Task.project_id, Task.status, done
            )
        )
        rows = result.all()
        semantics = await self._semantics(sorted({row[0] for row in rows}))
        buckets: dict[UUID, dict[TaskStatusSemantic, int]] = defaultdict(lambda: defaultdict(int))
        for project_id, status, is_done, count in rows:
            if is_done:
                semantic = TaskStatusSemantic.COMPLETED
            else:
                semantic = semantics.get(project_id, {}).get(status, TaskStatusSemantic.IN_PROGRESS)
                # A status marked completed while the task is still open counts as in progress.
                if semantic is TaskStatusSemantic.COMPLETED:
                    semantic = TaskStatusSemantic.IN_PROGRESS
            buckets[project_id][semantic] += count
        counts = [
            ProjectStatusCounts(
                project_id=project_id,
                todo=bucket[TaskStatusSemantic.TODO],
                in_progress=bucket[TaskStatusSemantic.IN_PROGRESS],
                review=bucket[TaskStatusSemantic.REVIEW],
                completed=bucket[TaskStatusSemantic.COMPLETED],
            )
            for project_id, bucket in buckets.items()
        ]
        counts.sort(key=lambda c: (-(c.todo + c.in_progress + c.review), str(c.project_id)))
        return counts[:limit]

    async def workload(self, limit: int) -> tuple[int, list[WorkloadEntry]]:
        listed = case(
            (func.jsonb_typeof(Task.assignee_ids) == _JSON_ARRAY, Task.assignee_ids),
            else_=cast(literal("[]"), JSONB),
        )
        assignee = func.jsonb_array_elements_text(listed).table_valued("value").lateral("assignee")
        overdue = case((self._overdue(), 1))
        per_person = await self.session.execute(
            self
            ._tasks(assignee.c.value, func.count(), func.count(overdue))
            .join(assignee, true())
            .where(self._open())
            .group_by(assignee.c.value)
        )
        entries = [
            WorkloadEntry(user_id, open_count, overdue_count)
            for user_id, open_count, overdue_count in per_person.all()
            if self.scope.people is None or user_id in self.scope.people
        ]
        total = (
            await self.session.execute(self._tasks(func.count()).where(self._open()))
        ).scalar_one()
        if self.scope.people is None:
            unassigned = await self.session.execute(
                self._tasks(func.count(), func.count(overdue)).where(
                    self._open(), func.jsonb_array_length(listed) == 0
                )
            )
            open_count, overdue_count = unassigned.one()
            if open_count:
                entries.append(WorkloadEntry(None, open_count, overdue_count))
        entries.sort(key=lambda e: (-e.open, -e.overdue, e.user_id or "~"))
        return total, entries[:limit]

    def _local_day(self, column: Any) -> Any:
        return cast(func.timezone(self.scope.zone.key, column), Date)

    async def bug_trend(self, days: int) -> list[BugDay]:
        first = self.scope.today - timedelta(days=days - 1)
        since = datetime.combine(first, time.min, tzinfo=self.scope.zone)
        is_bug = Task.task_type == TaskType.BUG.value
        opened_day = self._local_day(Task.created_at)
        closed_day = self._local_day(Task.completed_at)
        opened = await self.session.execute(
            self
            ._tasks(opened_day, func.count())
            .where(is_bug, Task.created_at >= since)
            .group_by(opened_day)
        )
        closed = await self.session.execute(
            self
            ._tasks(closed_day, func.count())
            .where(is_bug, Task.completed_at >= since)
            .group_by(closed_day)
        )
        opened_by_day = dict(opened.all())
        closed_by_day = dict(closed.all())
        return [
            BugDay(day, opened_by_day.get(day, 0), closed_by_day.get(day, 0))
            for day in (first + timedelta(days=offset) for offset in range(days))
        ]

    async def sprints(self, limit: int) -> list[SprintSummary]:
        if not self.scope.project_ids:
            return []
        result = await self.session.execute(
            select(Sprint)
            .where(
                Sprint.organization_id == self.scope.organization_id,
                Sprint.project_id.in_(self.scope.project_ids),
                Sprint.status == SprintStatus.ACTIVE,
            )
            .order_by(Sprint.end_date.asc().nulls_last(), Sprint.name)
            .limit(limit)
        )
        sprints = list(result.scalars().all())
        if not sprints:
            return []
        sprint_ids = [sprint.id for sprint in sprints]
        in_sprints = Task.sprint_id.in_(sprint_ids)
        done = Task.completed_at.is_not(None)
        totals = await self.session.execute(
            self
            ._tasks(Task.sprint_id, func.count(), func.count(case((done, 1))))
            .where(in_sprints)
            .group_by(Task.sprint_id)
        )
        closed_day = self._local_day(Task.completed_at)
        completions = await self.session.execute(
            self
            ._tasks(Task.sprint_id, closed_day, func.count())
            .where(in_sprints, done)
            .group_by(Task.sprint_id, closed_day)
        )
        counts = {sprint_id: (total, completed) for sprint_id, total, completed in totals.all()}
        closed_on: dict[UUID, dict[date, int]] = defaultdict(dict)
        for sprint_id, day, count in completions.all():
            closed_on[sprint_id][day] = count
        return [
            self._summary(sprint, *counts.get(sprint.id, (0, 0)), closed_on.get(sprint.id, {}))
            for sprint in sprints
        ]

    def _summary(
        self, sprint: Sprint, total: int, completed: int, closed_on: dict[date, int]
    ) -> SprintSummary:
        start = _parse_day(sprint.start_date)
        end = _parse_day(sprint.end_date)
        burndown: list[tuple[date, int]] = []
        if start is not None and start <= self.scope.today:
            last = min(end, self.scope.today) if end is not None else self.scope.today
            # Work finished before the first drawn day is already off the remaining count.
            first = max(start, last - timedelta(days=_MAX_BURNDOWN_DAYS - 1))
            remaining = total - sum(count for day, count in closed_on.items() if day < first)
            day = first
            while day <= last:
                remaining -= closed_on.get(day, 0)
                burndown.append((day, remaining))
                day += timedelta(days=1)
        return SprintSummary(
            sprint_id=sprint.id,
            project_id=sprint.project_id,
            name=sprint.name,
            start_date=sprint.start_date,
            end_date=sprint.end_date,
            total=total,
            completed=completed,
            burndown=burndown,
        )
