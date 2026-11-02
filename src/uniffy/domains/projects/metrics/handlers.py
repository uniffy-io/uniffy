"""Task metrics RPC handler."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.metrics_pb import (
    BugTrendPoint,
    BurndownPoint,
    GetTaskMetricsRequest,
    GetTaskMetricsResponse,
    MetricPeopleScope,
    MetricProjectScope,
    MetricSprintScope,
    ProjectStatusRow,
    SprintProgress,
    TaskMetric,
    TaskMetricItem,
    TaskMetricsScope,
    WorkloadRow,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.metrics.queries import MetricItem, TaskList, TaskMetricsReader
from uniffy.domains.projects.metrics.scope import (
    MAX_SELECTED_PROJECTS,
    MetricScope,
    PeopleScope,
    ProjectScope,
    SprintScope,
    resolve_scope,
)
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session

_PROJECT_SCOPE = {
    MetricProjectScope.UNSPECIFIED: ProjectScope.ALL,
    MetricProjectScope.ALL: ProjectScope.ALL,
    MetricProjectScope.MY_PROJECTS: ProjectScope.MY_PROJECTS,
    MetricProjectScope.SELECTED: ProjectScope.SELECTED,
}
_PEOPLE_SCOPE = {
    MetricPeopleScope.UNSPECIFIED: PeopleScope.EVERYONE,
    MetricPeopleScope.EVERYONE: PeopleScope.EVERYONE,
    MetricPeopleScope.ME: PeopleScope.ME,
    MetricPeopleScope.MY_TEAMS: PeopleScope.MY_TEAMS,
}
_SPRINT_SCOPE = {
    MetricSprintScope.UNSPECIFIED: SprintScope.ANY,
    MetricSprintScope.ANY: SprintScope.ANY,
    MetricSprintScope.ACTIVE: SprintScope.ACTIVE,
}

DEFAULT_LIMIT = 8
MAX_LIMIT = 50
DEFAULT_DAYS = 30
MIN_DAYS = 7
MAX_DAYS = 180


def scope_from_proto(scope: TaskMetricsScope | None) -> MetricScope:
    if scope is None:
        return MetricScope()
    projects = _PROJECT_SCOPE.get(scope.projects)
    people = _PEOPLE_SCOPE.get(scope.people)
    sprint = _SPRINT_SCOPE.get(scope.sprint)
    if projects is None or people is None or sprint is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Unknown metrics scope")
    if len(scope.project_ids) > MAX_SELECTED_PROJECTS:
        raise ConnectError(
            Code.INVALID_ARGUMENT, f"At most {MAX_SELECTED_PROJECTS} projects can be selected"
        )
    project_ids: tuple[UUID, ...] = tuple(
        parse_uuid(project_id, "project_ids") for project_id in scope.project_ids
    )
    return MetricScope(projects=projects, project_ids=project_ids, people=people, sprint=sprint)


def _item_to_proto(item: MetricItem) -> TaskMetricItem:
    return TaskMetricItem(
        task_id=str(item.task_id),
        project_id=str(item.project_id),
        number=item.number,
        title=item.title,
        due_date=item.due_date or "",
        assignee_ids=item.assignee_ids,
        status=item.status,
        priority=item.priority,
    )


def _list_response(tasks: TaskList) -> GetTaskMetricsResponse:
    return GetTaskMetricsResponse(
        total=tasks.total, items=[_item_to_proto(item) for item in tasks.items]
    )


async def _metric(
    reader: TaskMetricsReader, metric: TaskMetric, limit: int, days: int
) -> GetTaskMetricsResponse:
    if metric == TaskMetric.OVERDUE:
        return _list_response(await reader.overdue(limit))
    if metric == TaskMetric.BLOCKED:
        return _list_response(await reader.blocked(limit))
    if metric == TaskMetric.REVIEW_QUEUE:
        return _list_response(await reader.review_queue(limit))
    if metric == TaskMetric.WORKLOAD:
        total, rows = await reader.workload(limit)
        return GetTaskMetricsResponse(
            total=total,
            workload=[
                WorkloadRow(user_id=row.user_id or "", open=row.open, overdue=row.overdue)
                for row in rows
            ],
        )
    if metric == TaskMetric.STATUS_BY_PROJECT:
        rows = await reader.status_by_project(limit)
        return GetTaskMetricsResponse(
            total=sum(row.todo + row.in_progress + row.review for row in rows),
            status_by_project=[
                ProjectStatusRow(
                    project_id=str(row.project_id),
                    todo=row.todo,
                    in_progress=row.in_progress,
                    review=row.review,
                    completed=row.completed,
                )
                for row in rows
            ],
        )
    if metric == TaskMetric.BUG_TREND:
        points = await reader.bug_trend(days)
        return GetTaskMetricsResponse(
            total=sum(point.opened for point in points),
            bug_trend=[
                BugTrendPoint(date=point.day.isoformat(), opened=point.opened, closed=point.closed)
                for point in points
            ],
        )
    if metric == TaskMetric.SPRINT_PROGRESS:
        sprints = await reader.sprints(limit)
        return GetTaskMetricsResponse(
            total=len(sprints),
            sprints=[
                SprintProgress(
                    sprint_id=str(sprint.sprint_id),
                    project_id=str(sprint.project_id),
                    name=sprint.name,
                    start_date=sprint.start_date or "",
                    end_date=sprint.end_date or "",
                    total=sprint.total,
                    completed=sprint.completed,
                    burndown=[
                        BurndownPoint(date=day.isoformat(), remaining=remaining)
                        for day, remaining in sprint.burndown
                    ],
                )
                for sprint in sprints
            ],
        )
    raise ConnectError(Code.INVALID_ARGUMENT, "Unknown metric")


class MetricsHandlers:
    async def get_task_metrics(
        self,
        request: GetTaskMetricsRequest,
        ctx: RequestContext,
    ) -> GetTaskMetricsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        scope = scope_from_proto(request.scope if request.has_field("scope") else None)
        limit = min(request.limit, MAX_LIMIT) if request.limit > 0 else DEFAULT_LIMIT
        days = min(max(request.days, MIN_DAYS), MAX_DAYS) if request.days > 0 else DEFAULT_DAYS

        try:
            async with open_session() as session:
                resolved = await resolve_scope(
                    session, user_id, organization_id, scope, request.time_zone
                )
                return await _metric(
                    TaskMetricsReader(session, resolved), request.metric, limit, days
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_task_metrics", exc) from exc
