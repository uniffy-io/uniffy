"""Dashboard layout RPC handlers on the settings service."""

from uuid import UUID

from connectrpc.code import Code
from connectrpc.errors import ConnectError
from connectrpc.request import RequestContext
from loguru import logger
from uniffy_proto.settings.v1.dashboard_pb import (
    Dashboard,
    DashboardDefinition,
    DashboardPeopleScope,
    DashboardPreset,
    DashboardProjectScope,
    DashboardSprintScope,
    DashboardWidget,
    DashboardWidgetFilters,
    DashboardWidgetSize,
    DashboardWidgetType,
    GetDashboardCatalogRequest,
    GetDashboardCatalogResponse,
    GetDashboardRequest,
    GetDashboardResponse,
    RestorePreviousDashboardRequest,
    RestorePreviousDashboardResponse,
    SaveDashboardRequest,
    SaveDashboardResponse,
)

from uniffy.core.auth.principal import current_user_id
from uniffy.core.errors import ConflictError, UNIFFYError
from uniffy.domains.projects.metrics.scope import PeopleScope, ProjectScope, SprintScope
from uniffy.domains.settings.dashboard.definition import (
    Definition,
    Widget,
    WidgetFilters,
    WidgetSize,
    load_catalog,
)
from uniffy.domains.settings.dashboard.operations import DashboardOperations, StoredDashboard
from uniffy.infrastructure.database import open_session

logger = logger.bind(component="settings.dashboard.handlers")

_PROJECTS_TO_PROTO = {
    ProjectScope.ALL: DashboardProjectScope.ALL,
    ProjectScope.MY_PROJECTS: DashboardProjectScope.MY_PROJECTS,
    ProjectScope.SELECTED: DashboardProjectScope.SELECTED,
}
_PEOPLE_TO_PROTO = {
    PeopleScope.EVERYONE: DashboardPeopleScope.EVERYONE,
    PeopleScope.ME: DashboardPeopleScope.ME,
    PeopleScope.MY_TEAMS: DashboardPeopleScope.MY_TEAMS,
}
_SPRINT_TO_PROTO = {
    SprintScope.ANY: DashboardSprintScope.ANY,
    SprintScope.ACTIVE: DashboardSprintScope.ACTIVE,
}
_SIZE_TO_PROTO = {
    WidgetSize.COMPACT: DashboardWidgetSize.COMPACT,
    WidgetSize.EXPANDED: DashboardWidgetSize.EXPANDED,
}
_PROJECTS_FROM_PROTO = {v: k for k, v in _PROJECTS_TO_PROTO.items()} | {
    DashboardProjectScope.UNSPECIFIED: ProjectScope.ALL
}
_PEOPLE_FROM_PROTO = {v: k for k, v in _PEOPLE_TO_PROTO.items()} | {
    DashboardPeopleScope.UNSPECIFIED: PeopleScope.EVERYONE
}
_SPRINT_FROM_PROTO = {v: k for k, v in _SPRINT_TO_PROTO.items()} | {
    DashboardSprintScope.UNSPECIFIED: SprintScope.ANY
}
_SIZE_FROM_PROTO = {v: k for k, v in _SIZE_TO_PROTO.items()}


def definition_to_proto(definition: Definition) -> DashboardDefinition:
    return DashboardDefinition(
        version=definition.version,
        preset=definition.preset,
        name=definition.name,
        widgets=[
            DashboardWidget(
                widget_id=widget.widget_id,
                visible=widget.visible,
                size=_SIZE_TO_PROTO[widget.size],
                filters=DashboardWidgetFilters(
                    projects=_PROJECTS_TO_PROTO[widget.filters.projects],
                    project_ids=[str(project_id) for project_id in widget.filters.project_ids],
                    people=_PEOPLE_TO_PROTO[widget.filters.people],
                    sprint=_SPRINT_TO_PROTO[widget.filters.sprint],
                ),
                unsupported_filters=list(widget.unsupported_filters),
            )
            for widget in definition.widgets
        ],
    )


def _filters_from_proto(filters: DashboardWidgetFilters | None) -> WidgetFilters:
    if filters is None:
        return WidgetFilters()
    projects = _PROJECTS_FROM_PROTO.get(filters.projects)
    people = _PEOPLE_FROM_PROTO.get(filters.people)
    sprint = _SPRINT_FROM_PROTO.get(filters.sprint)
    if projects is None or people is None or sprint is None:
        raise ConnectError(Code.INVALID_ARGUMENT, "Unknown widget filter")
    try:
        project_ids = tuple(UUID(project_id) for project_id in filters.project_ids)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid project id in widget filter") from exc
    return WidgetFilters(projects=projects, project_ids=project_ids, people=people, sprint=sprint)


