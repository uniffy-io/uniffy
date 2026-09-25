"""Custom field RPC handlers."""

from typing import Any

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.projects_pb import (
    CreateFieldRequest,
    CreateFieldResponse,
    DeleteFieldRequest,
    DeleteFieldResponse,
    UpdateFieldRequest,
    UpdateFieldResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.domains.projects.converters import field_to_proto, field_type_from_proto
from uniffy.domains.projects.fields.operations import (
    DEFAULT_CUSTOM_FIELD_SORT_ORDER,
    ProjectFieldOperations,
)
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.infrastructure.database import open_session


def _parse_config(raw: str) -> dict[str, Any]:
    try:
        return loads(raw)
    except JSONDecodeError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid config_json") from exc


class FieldHandlers:
    async def create_field(
        self,
        request: CreateFieldRequest,
        ctx: RequestContext,
    ) -> CreateFieldResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")
        config = _parse_config(request.config_json) if request.has_field("config_json") else {}

        try:
            async with open_session() as session:
                field = await ProjectFieldOperations(session).create(
                    user_id,
                    organization_id,
                    project_id,
                    name=request.name,
                    field_type=field_type_from_proto(request.type),
                    config=config,
                    is_required=request.is_required if request.has_field("is_required") else False,
                    sort_order=(
                        request.sort_order
                        if request.has_field("sort_order")
                        else DEFAULT_CUSTOM_FIELD_SORT_ORDER
                    ),
                )
                return CreateFieldResponse(field=field_to_proto(field))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("create_field", exc) from exc

    async def update_field(
        self,
        request: UpdateFieldRequest,
        ctx: RequestContext,
    ) -> UpdateFieldResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")
        config = _parse_config(request.config_json) if request.has_field("config_json") else None

        try:
            async with open_session() as session:
                field = await ProjectFieldOperations(session).update(
                    user_id,
                    organization_id,
                    project_id,
                    request.field_id,
                    name=request.name if request.has_field("name") else None,
                    is_required=request.is_required if request.has_field("is_required") else None,
                    sort_order=request.sort_order if request.has_field("sort_order") else None,
                    config=config,
                )
                return UpdateFieldResponse(field=field_to_proto(field))
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("update_field", exc) from exc

    async def delete_field(
        self,
        request: DeleteFieldRequest,
        ctx: RequestContext,
    ) -> DeleteFieldResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")

        try:
            async with open_session() as session:
                await ProjectFieldOperations(session).delete(
                    user_id, organization_id, project_id, request.field_id
                )
                return DeleteFieldResponse(success=True)
        except ConnectError:
            raise
        except Exception as exc:
            raise map_domain_error("delete_field", exc) from exc
