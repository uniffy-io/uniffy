"""Agent tool that drafts a dashboard layout for the user to review; it never saves one."""

from typing import Any

from uniffy.core.models.chat.message import ChatMessageMetadataKind
from uniffy.domains.agents.tools.definitions import ToolContext, ToolDefinition, ToolResult
from uniffy.domains.projects.metrics.scope import PeopleScope, ProjectScope, SprintScope
from uniffy.domains.settings.dashboard.definition import (
    MAX_NAME_LENGTH,
    Definition,
    Widget,
    WidgetFilters,
    WidgetSize,
    load_catalog,
    validate_for_save,
)

_CATALOG = load_catalog()
_MAX_WIDGETS = len(_CATALOG.widgets)


def _catalog_lines() -> str:
    return "; ".join(
        f"{widget.widget_id} ({widget.description.rstrip('.')}"
        f"{', takes filters' if widget.filterable else ''})"
        for widget in _CATALOG.widgets
    )


async def _project_ids_by_name(ctx: ToolContext, names: list[str]) -> tuple[list[Any], list[str]]:
    from sqlalchemy import func, select

    from uniffy.core.auth.permissions.queries import ContentAccessQuery
    from uniffy.core.models.projects.project import Project
    from uniffy.core.types import ContentType

    wanted = {name.strip().casefold(): name for name in names if name.strip()}
    if not wanted:
        return [], []
    readable = await ContentAccessQuery(ctx.session).build_accessible_filter(
        user_id=ctx.user_id,
        organization_id=ctx.organization_id,
        content_type=ContentType.PROJECT,
        content_id_column=Project.id,
        owner_id_column=Project.owner_id,
        access_mode_column=Project.access_mode,
        baseline_role_column=Project.baseline_role,
    )
    rows = await ctx.session.execute(
        select(Project.id, Project.name).where(
            Project.organization_id == ctx.organization_id,
            Project.is_deleted == False,  # noqa: E712
            readable,
            func.lower(Project.name).in_(list(wanted)),
        )
    )
    found: dict[str, Any] = {}
    for project_id, name in rows.all():
        found.setdefault(name.casefold(), project_id)
    missing = [original for key, original in wanted.items() if key not in found]
    return list(found.values()), missing


async def _execute_propose(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.core.errors import ValidationError

    description = str(args.get("description", "")).strip()
    raw_widgets = args.get("widgets")
    if not description:
        return ToolResult(success=False, data="", error="description is required")
    if not isinstance(raw_widgets, list) or not raw_widgets:
        return ToolResult(success=False, data="", error="widgets must list at least one widget")
    if len(raw_widgets) > _MAX_WIDGETS:
        return ToolResult(success=False, data="", error=f"At most {_MAX_WIDGETS} widgets")

    widgets: list[Widget] = []
    for entry in raw_widgets:
        if not isinstance(entry, dict):
            return ToolResult(success=False, data="", error="Each widget must be an object")
        widget_type = _CATALOG.widget(str(entry.get("widget", "")))
        if widget_type is None:
            return ToolResult(
                success=False, data="", error=f"Unknown widget {entry.get('widget')!r}"
            )
        filters = WidgetFilters()
        if widget_type.filterable:
            try:
                projects = ProjectScope(entry.get("projects", ProjectScope.ALL))
                people = PeopleScope(entry.get("people", PeopleScope.EVERYONE))
                sprint = SprintScope(entry.get("sprint", SprintScope.ANY))
            except ValueError as exc:
                return ToolResult(success=False, data="", error=str(exc))
            project_ids: list[Any] = []
            if projects is ProjectScope.SELECTED:
                project_ids, missing = await _project_ids_by_name(
                    ctx, [str(name) for name in entry.get("project_names") or []]
                )
                if missing:
                    return ToolResult(
                        success=False,
                        data="",
                        error=(
                            "No readable project named "
                            + ", ".join(repr(name) for name in missing)
                            + ". Use projects.list_projects to find the exact names."
                        ),
                    )
            filters = WidgetFilters(
                projects=projects, project_ids=tuple(project_ids), people=people, sprint=sprint
            )
        size_value = entry.get("size")
        widgets.append(
            Widget(
                widget_id=widget_type.widget_id,
                size=WidgetSize(size_value) if size_value else widget_type.default_size,
                filters=filters,
            )
        )

    try:
        definition = validate_for_save(
            Definition(widgets=tuple(widgets), name=description[:MAX_NAME_LENGTH]), _CATALOG
        )
    except ValidationError as exc:
        return ToolResult(success=False, data="", error=exc.message)

    names = ", ".join(widget.widget_id for widget in definition.widgets)
    return ToolResult(
        success=True,
        data=(
            f"Drafted a dashboard with {len(definition.widgets)} widgets: {names}. "
            "The user now sees a preview card and chooses Apply or Discard; nothing changed yet. "
            "Do not claim the dashboard was saved."
        ),
        metadata={
            "kind": ChatMessageMetadataKind.DASHBOARD_PROPOSAL,
            "organization_id": str(ctx.organization_id),
            "description": description,
            "definition": definition.to_json(),
        },
    )


dashboard_propose = ToolDefinition(
    name="dashboard.propose",
    display_name="Propose Dashboard",
    group="Dashboard",
    description=(
        "Draft a home dashboard layout from the user's description. The user reviews a preview "
        "and applies or discards it; this tool never changes their dashboard. Widgets, in the "
        f"order they should appear: {_catalog_lines()}. Filters: projects is all, my_projects "
        "(projects the viewer owns or is a member of) or selected (with project_names); people "
        "is everyone, me or my_teams; sprint is any or active. Filters resolve for whoever "
        "opens the dashboard."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": (
                    "The dashboard's name, a few words such as 'QA view for Website'; "
                    "the user sees it as the dashboard title."
                ),
            },
            "widgets": {
                "type": "array",
                "minItems": 1,
                "maxItems": _MAX_WIDGETS,
                "items": {
                    "type": "object",
                    "properties": {
                        "widget": {
                            "type": "string",
                            "enum": [widget.widget_id for widget in _CATALOG.widgets],
                        },
                        "size": {"type": "string", "enum": [size.value for size in WidgetSize]},
                        "projects": {
                            "type": "string",
                            "enum": [scope.value for scope in ProjectScope],
                        },
                        "project_names": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Exact project names, only with projects=selected.",
                        },
                        "people": {
                            "type": "string",
                            "enum": [scope.value for scope in PeopleScope],
                        },
                        "sprint": {
                            "type": "string",
                            "enum": [scope.value for scope in SprintScope],
                        },
                    },
                    "required": ["widget"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["description", "widgets"],
        "additionalProperties": False,
    },
    executor=_execute_propose,
    read_only=True,
    timeout_seconds=15,
)

DASHBOARD_TOOLS: list[ToolDefinition] = [dashboard_propose]
