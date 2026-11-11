"""Agent assignee RPC handlers."""

from collections.abc import Awaitable, Callable
from enum import StrEnum
from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from uniffy_proto.projects.v1.agents_pb import (
    AgentAssignmentPolicy,
    GetAgentAssignmentPolicyRequest,
    GetAgentAssignmentPolicyResponse,
    UpdateAgentAssignmentPolicyRequest,
    UpdateAgentAssignmentPolicyResponse,
)
from uniffy_proto.projects.v1.projects_pb import (
    AssignTaskAgentRequest,
    AssignTaskAgentResponse,
    GetProjectRequest,
    GetProjectResponse,
    RequestTaskAgentChangesRequest,
    RequestTaskAgentChangesResponse,
    SetProjectAgentAssigneeRequest,
    SetProjectAgentAssigneeResponse,
    StartTaskAgentRequest,
    StartTaskAgentResponse,
    StopTaskAgentRequest,
    StopTaskAgentResponse,
)
from uniffy_proto.projects.v1.projects_pb import Task as ProtoTask

from uniffy.core.auth.principal import current_user_id
from uniffy.core.converters.proto import timestamp_to_datetime
from uniffy.core.models.projects.task import Task
from uniffy.core.realtime.buffer import UpdateBuffer
from uniffy.core.search import SearchIndexer
from uniffy.core.storage import ObjectStorage
from uniffy.domains.agents.tasks.admission import START_NOW, RunStart, StartMode
from uniffy.domains.projects.agents.operations import (
    ProjectAgentOperations,
    TaskAgentOperations,
    read_agent_policy,
    update_agent_policy,
)
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.tasks.handlers import _task_payload
from uniffy.domains.projects.tasks.operations import TaskOperations
from uniffy.infrastructure.database import open_session


class StartCase(StrEnum):
    WAIT_FOR_START = "wait_for_start"
    START_AT = "start_at"


def _run_start(request: AssignTaskAgentRequest) -> RunStart:
    choice = request.start
    if choice is None:
        return START_NOW
    if choice.field == StartCase.WAIT_FOR_START:
        return RunStart(mode=StartMode.WAIT) if choice.value else START_NOW
    return RunStart.scheduled(timestamp_to_datetime(choice.value))


class AgentAssigneeHandlers:
    get_project: Callable[[GetProjectRequest, RequestContext], Awaitable[GetProjectResponse]]
    storage: ObjectStorage
    search_indexer: SearchIndexer
    buffer: UpdateBuffer

    async def assign_task_agent(
        self, request: AssignTaskAgentRequest, ctx: RequestContext
    ) -> AssignTaskAgentResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")
        agent_id = (
            parse_uuid(request.agent_id, "agent_id") if request.has_field("agent_id") else None
        )
        try:
            start = _run_start(request)
            async with open_session() as session:
                task = await TaskAgentOperations(session).assign(
                    user_id, organization_id, task_id, agent_id, start
                )
                return AssignTaskAgentResponse(
                    task=await self._task_proto(session, user_id, organization_id, task)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("assign_task_agent", exc) from exc

    async def start_task_agent(
        self, request: StartTaskAgentRequest, ctx: RequestContext
    ) -> StartTaskAgentResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")
        try:
            async with open_session() as session:
                task = await TaskAgentOperations(session).start(user_id, organization_id, task_id)
                return StartTaskAgentResponse(
                    task=await self._task_proto(session, user_id, organization_id, task)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("start_task_agent", exc) from exc

    async def stop_task_agent(
        self, request: StopTaskAgentRequest, ctx: RequestContext
    ) -> StopTaskAgentResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")
        try:
            async with open_session() as session:
                task = await TaskAgentOperations(session).stop(user_id, organization_id, task_id)
                return StopTaskAgentResponse(
                    task=await self._task_proto(session, user_id, organization_id, task)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("stop_task_agent", exc) from exc

    async def request_task_agent_changes(
        self, request: RequestTaskAgentChangesRequest, ctx: RequestContext
    ) -> RequestTaskAgentChangesResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        task_id = parse_uuid(request.task_id, "task_id")
        try:
            async with open_session() as session:
                task = await TaskAgentOperations(session).request_changes(
                    user_id, organization_id, task_id, request.changes
                )
                return RequestTaskAgentChangesResponse(
                    task=await self._task_proto(session, user_id, organization_id, task)
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("request_task_agent_changes", exc) from exc

    async def _task_proto(
        self, session: AsyncSession, user_id: UUID, organization_id: UUID, task: Task
    ) -> ProtoTask:
        ops = TaskOperations(session, self.storage, self.search_indexer, self.buffer)
        payload = await _task_payload(session, ops, user_id, organization_id, task)
        return payload.task

    async def set_project_agent_assignee(
        self, request: SetProjectAgentAssigneeRequest, ctx: RequestContext
    ) -> SetProjectAgentAssigneeResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")
        agent_id = (
            parse_uuid(request.agent_id, "agent_id") if request.has_field("agent_id") else None
        )
        try:
            async with open_session() as session:
                await ProjectAgentOperations(session).set_agent_assignee(
                    user_id, organization_id, project_id, agent_id
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("set_project_agent_assignee", exc) from exc
        # The same payload GetProject returns, so clients replace the project wholesale.
        response = await self.get_project(
            GetProjectRequest(
                organization_id=request.organization_id, project_id=request.project_id
            ),
            ctx,
        )
        return SetProjectAgentAssigneeResponse(project=response.project)

    async def get_agent_assignment_policy(
        self, request: GetAgentAssignmentPolicyRequest, ctx: RequestContext
    ) -> GetAgentAssignmentPolicyResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        try:
            async with open_session() as session:
                policy = await read_agent_policy(session, user_id, organization_id)
                return GetAgentAssignmentPolicyResponse(
                    policy=AgentAssignmentPolicy(
                        agent_assignment_enabled=policy.agent_assignment_enabled
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("get_agent_assignment_policy", exc) from exc

    async def update_agent_assignment_policy(
        self, request: UpdateAgentAssignmentPolicyRequest, ctx: RequestContext
    ) -> UpdateAgentAssignmentPolicyResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        if not request.has_field("policy"):
            raise ConnectError(Code.INVALID_ARGUMENT, "policy is required")
        try:
            async with open_session() as session:
                policy = await update_agent_policy(
                    session,
                    user_id,
                    organization_id,
                    enabled=request.policy.agent_assignment_enabled,
                )
                return UpdateAgentAssignmentPolicyResponse(
                    policy=AgentAssignmentPolicy(
                        agent_assignment_enabled=policy.agent_assignment_enabled
                    )
                )
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_agent_assignment_policy", exc) from exc
