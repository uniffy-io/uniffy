"""Saved view RPC handlers."""

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.projects_pb2 import (
    CreateViewRequest,
    CreateViewResponse,
    DeleteViewRequest,
    DeleteViewResponse,
    ReorderViewsRequest,
    ReorderViewsResponse,
    UpdateViewRequest,
    UpdateViewResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.converters import view_to_proto, view_visibility_from_proto
from uniffy.domains.projects.operations import ProjectViewOperations
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


class ViewHandlers:
    async def create_view(
        self,
        request: CreateViewRequest,
        ctx: RequestContext,
    ) -> CreateViewResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")
        if not request.HasField("definition"):
            raise ConnectError(Code.INVALID_ARGUMENT, "A view needs a definition")

        try:
            async with open_session() as session:
                view = await ProjectViewOperations(session).create(
                    user_id,
                    organization_id,
                    project_id,
                    name=request.name,
                    definition=request.definition,
                    visibility=view_visibility_from_proto(request.visibility),
                )
                return CreateViewResponse(view=view_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_view", exc) from exc

    async def update_view(
        self,
        request: UpdateViewRequest,
        ctx: RequestContext,
    ) -> UpdateViewResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                view = await ProjectViewOperations(session).update(
                    user_id,
                    organization_id,
                    project_id,
                    request.view_id,
                    name=request.name if request.HasField("name") else None,
                    definition=request.definition if request.HasField("definition") else None,
                    visibility=(
                        view_visibility_from_proto(request.visibility)
                        if request.HasField("visibility")
                        else None
                    ),
                )
                return UpdateViewResponse(view=view_to_proto(view))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_view", exc) from exc

    async def delete_view(
        self,
        request: DeleteViewRequest,
        ctx: RequestContext,
    ) -> DeleteViewResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                await ProjectViewOperations(session).delete(
                    user_id, organization_id, project_id, request.view_id
                )
                return DeleteViewResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_view", exc) from exc

    async def reorder_views(
        self,
        request: ReorderViewsRequest,
        ctx: RequestContext,
    ) -> ReorderViewsResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                views = await ProjectViewOperations(session).reorder(
                    user_id,
                    organization_id,
                    project_id,
                    visibility=view_visibility_from_proto(request.visibility),
                    view_ids=list(request.view_ids),
                )
                return ReorderViewsResponse(views=[view_to_proto(view) for view in views])
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("reorder_views", exc) from exc
