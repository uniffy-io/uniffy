"""Dashboard definitions: the stored document, its widget catalog and the templates."""

from dataclasses import dataclass, field, replace
from enum import StrEnum
from functools import cache
from typing import Any
from uuid import UUID

from uniffy.core.data_files import DATA_DIR
from uniffy.core.errors import ValidationError
from uniffy.core.json_codec import loads
from uniffy.domains.projects.metrics.scope import (
    MAX_SELECTED_PROJECTS,
    PeopleScope,
    ProjectScope,
    SprintScope,
)

DEFINITION_VERSION = 1
MAX_NAME_LENGTH = 80
_CATALOG_PATH = DATA_DIR / "dashboards" / "catalog.json"


class WidgetSize(StrEnum):
    COMPACT = "compact"
    EXPANDED = "expanded"


class FilterKey(StrEnum):
    PROJECTS = "projects"
    PROJECT_IDS = "project_ids"
    PEOPLE = "people"
    SPRINT = "sprint"


@dataclass(frozen=True)
class WidgetFilters:
    projects: ProjectScope = ProjectScope.ALL
    project_ids: tuple[UUID, ...] = ()
    people: PeopleScope = PeopleScope.EVERYONE
    sprint: SprintScope = SprintScope.ANY

    def to_json(self) -> dict[str, Any]:
        return {
            FilterKey.PROJECTS.value: self.projects.value,
            FilterKey.PROJECT_IDS.value: [str(project_id) for project_id in self.project_ids],
            FilterKey.PEOPLE.value: self.people.value,
            FilterKey.SPRINT.value: self.sprint.value,
        }


@dataclass(frozen=True)
class Widget:
    widget_id: str
    visible: bool = True
    size: WidgetSize = WidgetSize.EXPANDED
    filters: WidgetFilters = field(default_factory=WidgetFilters)
    unsupported_filters: tuple[str, ...] = ()

    def to_json(self) -> dict[str, Any]:
        stored: dict[str, Any] = {
            "id": self.widget_id,
            "visible": self.visible,
            "size": self.size.value,
            "filters": self.filters.to_json(),
        }
        if self.unsupported_filters:
            stored["unsupported_filters"] = list(self.unsupported_filters)
        return stored


@dataclass(frozen=True)
class Definition:
    widgets: tuple[Widget, ...]
    preset: str = ""
    name: str = ""
    version: int = DEFINITION_VERSION

    def to_json(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "preset": self.preset,
            "name": self.name,
            "widgets": [widget.to_json() for widget in self.widgets],
        }


@dataclass(frozen=True)
class WidgetType:
    widget_id: str
    label: str
    description: str
    filterable: bool
    default_size: WidgetSize


@dataclass(frozen=True)
class Preset:
    preset_id: str
    label: str
    description: str
    definition: Definition


@dataclass(frozen=True)
class Catalog:
    widgets: tuple[WidgetType, ...]
    presets: tuple[Preset, ...]
    default: Definition

    def widget(self, widget_id: str) -> WidgetType | None:
        return next((w for w in self.widgets if w.widget_id == widget_id), None)

    def preset(self, preset_id: str) -> Preset | None:
        return next((p for p in self.presets if p.preset_id == preset_id), None)


def _enum[E: StrEnum](kind: type[E], value: Any) -> E | None:
    try:
        return kind(value)
    except ValueError:
        return None


def _stored_filters(raw: Any) -> tuple[WidgetFilters, tuple[str, ...]]:
    """Reads stored filters; anything this version cannot apply is reported, never dropped."""
    if not isinstance(raw, dict):
        return WidgetFilters(), ()
    unsupported = sorted(key for key in raw if _enum(FilterKey, key) is None)
    projects = _enum(ProjectScope, raw.get(FilterKey.PROJECTS, ProjectScope.ALL))
    people = _enum(PeopleScope, raw.get(FilterKey.PEOPLE, PeopleScope.EVERYONE))
    sprint = _enum(SprintScope, raw.get(FilterKey.SPRINT, SprintScope.ANY))
    for key, parsed in (
        (FilterKey.PROJECTS, projects),
        (FilterKey.PEOPLE, people),
        (FilterKey.SPRINT, sprint),
    ):
        if parsed is None:
            unsupported.append(key.value)
    project_ids: list[UUID] = []
    raw_ids = raw.get(FilterKey.PROJECT_IDS, [])
    for raw_id in raw_ids if isinstance(raw_ids, list) else []:
        try:
            project_ids.append(UUID(str(raw_id)))
        except ValueError:
            unsupported.append(FilterKey.PROJECT_IDS.value)
            break
    return (
        WidgetFilters(
            projects=projects or ProjectScope.ALL,
            project_ids=tuple(project_ids),
            people=people or PeopleScope.EVERYONE,
            sprint=sprint or SprintScope.ANY,
        ),
        tuple(dict.fromkeys(unsupported)),
    )


