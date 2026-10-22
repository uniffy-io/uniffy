"""Time tracking RPC handlers mixed into the projects service."""

from __future__ import annotations

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from protobuf import Oneof
from uniffy_proto.projects.v1.time_pb import (
    AggregateWorklogsRequest,
    AggregateWorklogsResponse,
    CreateWorklogRequest,
    CreateWorklogResponse,
    DeleteWorklogRequest,
    DeleteWorklogResponse,
    GetActiveTimerRequest,
    GetActiveTimerResponse,
    GetTimePolicyRequest,
    GetTimePolicyResponse,
    ListTaskWorklogsRequest,
    ListTaskWorklogsResponse,
    ListUserWorklogsRequest,
    ListUserWorklogsResponse,
    PauseTimerRequest,
    PauseTimerResponse,
    ResumeTimerRequest,
    ResumeTimerResponse,
    StartTimerRequest,
    StartTimerResponse,
    StopTimerRequest,
    StopTimerResponse,
    UpdateTimePolicyRequest,
    UpdateTimePolicyResponse,
    UpdateWorklogRequest,
    UpdateWorklogResponse,
)

from uniffy.core.audit import write_audit_event
from uniffy.core.audit.actions import Action
from uniffy.core.auth.principal import current_user_id
from uniffy.core.models.audit.event import AuditResourceType
from uniffy.domains.organizations.operations import OrganizationOperations
from uniffy.domains.projects.rpc import map_domain_error, parse_date, parse_uuid
from uniffy.domains.projects.time.access import TimeAccess
from uniffy.domains.projects.time.converters import (
    aggregate_row_to_proto,
    group_by_from_proto,
    policy_from_proto,
    policy_to_proto,
    worklog_to_proto,
)
from uniffy.domains.projects.time.policy import (
    _to_blob,
    load_time_policy,
    save_time_policy,
)
from uniffy.domains.projects.time.worklogs import WorklogOperations
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="projects.time.handlers")


def parse_aggregate_scope(request: AggregateWorklogsRequest) -> tuple[UUID | None, UUID | None]:
    """The (project_id, user_id) pair behind the request's scope oneof."""
    match request.scope:
        case Oneof(field="project_id", value=raw):
            return parse_uuid(raw, "project_id"), None
        case Oneof(field="user_id", value=raw):
            return None, parse_uuid(raw, "user_id")
        case _:
            raise ConnectError(
                Code.INVALID_ARGUMENT, "Invalid scope: a project or a person is required"
            )


