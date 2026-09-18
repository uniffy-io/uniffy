"""Validation and storage of saved view definitions."""

import math
import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Any, NoReturn
from uuid import UUID

from google.protobuf import json_format
from loguru import logger
from uniffy_proto.projects.v1.projects_pb2 import (
    FilterLogic,
    RelativeDateAnchor,
    RoadmapZoom,
    SortDirection,
    TaskFieldRef,
    TaskFilterCondition,
    TaskFilterDate,
    TaskFilterGroup,
    TaskFilterIdSet,
    TaskFilterOperator,
    TaskFilterValue,
    TaskPseudoField,
    ViewDefinition,
)

from uniffy.core.errors import ValidationError
from uniffy.core.models.projects.field_definition import FieldDefinition, ProjectFieldType
from uniffy.core.models.projects.task import TaskType
from uniffy.core.models.projects.view_config import ProjectViewType
from uniffy.domains.projects.validation import option_ids
from uniffy.domains.projects.views.catalog import (
    EMPTINESS_OPERATORS,
    FIELD_TYPE_KINDS,
    GROUPABLE_KINDS,
    ID_FLAGS,
    ID_KINDS,
    PSEUDO_FIELD_KINDS,
    SINGLE_ID_OPERATORS,
    SORTABLE_KINDS,
    UUID_ID_KINDS,
    FieldKind,
    IdFlag,
    operators_for,
)

logger = logger.bind(component="projects.views.definition")

MAX_FILTER_DEPTH = 3
MAX_FILTER_NODES = 50
MAX_IDS_PER_CONDITION = 100
MAX_TEXT_LENGTH = 500
MAX_SORT_KEYS = 5
MAX_VISIBLE_FIELDS = 100
MAX_COLUMN_WIDTHS = 100
MIN_COLUMN_WIDTH = 40
MAX_COLUMN_WIDTH = 2000
MAX_COLLAPSED_KEYS = 200
MAX_GROUP_KEY_LENGTH = 200
MAX_VIEW_NAME_LENGTH = 100
MAX_RELATIVE_OFFSET_DAYS = 3660

_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DIRECTIONS = frozenset({SortDirection.SORT_DIRECTION_ASC, SortDirection.SORT_DIRECTION_DESC})
_LOGICS = frozenset({FilterLogic.FILTER_LOGIC_AND, FilterLogic.FILTER_LOGIC_OR})
_ZOOMS = frozenset({
    RoadmapZoom.ROADMAP_ZOOM_DAY,
    RoadmapZoom.ROADMAP_ZOOM_WEEK,
    RoadmapZoom.ROADMAP_ZOOM_MONTH,
})
_ANCHORS = frozenset(RelativeDateAnchor.values()) - {
    RelativeDateAnchor.RELATIVE_DATE_ANCHOR_UNSPECIFIED
}
_TASK_TYPES = frozenset(TaskType)


class LayoutCase(StrEnum):
    TABLE = "table"
    BOARD = "board"
    ROADMAP = "roadmap"
    BACKLOG = "backlog"
    GRAPH = "graph"
    RESOURCES = "resources"


class _RefCase(StrEnum):
    FIELD_ID = "field_id"
    PSEUDO = "pseudo"


class _NodeCase(StrEnum):
    CONDITION = "condition"
    GROUP = "group"


class _ValueCase(StrEnum):
    IDS = "ids"
    TEXT = "text"
    NUMBER = "number"
    NUMBER_RANGE = "number_range"
    DATE = "date"
    DATE_RANGE = "date_range"
    FLAG = "flag"


class _DateCase(StrEnum):
    FIXED = "fixed"
    RELATIVE = "relative"


VIEW_TYPE_BY_LAYOUT: dict[LayoutCase, ProjectViewType] = {
    LayoutCase.TABLE: ProjectViewType.TABLE,
    LayoutCase.BOARD: ProjectViewType.BOARD,
    LayoutCase.ROADMAP: ProjectViewType.ROADMAP,
    LayoutCase.BACKLOG: ProjectViewType.BACKLOG,
    LayoutCase.GRAPH: ProjectViewType.GRAPH,
    LayoutCase.RESOURCES: ProjectViewType.RESOURCES,
}
LAYOUT_BY_VIEW_TYPE: dict[ProjectViewType, LayoutCase] = {
    view_type: case for case, view_type in VIEW_TYPE_BY_LAYOUT.items()
}


