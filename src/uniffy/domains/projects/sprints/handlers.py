"""Sprint RPC handlers."""

from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.projects_pb import (
    CompleteSprintRequest,
    CompleteSprintResponse,
    CreateSprintRequest,
    CreateSprintResponse,
    DeleteSprintRequest,
    DeleteSprintResponse,
    ListSprintsRequest,
    ListSprintsResponse,
    StartSprintRequest,
    StartSprintResponse,
    UpdateSprintRequest,
    UpdateSprintResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.converters import sprint_to_proto
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.sprints.operations import SprintOperations
from uniffy.infrastructure.database import open_session


class SprintHandlers:
    async def create_sprint(
        self,
        request: CreateSprintRequest,
        ctx: RequestContext,
    ) -> CreateSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.create(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    name=request.name,
                    goal=request.goal if request.has_field("goal") else "",
                    start_date=request.start_date if request.has_field("start_date") else None,
                    end_date=request.end_date if request.has_field("end_date") else None,
                )
                return CreateSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_sprint", exc) from exc

    async def update_sprint(
        self,
        request: UpdateSprintRequest,
        ctx: RequestContext,
    ) -> UpdateSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.update(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    name=request.name if request.has_field("name") else None,
                    goal=request.goal if request.has_field("goal") else None,
                    start_date=request.start_date if request.has_field("start_date") else None,
                    end_date=request.end_date if request.has_field("end_date") else None,
                )
                return UpdateSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_sprint", exc) from exc

    async def start_sprint(
        self,
        request: StartSprintRequest,
        ctx: RequestContext,
    ) -> StartSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.start(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                    start_date=request.start_date if request.has_field("start_date") else None,
                    end_date=request.end_date if request.has_field("end_date") else None,
                )
                return StartSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("start_sprint", exc) from exc

    async def complete_sprint(
        self,
        request: CompleteSprintRequest,
        ctx: RequestContext,
    ) -> CompleteSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                sprint = await ops.complete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return CompleteSprintResponse(sprint=sprint_to_proto(sprint))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("complete_sprint", exc) from exc

    async def delete_sprint(
        self,
        request: DeleteSprintRequest,
        ctx: RequestContext,
    ) -> DeleteSprintResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        sprint_id = parse_uuid(request.sprint_id, "sprint_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                await ops.delete(
                    user_id=user_id,
                    organization_id=organization_id,
                    sprint_id=sprint_id,
                )
                return DeleteSprintResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_sprint", exc) from exc

    async def list_sprints(
        self,
        request: ListSprintsRequest,
        ctx: RequestContext,
    ) -> ListSprintsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                ops = SprintOperations(session)
                include_closed = (
                    request.include_closed if request.has_field("include_closed") else False
                )
                sprints = await ops.list_sprints(
                    user_id=user_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    include_closed=include_closed,
                )

                sprint_ids = [s.id for s in sprints]
                counts = await ops.get_task_counts(sprint_ids)

                sprint_protos = []
                for sprint in sprints:
                    total, completed = counts.get(str(sprint.id), (0, 0))
                    sprint_protos.append(sprint_to_proto(sprint, total, completed))

                return ListSprintsResponse(sprints=sprint_protos)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("list_sprints", exc) from exc