class TimeHandlers:
    async def create_worklog(
        self, request: CreateWorklogRequest, ctx: RequestContext
    ) -> CreateWorklogResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")
        work_date = parse_date(request.work_date, "work_date")
        subject_id = (
            parse_uuid(request.user_id, "user_id")
            if request.has_field("user_id") and request.user_id
            else None
        )
        try:
            async with open_session() as session:
                row, rollup = await WorklogOperations(session).create(
                    user_id,
                    organization_id,
                    task_id,
                    user_id=subject_id,
                    work_date=work_date,
                    duration_minutes=request.duration_minutes,
                    description=request.description,
                )
                return CreateWorklogResponse(
                    worklog=worklog_to_proto(row.worklog, row.project_id),
                    task_time_spent_minutes=rollup,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_worklog", exc) from exc

    async def update_worklog(
        self, request: UpdateWorklogRequest, ctx: RequestContext
    ) -> UpdateWorklogResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        worklog_id = parse_uuid(request.worklog_id, "worklog_id")
        work_date = (
            parse_date(request.work_date, "work_date") if request.has_field("work_date") else None
        )
        try:
            async with open_session() as session:
                row, rollup = await WorklogOperations(session).update(
                    user_id,
                    organization_id,
                    worklog_id,
                    work_date=work_date,
                    duration_minutes=(
                        request.duration_minutes if request.has_field("duration_minutes") else None
                    ),
                    description=request.description if request.has_field("description") else None,
                )
                return UpdateWorklogResponse(
                    worklog=worklog_to_proto(row.worklog, row.project_id),
                    task_time_spent_minutes=rollup,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_worklog", exc) from exc

    async def delete_worklog(
        self, request: DeleteWorklogRequest, ctx: RequestContext
    ) -> DeleteWorklogResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        worklog_id = parse_uuid(request.worklog_id, "worklog_id")
        try:
            async with open_session() as session:
                task_id, rollup = await WorklogOperations(session).delete(
                    user_id, organization_id, worklog_id
                )
                return DeleteWorklogResponse(task_id=str(task_id), task_time_spent_minutes=rollup)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_worklog", exc) from exc

    async def list_task_worklogs(
        self, request: ListTaskWorklogsRequest, ctx: RequestContext
    ) -> ListTaskWorklogsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")
        try:
            async with open_session() as session:
                rows, next_token = await WorklogOperations(session).list_for_task(
                    user_id,
                    organization_id,
                    task_id,
                    page_size=request.page_size,
                    page_token=request.page_token,
                )
                return ListTaskWorklogsResponse(
                    worklogs=[worklog_to_proto(row.worklog, row.project_id) for row in rows],
                    next_page_token=next_token,
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_task_worklogs", exc) from exc

    async def list_user_worklogs(
        self, request: ListUserWorklogsRequest, ctx: RequestContext
    ) -> ListUserWorklogsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        subject_id = (
            parse_uuid(request.user_id, "user_id")
            if request.has_field("user_id") and request.user_id
            else user_id
        )
        from_date = parse_date(request.from_date, "from_date")
        to_date = parse_date(request.to_date, "to_date")
        try:
            async with open_session() as session:
                rows = await WorklogOperations(session).list_for_user(
                    user_id, organization_id, subject_id, from_date=from_date, to_date=to_date
                )
                return ListUserWorklogsResponse(
                    worklogs=[worklog_to_proto(row.worklog, row.project_id) for row in rows]
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_user_worklogs", exc) from exc

    async def aggregate_worklogs(
        self, request: AggregateWorklogsRequest, ctx: RequestContext
    ) -> AggregateWorklogsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        from_date = parse_date(request.from_date, "from_date")
        to_date = parse_date(request.to_date, "to_date")
        project_id, subject_id = parse_aggregate_scope(request)
        try:
            group_by = group_by_from_proto(request.group_by)
            async with open_session() as session:
                rows = await WorklogOperations(session).aggregate(
                    user_id,
                    organization_id,
                    from_date=from_date,
                    to_date=to_date,
                    group_by=group_by,
                    project_id=project_id,
                    user_id=subject_id,
                )
                return AggregateWorklogsResponse(
                    rows=[aggregate_row_to_proto(row) for row in rows],
                    total_minutes=sum(row.minutes for row in rows),
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("aggregate_worklogs", exc) from exc

    async def get_time_policy(
        self, request: GetTimePolicyRequest, ctx: RequestContext
    ) -> GetTimePolicyResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                await OrganizationOperations(session).require_org_member(user_id, organization_id)
                policy = await load_time_policy(session, organization_id)
                return GetTimePolicyResponse(policy=policy_to_proto(policy))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_time_policy", exc) from exc

    async def update_time_policy(
        self, request: UpdateTimePolicyRequest, ctx: RequestContext
    ) -> UpdateTimePolicyResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                await TimeAccess(session).require_timekeeping_admin(user_id, organization_id)
                policy = policy_from_proto(organization_id, request.policy)
                await save_time_policy(session, policy=policy, updated_by_user_id=user_id)
                await write_audit_event(
                    session,
                    organization_id=organization_id,
                    actor_user_id=user_id,
                    action=Action.TIME_POLICY_UPDATED,
                    resource_type=AuditResourceType.ORGANIZATION,
                    resource_id=organization_id,
                    details=_to_blob(policy),
                )
                await session.commit()
                return UpdateTimePolicyResponse(policy=policy_to_proto(policy))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_time_policy", exc) from exc

    # The generated service is a Protocol, so the ASGI app resolves every RPC on this
    # class; a missing attribute fails the whole service, not just the one call.
    async def start_timer(
        self, request: StartTimerRequest, ctx: RequestContext
    ) -> StartTimerResponse:
        raise ConnectError(Code.UNIMPLEMENTED, "Timers are not available yet")

    async def pause_timer(
        self, request: PauseTimerRequest, ctx: RequestContext
    ) -> PauseTimerResponse:
        raise ConnectError(Code.UNIMPLEMENTED, "Timers are not available yet")

    async def resume_timer(
        self, request: ResumeTimerRequest, ctx: RequestContext
    ) -> ResumeTimerResponse:
        raise ConnectError(Code.UNIMPLEMENTED, "Timers are not available yet")

    async def stop_timer(self, request: StopTimerRequest, ctx: RequestContext) -> StopTimerResponse:
        raise ConnectError(Code.UNIMPLEMENTED, "Timers are not available yet")

    async def get_active_timer(
        self, request: GetActiveTimerRequest, ctx: RequestContext
    ) -> GetActiveTimerResponse:
        raise ConnectError(Code.UNIMPLEMENTED, "Timers are not available yet")