@dataclass(frozen=True)
class _ResolvedField:
    kind: FieldKind
    label: str
    field: FieldDefinition | None
    pseudo: TaskPseudoField | None


def _fail(message: str) -> NoReturn:
    raise ValidationError("definition", message)


def _enum_label(name: str, prefix: str) -> str:
    return name.removeprefix(prefix).lower().replace("_", " ")


def _operator_label(operator: TaskFilterOperator) -> str:
    return _enum_label(TaskFilterOperator.Name(operator), "TASK_FILTER_OPERATOR_")


def _ref_key(ref: TaskFieldRef) -> tuple[str | None, str, int]:
    return ref.WhichOneof("ref"), ref.field_id, ref.pseudo


def view_type_for(definition: ViewDefinition) -> ProjectViewType:
    case = definition.WhichOneof("layout")
    if case is None:
        raise ValidationError("definition", "A view needs a layout")
    return VIEW_TYPE_BY_LAYOUT[LayoutCase(case)]


def validate_view_name(name: str) -> str:
    stripped = name.strip()
    if not stripped:
        raise ValidationError("name", "A view needs a name")
    if len(stripped) > MAX_VIEW_NAME_LENGTH:
        raise ValidationError("name", f"View names are at most {MAX_VIEW_NAME_LENGTH} characters")
    return stripped


def _normalize_group(group: TaskFilterGroup) -> None:
    if group.logic == FilterLogic.FILTER_LOGIC_UNSPECIFIED:
        group.logic = FilterLogic.FILTER_LOGIC_AND
    for node in group.nodes:
        if node.WhichOneof("node") == _NodeCase.GROUP:
            _normalize_group(node.group)


def normalize_definition(definition: ViewDefinition) -> ViewDefinition:
    """Unset enums take their documented defaults so stored definitions never carry them."""
    normalized = ViewDefinition()
    normalized.CopyFrom(definition)
    if normalized.HasField("filter"):
        _normalize_group(normalized.filter)
    for key in normalized.sort:
        if key.direction == SortDirection.SORT_DIRECTION_UNSPECIFIED:
            key.direction = SortDirection.SORT_DIRECTION_ASC
    if (
        normalized.HasField("group_by")
        and normalized.group_by.direction == SortDirection.SORT_DIRECTION_UNSPECIFIED
    ):
        normalized.group_by.direction = SortDirection.SORT_DIRECTION_ASC
    if (
        normalized.WhichOneof("layout") == LayoutCase.ROADMAP
        and normalized.roadmap.zoom == RoadmapZoom.ROADMAP_ZOOM_UNSPECIFIED
    ):
        normalized.roadmap.zoom = RoadmapZoom.ROADMAP_ZOOM_WEEK
    return normalized


