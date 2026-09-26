"""Saved view RPC handlers."""

from functools import cache

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from uniffy_proto.projects.v1.projects_pb import (
    CreateViewRequest,
    CreateViewResponse,
    DeleteViewRequest,
    DeleteViewResponse,
    GetViewCatalogRequest,
    GetViewCatalogResponse,
    ReorderViewsRequest,
    ReorderViewsResponse,
    UpdateViewRequest,
    UpdateViewResponse,
    ViewCatalogFieldType,
    ViewCatalogPseudoField,
    ViewFieldCapabilities,
    ViewFilterLimits,
    ViewIdFlag,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.domains.projects.converters import (
    FIELD_TYPE_TO_PROTO,
    view_to_proto,
    view_visibility_from_proto,
)
from uniffy.domains.projects.operations import ProjectViewOperations
from uniffy.domains.projects.rpc import map_domain_error, parse_uuid
from uniffy.domains.projects.views.catalog import (
    FIELD_TYPE_KINDS,
    GROUPABLE_KINDS,
    ID_FLAGS,
    PSEUDO_FIELD_KINDS,
    SORTABLE_KINDS,
    FieldKind,
    IdFlag,
    PseudoField,
    operators_for,
)
from uniffy.domains.projects.views.definition import (
    MAX_FILTER_DEPTH,
    MAX_FILTER_NODES,
    MAX_IDS_PER_CONDITION,
    MAX_RELATIVE_OFFSET_DAYS,
    MAX_TEXT_LENGTH,
)
from uniffy.infrastructure.database import open_session

_ID_FLAGS: dict[IdFlag, ViewIdFlag] = {
    IdFlag.CURRENT_USER: ViewIdFlag.CURRENT_USER,
    IdFlag.EMPTY: ViewIdFlag.EMPTY,
    IdFlag.ACTIVE_SPRINT: ViewIdFlag.ACTIVE_SPRINT,
}


def _capabilities(kind: FieldKind, pseudo: PseudoField | None) -> ViewFieldCapabilities:
    return ViewFieldCapabilities(
        operators=sorted(operators_for(kind, pseudo)),
        id_flags=sorted(_ID_FLAGS[flag] for flag in ID_FLAGS.get(kind, ())),
        sortable=kind in SORTABLE_KINDS,
        groupable=kind in GROUPABLE_KINDS,
    )


@cache
def view_catalog() -> GetViewCatalogResponse:
    """The catalog and limits the definition validator applies, so clients offer only what saves."""
    return GetViewCatalogResponse(
        field_types=[
            ViewCatalogFieldType(
                type=FIELD_TYPE_TO_PROTO[field_type], capabilities=_capabilities(kind, None)
            )
            for field_type, kind in FIELD_TYPE_KINDS.items()
        ],
        pseudo_fields=[
            ViewCatalogPseudoField(pseudo=pseudo, capabilities=_capabilities(kind, pseudo))
            for pseudo, kind in PSEUDO_FIELD_KINDS.items()
        ],
        filter_limits=ViewFilterLimits(
            max_depth=MAX_FILTER_DEPTH,
            max_nodes=MAX_FILTER_NODES,
            max_ids_per_condition=MAX_IDS_PER_CONDITION,
            max_text_length=MAX_TEXT_LENGTH,
            max_relative_offset_days=MAX_RELATIVE_OFFSET_DAYS,
        ),
    )


class ViewHandlers:
    async def create_view(
        self,
        request: CreateViewRequest,
        ctx: RequestContext,
    ) -> CreateViewResponse:
        user_id = current_user_id()
        organization_id = parse_uuid(request.organization_id, "organization_id")
        project_id = parse_uuid(request.project_id, "project_id")
        if not request.has_field("definition"):
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
                    name=request.name if request.has_field("name") else None,
                    definition=request.definition if request.has_field("definition") else None,
                    visibility=(
                        view_visibility_from_proto(request.visibility)
                        if request.has_field("visibility")
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

    async def get_view_catalog(
        self,
        request: GetViewCatalogRequest,
        ctx: RequestContext,
    ) -> GetViewCatalogResponse:
        # Static data, but still only for a signed-in caller.
        current_user_id()
        return view_catalog()
