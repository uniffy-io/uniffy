"""Task export RPC handler."""

from collections.abc import AsyncIterator

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.projects_pb import (
    ExportTasksRequest,
    ExportTasksResponse,
    TaskExportFormat,
    TaskExportLayout,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.export.operations import ProjectExportOperations, record_export
from uniffy.domains.projects.export.plan import ExportLayout, ExportRequest
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


class ExportHandlers:
    async def export_tasks(
        self,
        request: ExportTasksRequest,
        ctx: RequestContext,
    ) -> AsyncIterator[ExportTasksResponse]:
        user_id = current_user_id()
        if request.format != TaskExportFormat.CSV:
            raise ConnectError(Code.INVALID_ARGUMENT, "Export format must be CSV")
        export = ExportRequest(
            organization_id=parse_uuid(request.organization_id, "organization_id"),
            project_ids=tuple(parse_uuid(raw, "project_ids") for raw in request.project_ids),
            task_filter=request.filter if request.has_field("filter") else None,
            sort=tuple(request.sort),
            view_id=request.view_id if request.has_field("view_id") else None,
            layout=(
                ExportLayout.OUTLINE
                if request.layout == TaskExportLayout.OUTLINE
                else ExportLayout.FLAT
            ),
            include_bundle=request.include_bundle,
            time_zone=request.time_zone if request.has_field("time_zone") else None,
        )

        try:
            async with open_session() as session:
                ops = ProjectExportOperations(session)
                plan = await ops.prepare(user_id, export)
                async with open_session() as audit_session:
                    await record_export(audit_session, user_id, plan)
                async for chunk in ops.stream(plan):
                    yield ExportTasksResponse(payload=chunk)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("export_tasks", exc) from exc