class _Validator:
    def __init__(self, fields: list[FieldDefinition]) -> None:
        self.fields = {field.id: field for field in fields}
        self.node_count = 0

    def resolve(self, ref: TaskFieldRef, where: str) -> _ResolvedField:
        case = ref.WhichOneof("ref")
        if case == _RefCase.FIELD_ID:
            field = self.fields.get(ref.field_id)
            kind = FIELD_TYPE_KINDS.get(ProjectFieldType(field.type)) if field else None
            if field is None or kind is None:
                raise ValidationError("definition", f"{where}: unknown field '{ref.field_id}'")
            # The id rides along so a client can point at the offending condition.
            return _ResolvedField(kind, f"{field.name} ({field.id})", field, None)
        if case == _RefCase.PSEUDO:
            kind = PSEUDO_FIELD_KINDS.get(ref.pseudo)
            if kind is None:
                raise ValidationError("definition", f"{where}: unknown task attribute")
            label = _enum_label(TaskPseudoField.Name(ref.pseudo), "TASK_PSEUDO_FIELD_")
            return _ResolvedField(kind, label, None, ref.pseudo)
        raise ValidationError("definition", f"{where}: a field is required")

    def filter_group(self, group: TaskFilterGroup, path: str, depth: int) -> None:
        if depth > MAX_FILTER_DEPTH:
            _fail(f"Filter groups nest at most {MAX_FILTER_DEPTH} levels deep")
        if group.logic not in _LOGICS:
            _fail(f"Filter group {path or 'at the top'} has an unknown logic")
        for index, node in enumerate(group.nodes, start=1):
            self.node_count += 1
            if self.node_count > MAX_FILTER_NODES:
                _fail(f"A filter holds at most {MAX_FILTER_NODES} conditions and groups")
            where = f"{path}.{index}" if path else str(index)
            case = node.WhichOneof("node")
            if case == _NodeCase.CONDITION:
                self.condition(node.condition, f"Filter condition {where}")
            elif case == _NodeCase.GROUP:
                self.filter_group(node.group, where, depth + 1)
            else:
                _fail(f"Filter node {where} is empty")

    def condition(self, condition: TaskFilterCondition, where: str) -> None:
        resolved = self.resolve(condition.field, where)
        operator = condition.operator
        label = resolved.label
        if operator not in operators_for(resolved.kind, resolved.pseudo):
            name = (
                _operator_label(operator)
                if operator in TaskFilterOperator.values()
                else "unknown operator"
            )
            _fail(f"{where}: '{label}' does not support '{name}'")
        if operator in EMPTINESS_OPERATORS:
            if condition.HasField("value"):
                _fail(f"{where}: '{label}' takes no value for '{_operator_label(operator)}'")
            return
        if not condition.HasField("value"):
            _fail(f"{where}: '{label}' needs a value")

        value = condition.value
        kind = resolved.kind
        if kind in ID_KINDS:
            self.id_value(resolved, operator, value, where)
        elif kind is FieldKind.TEXT:
            self.text_value(value, where, label)
        elif kind is FieldKind.NUMBER:
            self.number_value(operator, value, where, label)
        elif kind in (FieldKind.DATE, FieldKind.TIMESTAMP):
            self.date_condition_value(operator, value, where, label)
        elif kind is FieldKind.BOOLEAN and value.WhichOneof("value") != _ValueCase.FLAG:
            _fail(f"{where}: '{label}' needs yes or no")

    def id_value(
        self,
        resolved: _ResolvedField,
        operator: TaskFilterOperator,
        value: TaskFilterValue,
        where: str,
    ) -> None:
        label = resolved.label
        if value.WhichOneof("value") != _ValueCase.IDS:
            _fail(f"{where}: '{label}' needs a list of values")
        id_set = value.ids
        flags = _id_flags(id_set)
        allowed = ID_FLAGS[resolved.kind]
        if flags - allowed:
            _fail(f"{where}: '{label}' does not accept {_flag_label(min(flags - allowed))}")
        if operator == TaskFilterOperator.TASK_FILTER_OPERATOR_IS_ALL_OF and IdFlag.EMPTY in flags:
            _fail(f"{where}: '{label}' cannot require an empty value alongside others")
        ids = list(id_set.ids)
        count = len(ids) + len(flags)
        if operator in SINGLE_ID_OPERATORS and count != 1:
            _fail(f"{where}: '{label}' needs exactly one value for '{_operator_label(operator)}'")
        if count == 0:
            _fail(f"{where}: '{label}' needs at least one value")
        if len(ids) > MAX_IDS_PER_CONDITION:
            _fail(f"{where}: '{label}' takes at most {MAX_IDS_PER_CONDITION} values")
        if len(set(ids)) != len(ids):
            _fail(f"{where}: '{label}' lists a value twice")

        kind = resolved.kind
        if kind in (FieldKind.SINGLE_SELECT, FieldKind.MULTI_SELECT) and resolved.field:
            known = option_ids(resolved.field.config or {})
            unknown = [option for option in ids if option not in known]
            if unknown:
                _fail(f"{where}: '{label}' has no option '{unknown[0]}'")
        elif kind is FieldKind.TASK_TYPE:
            unknown = [task_type for task_type in ids if task_type not in _TASK_TYPES]
            if unknown:
                _fail(f"{where}: '{unknown[0]}' is not a task type")
        elif kind in UUID_ID_KINDS:
            for raw in ids:
                try:
                    UUID(raw)
                except ValueError:
                    _fail(f"{where}: '{label}' has an invalid id '{raw}'")

    def text_value(self, value: TaskFilterValue, where: str, label: str) -> None:
        if value.WhichOneof("value") != _ValueCase.TEXT or not value.text.strip():
            _fail(f"{where}: '{label}' needs text")
        if len(value.text) > MAX_TEXT_LENGTH:
            _fail(f"{where}: '{label}' text is at most {MAX_TEXT_LENGTH} characters")

    def number_value(
        self, operator: TaskFilterOperator, value: TaskFilterValue, where: str, label: str
    ) -> None:
        case = value.WhichOneof("value")
        if operator == TaskFilterOperator.TASK_FILTER_OPERATOR_BETWEEN:
            if case != _ValueCase.NUMBER_RANGE:
                _fail(f"{where}: '{label}' needs a number range")
            bounds = (value.number_range.min, value.number_range.max)
            if not all(math.isfinite(bound) for bound in bounds) or bounds[0] > bounds[1]:
                _fail(f"{where}: '{label}' needs a range whose start is not after its end")
            return
        if case != _ValueCase.NUMBER or not math.isfinite(value.number):
            _fail(f"{where}: '{label}' needs a number")

    def date_condition_value(
        self, operator: TaskFilterOperator, value: TaskFilterValue, where: str, label: str
    ) -> None:
        case = value.WhichOneof("value")
        if operator == TaskFilterOperator.TASK_FILTER_OPERATOR_BETWEEN:
            if case != _ValueCase.DATE_RANGE:
                _fail(f"{where}: '{label}' needs a date range")
            start = self.date_value(value.date_range.start, where, label)
            end = self.date_value(value.date_range.end, where, label)
            if start and end and start > end:
                _fail(f"{where}: '{label}' needs a range whose start is not after its end")
            return
        if case != _ValueCase.DATE:
            _fail(f"{where}: '{label}' needs a date")
        self.date_value(value.date, where, label)

    def date_value(self, value: TaskFilterDate, where: str, label: str) -> date | None:
        case = value.WhichOneof("value")
        if case == _DateCase.FIXED:
            if not _DATE_PATTERN.match(value.fixed):
                _fail(f"{where}: '{label}' needs a date as YYYY-MM-DD")
            try:
                return date.fromisoformat(value.fixed)
            except ValueError:
                _fail(f"{where}: '{value.fixed}' is not a calendar date")
        if case == _DateCase.RELATIVE:
            if value.relative.anchor not in _ANCHORS:
                _fail(f"{where}: '{label}' has a relative date without an anchor")
            if abs(value.relative.offset_days) > MAX_RELATIVE_OFFSET_DAYS:
                _fail(f"{where}: '{label}' offsets at most {MAX_RELATIVE_OFFSET_DAYS} days")
            return None
        _fail(f"{where}: '{label}' needs a date")

    def sort(self, definition: ViewDefinition) -> None:
        if len(definition.sort) > MAX_SORT_KEYS:
            _fail(f"A view sorts by at most {MAX_SORT_KEYS} fields")
        seen: set[tuple[str | None, str, int]] = set()
        for index, key in enumerate(definition.sort, start=1):
            where = f"Sort key {index}"
            resolved = self.resolve(key.field, where)
            if resolved.kind not in SORTABLE_KINDS:
                _fail(f"{where}: cannot sort by '{resolved.label}'")
            if _ref_key(key.field) in seen:
                _fail(f"{where}: '{resolved.label}' is already a sort key")
            seen.add(_ref_key(key.field))
            if key.direction not in _DIRECTIONS:
                _fail(f"{where}: unknown direction")

    def group_by(self, definition: ViewDefinition) -> None:
        if not definition.HasField("group_by"):
            return
        resolved = self.resolve(definition.group_by.field, "Group by")
        if resolved.kind not in GROUPABLE_KINDS:
            _fail(f"Group by: cannot group by '{resolved.label}'")
        if definition.group_by.direction not in _DIRECTIONS:
            _fail("Group by: unknown direction")

    def columns(self, definition: ViewDefinition) -> None:
        if len(definition.visible_fields) > MAX_VISIBLE_FIELDS:
            _fail(f"A view shows at most {MAX_VISIBLE_FIELDS} fields")
        seen: set[tuple[str | None, str, int]] = set()
        for index, ref in enumerate(definition.visible_fields, start=1):
            resolved = self.resolve(ref, f"Visible field {index}")
            if _ref_key(ref) in seen:
                _fail(f"Visible field {index}: '{resolved.label}' is listed twice")
            seen.add(_ref_key(ref))

        if len(definition.column_widths) > MAX_COLUMN_WIDTHS:
            _fail(f"A view sizes at most {MAX_COLUMN_WIDTHS} columns")
        sized: set[tuple[str | None, str, int]] = set()
        for index, column in enumerate(definition.column_widths, start=1):
            resolved = self.resolve(column.field, f"Column width {index}")
            if _ref_key(column.field) in sized:
                _fail(f"Column width {index}: '{resolved.label}' is sized twice")
            sized.add(_ref_key(column.field))
            if not MIN_COLUMN_WIDTH <= column.width <= MAX_COLUMN_WIDTH:
                _fail(
                    f"Column width {index}: '{resolved.label}' must be between "
                    f"{MIN_COLUMN_WIDTH} and {MAX_COLUMN_WIDTH} pixels"
                )

        if len(definition.collapsed_group_keys) > MAX_COLLAPSED_KEYS:
            _fail(f"A view collapses at most {MAX_COLLAPSED_KEYS} groups")
        if any(len(key) > MAX_GROUP_KEY_LENGTH for key in definition.collapsed_group_keys):
            _fail(f"Collapsed group keys are at most {MAX_GROUP_KEY_LENGTH} characters")

    def layout(self, definition: ViewDefinition) -> None:
        case = definition.WhichOneof("layout")
        if case == LayoutCase.BOARD and definition.board.column_field_id:
            field = self.fields.get(definition.board.column_field_id)
            if field is None or ProjectFieldType(field.type) is not ProjectFieldType.SINGLE_SELECT:
                _fail("Board columns need a single-select field of this project")
        if case == LayoutCase.ROADMAP and definition.roadmap.zoom not in _ZOOMS:
            _fail("Roadmap zoom is unknown")