def _stored_widget(raw: Any, widget_type: WidgetType) -> Widget:
    filters, unsupported = _stored_filters(raw.get("filters"))
    stored_unsupported = raw.get("unsupported_filters")
    if isinstance(stored_unsupported, list):
        unsupported = tuple(dict.fromkeys([*unsupported, *map(str, stored_unsupported)]))
    return Widget(
        widget_id=widget_type.widget_id,
        visible=raw.get("visible", True) is not False,
        size=_enum(WidgetSize, raw.get("size")) or widget_type.default_size,
        filters=filters if widget_type.filterable else WidgetFilters(),
        unsupported_filters=unsupported if widget_type.filterable else (),
    )


def parse_stored(raw: Any, catalog: Catalog) -> Definition | None:
    """Tolerant read of a stored document: retired widgets drop, unknown filters are flagged."""
    if not isinstance(raw, dict):
        return None
    widgets: list[Widget] = []
    seen: set[str] = set()
    raw_widgets = raw.get("widgets")
    for entry in raw_widgets if isinstance(raw_widgets, list) else []:
        if not isinstance(entry, dict):
            continue
        widget_type = catalog.widget(str(entry.get("id", "")))
        if widget_type is None or widget_type.widget_id in seen:
            continue
        seen.add(widget_type.widget_id)
        widgets.append(_stored_widget(entry, widget_type))
    preset = raw.get("preset")
    name = raw.get("name")
    return Definition(
        widgets=tuple(widgets),
        preset=preset if isinstance(preset, str) else "",
        name=name[:MAX_NAME_LENGTH] if isinstance(name, str) else "",
    )


def validate_for_save(definition: Definition, catalog: Catalog) -> Definition:
    """Strict check of a definition a client or an agent submits."""
    if not definition.widgets:
        raise ValidationError("widgets", "A dashboard needs at least one widget")
    seen: set[str] = set()
    widgets: list[Widget] = []
    for widget in definition.widgets:
        widget_type = catalog.widget(widget.widget_id)
        if widget_type is None:
            raise ValidationError("widget_id", f"Unknown widget {widget.widget_id!r}")
        if widget.widget_id in seen:
            raise ValidationError("widget_id", f"Widget {widget.widget_id!r} appears twice")
        seen.add(widget.widget_id)
        filters = widget.filters
        if not widget_type.filterable and filters != WidgetFilters():
            raise ValidationError("filters", f"Widget {widget.widget_id!r} takes no filters")
        if len(filters.project_ids) > MAX_SELECTED_PROJECTS:
            raise ValidationError("project_ids", f"At most {MAX_SELECTED_PROJECTS} projects")
        if filters.projects is ProjectScope.SELECTED and not filters.project_ids:
            raise ValidationError("project_ids", "Pick at least one project")
        if filters.projects is not ProjectScope.SELECTED and filters.project_ids:
            filters = replace(filters, project_ids=())
        widgets.append(replace(widget, filters=filters))
    if definition.preset and catalog.preset(definition.preset) is None:
        raise ValidationError("preset", f"Unknown preset {definition.preset!r}")
    name = " ".join(definition.name.split())
    if len(name) > MAX_NAME_LENGTH:
        raise ValidationError("name", f"A dashboard name is at most {MAX_NAME_LENGTH} characters")
    return Definition(widgets=tuple(widgets), preset=definition.preset, name=name)


def _catalog_widgets(raw: list[dict[str, Any]], widgets: dict[str, WidgetType]) -> Definition:
    entries: list[Widget] = []
    for entry in raw:
        widget_type = widgets[entry["id"]]
        filters, unsupported = _stored_filters(entry.get("filters"))
        if unsupported:
            raise ValueError(f"catalog widget {entry['id']} has unsupported filters {unsupported}")
        entries.append(
            Widget(
                widget_id=widget_type.widget_id,
                size=_enum(WidgetSize, entry.get("size")) or widget_type.default_size,
                filters=filters,
            )
        )
    return Definition(widgets=tuple(entries))


@cache
def load_catalog() -> Catalog:
    raw = loads(_CATALOG_PATH.read_bytes())
    widgets = {
        entry["id"]: WidgetType(
            widget_id=entry["id"],
            label=entry["label"],
            description=entry["description"],
            filterable=bool(entry["filterable"]),
            default_size=WidgetSize(entry["size"]),
        )
        for entry in raw["widgets"]
    }
    presets = tuple(
        Preset(
            preset_id=entry["id"],
            label=entry["label"],
            description=entry["description"],
            definition=replace(
                _catalog_widgets(entry["widgets"], widgets),
                preset=entry["id"],
                name=entry["label"],
            ),
        )
        for entry in raw["presets"]
    )
    return Catalog(
        widgets=tuple(widgets.values()),
        presets=presets,
        default=_catalog_widgets(raw["default"], widgets),
    )