def definition_from_proto(definition: DashboardDefinition) -> Definition:
    catalog = load_catalog()
    widgets: list[Widget] = []
    for widget in definition.widgets:
        widget_type = catalog.widget(widget.widget_id)
        size = _SIZE_FROM_PROTO.get(widget.size)
        if size is None:
            size = widget_type.default_size if widget_type else WidgetSize.EXPANDED
        widgets.append(
            Widget(
                widget_id=widget.widget_id,
                visible=widget.visible,
                size=size,
                filters=_filters_from_proto(widget.filters if widget.has_field("filters") else None),
            )
        )
    return Definition(widgets=tuple(widgets), preset=definition.preset, name=definition.name)


def _dashboard_to_proto(stored: StoredDashboard) -> Dashboard:
    dashboard = Dashboard(revision=stored.revision, has_previous=stored.has_previous)
    if stored.definition is not None:
        dashboard.definition = definition_to_proto(stored.definition)
    return dashboard


def _parse_org(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ConnectError(Code.INVALID_ARGUMENT, "Invalid organization_id") from exc


def _internal(operation: str, exc: Exception) -> ConnectError:
    if isinstance(exc, ConflictError):
        # A concurrent save, not a duplicate: the client reloads and retries.
        return ConnectError(Code.ABORTED, str(exc))
    if isinstance(exc, (ConnectError, UNIFFYError)):
        raise exc
    logger.exception(f"Error in {operation}")
    return ConnectError(Code.INTERNAL, "Internal server error")


class DashboardHandlers:
    async def get_dashboard_catalog(
        self,
        request: GetDashboardCatalogRequest,
        ctx: RequestContext,
    ) -> GetDashboardCatalogResponse:
        catalog = load_catalog()
        return GetDashboardCatalogResponse(
            widgets=[
                DashboardWidgetType(
                    widget_id=widget.widget_id,
                    label=widget.label,
                    description=widget.description,
                    filterable=widget.filterable,
                    default_size=_SIZE_TO_PROTO[widget.default_size],
                )
                for widget in catalog.widgets
            ],
            presets=[
                DashboardPreset(
                    preset_id=preset.preset_id,
                    label=preset.label,
                    description=preset.description,
                    definition=definition_to_proto(preset.definition),
                )
                for preset in catalog.presets
            ],
            default_definition=definition_to_proto(catalog.default),
        )

    async def get_dashboard(
        self,
        request: GetDashboardRequest,
        ctx: RequestContext,
    ) -> GetDashboardResponse:
        user_id = current_user_id()
        organization_id = _parse_org(request.organization_id)
        try:
            async with open_session() as session:
                stored = await DashboardOperations(session).get(user_id, organization_id)
                return GetDashboardResponse(dashboard=_dashboard_to_proto(stored))
        except Exception as exc:
            raise _internal("get_dashboard", exc) from exc

    async def save_dashboard(
        self,
        request: SaveDashboardRequest,
        ctx: RequestContext,
    ) -> SaveDashboardResponse:
        user_id = current_user_id()
        organization_id = _parse_org(request.organization_id)
        if not request.has_field("definition"):
            raise ConnectError(Code.INVALID_ARGUMENT, "definition is required")
        definition = definition_from_proto(request.definition)
        try:
            async with open_session() as session:
                stored = await DashboardOperations(session).save(
                    user_id,
                    organization_id,
                    definition,
                    request.expected_revision,
                    keep_previous=request.keep_previous,
                )
                return SaveDashboardResponse(dashboard=_dashboard_to_proto(stored))
        except Exception as exc:
            raise _internal("save_dashboard", exc) from exc

    async def restore_previous_dashboard(
        self,
        request: RestorePreviousDashboardRequest,
        ctx: RequestContext,
    ) -> RestorePreviousDashboardResponse:
        user_id = current_user_id()
        organization_id = _parse_org(request.organization_id)
        try:
            async with open_session() as session:
                stored = await DashboardOperations(session).restore_previous(
                    user_id, organization_id, request.expected_revision
                )
                return RestorePreviousDashboardResponse(dashboard=_dashboard_to_proto(stored))
        except Exception as exc:
            raise _internal("restore_previous_dashboard", exc) from exc