def _id_flags(id_set: TaskFilterIdSet) -> set[IdFlag]:
    flags: set[IdFlag] = set()
    if id_set.include_current_user:
        flags.add(IdFlag.CURRENT_USER)
    if id_set.include_empty:
        flags.add(IdFlag.EMPTY)
    if id_set.include_active_sprint:
        flags.add(IdFlag.ACTIVE_SPRINT)
    return flags


def _flag_label(flag: IdFlag) -> str:
    return {
        IdFlag.CURRENT_USER: "the current user",
        IdFlag.EMPTY: "an empty value",
        IdFlag.ACTIVE_SPRINT: "the active sprint",
    }[flag]


def validate_definition(definition: ViewDefinition, fields: list[FieldDefinition]) -> None:
    """Rejects anything the evaluators could not apply to this project's fields."""
    view_type_for(definition)
    validator = _Validator(fields)
    validator.layout(definition)
    if definition.HasField("filter"):
        validator.filter_group(definition.filter, "", 1)
    validator.sort(definition)
    validator.group_by(definition)
    validator.columns(definition)


def prepare_definition(
    definition: ViewDefinition, fields: list[FieldDefinition]
) -> tuple[ViewDefinition, ProjectViewType]:
    normalized = normalize_definition(definition)
    validate_definition(normalized, fields)
    return normalized, view_type_for(normalized)


def layout_only_definition(view_type: ProjectViewType) -> ViewDefinition:
    definition = ViewDefinition()
    getattr(definition, LAYOUT_BY_VIEW_TYPE[view_type].value).SetInParent()
    return definition


def definition_to_dict(definition: ViewDefinition) -> dict[str, Any]:
    return json_format.MessageToDict(definition, preserving_proto_field_name=True)


def definition_from_dict(data: dict[str, Any], view_type: ProjectViewType) -> ViewDefinition:
    """A stored definition that no longer parses degrades to its bare layout."""
    definition = ViewDefinition()
    try:
        json_format.ParseDict(data, definition, ignore_unknown_fields=True)
    except json_format.ParseError:
        logger.opt(exception=True).warning(
            "Stored view definition does not parse", view_type=str(view_type)
        )
        return layout_only_definition(view_type)
    if definition.WhichOneof("layout") is None:
        return layout_only_definition(view_type)
    return definition
